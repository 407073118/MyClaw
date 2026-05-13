import { ipcMain, webContents } from "electron";
import { randomUUID } from "node:crypto";

import { EventType, type AgentTask, type AgentTaskCreateInput, type AgentTaskStatus, type ChatMessage, type ChatSession } from "@shared/contracts";

import type { ActiveSessionRun, RuntimeContext } from "../services/runtime-context";
import { createAgentTaskRecord, loadAgentTasks, saveAgentTasks } from "../services/agent-task-store";
import { createSiliconPersonSession, syncSiliconPersonExecutionResult } from "../services/silicon-person-session";
import { invokeRegisteredSessionSendMessage, releasePendingApprovalsForRun } from "./sessions";
import { saveSession } from "../services/state-persistence";

type AgentTaskQueueItem = {
  taskId: string;
  siliconPersonId: string;
  sessionId: string;
  content: string;
};

let cachedAgentTasks: AgentTask[] | null = null;
const workerQueues = new Map<string, AgentTaskQueueItem[]>();
const runningWorkers = new Set<string>();

/** 广播任务变更，让渲染进程里的任务卡和 Team Dock 保持同步。 */
function broadcastAgentTaskChanged(task: AgentTask): void {
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.isDestroyed()) {
        wc.send("agent-task:changed", { task });
      }
    } catch {
      // 忽略已销毁窗口，避免后台任务更新中断。
    }
  }
}

/** 广播会话变更，让主聊天时间线立即出现被追加的员工结果。 */
function broadcastSessionUpdated(session: ChatSession): void {
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.isDestroyed()) {
        wc.send("session:stream", {
          type: EventType.SessionUpdated,
          sessionId: session.id,
          session,
        });
      }
    } catch {
      // 忽略已销毁窗口，避免追加结果时被单个窗口状态影响。
    }
  }
}

/** 提取员工任务 session 的最终可见摘要，用于主聊天任务卡回报。 */
function extractTaskResultSummary(session: { messages?: Array<{ role?: string; content?: unknown }> }): string | null {
  const message = [...(session.messages ?? [])]
    .reverse()
    .find((item) => (item.role === "assistant" || item.role === "tool") && typeof item.content === "string" && item.content.trim());
  if (!message || typeof message.content !== "string") return null;
  const summary = message.content.trim();
  return summary.length > 1200 ? `${summary.slice(0, 1200)}...` : summary;
}

/** 按负责人顺序合并多个员工的摘要，避免并发完成顺序影响主聊天展示。 */
function buildTaskResultSummary(task: AgentTask): string | null {
  const summaries = task.assigneeIds
    .map((id) => task.assigneeResultSummaries?.[id]?.trim())
    .filter((item): item is string => Boolean(item));
  return summaries.length > 0 ? summaries.join("\n\n") : null;
}

/** 生成追加到主聊天的可见消息内容，保留任务标题和员工汇总结果。 */
function buildSourceSessionAppendContent(task: AgentTask): string {
  const summary = task.resultSummary?.trim();
  if (!summary) {
    throw new Error("Agent task result summary is required");
  }
  return `Agent Task 完成：${task.title}\n\n${summary}`;
}

/** 查找任务来源主会话，不允许把结果写入不存在的历史来源。 */
function requireSourceSession(ctx: RuntimeContext, task: AgentTask): ChatSession {
  const session = ctx.state.sessions.find((item) => item.id === task.sourceSessionId);
  if (!session) {
    throw new Error(`Agent task source session not found: ${task.sourceSessionId}`);
  }
  return session;
}

/** 将已完成的员工任务结果追加到来源主会话，并通过任务字段防止重复追加。 */
async function appendAgentTaskResultToSourceSession(
  ctx: RuntimeContext,
  taskId: string,
): Promise<AgentTask> {
  const task = await requireAgentTask(ctx, taskId);
  const sourceSession = requireSourceSession(ctx, task);
  if (task.appendedMessageId && sourceSession.messages.some((message) => message.id === task.appendedMessageId)) {
    let currentTask = task;
    if (task.appendStatus !== "appended") {
      currentTask = await updateAgentTask(ctx, task.id, (item) => {
        item.appendStatus = "appended";
      }) ?? task;
    }
    console.info("[agent-task:append-result] 任务结果已追加，跳过重复写入", {
      taskId: task.id,
      sourceSessionId: sourceSession.id,
      messageId: task.appendedMessageId,
    });
    return currentTask;
  }
  if (task.status !== "succeeded") {
    throw new Error(`Agent task is not completed: ${task.id}`);
  }
  const content = buildSourceSessionAppendContent(task);
  const now = new Date().toISOString();
  const message: ChatMessage = {
    id: `msg-${randomUUID()}`,
    role: "assistant",
    content,
    createdAt: now,
  };
  sourceSession.messages.push(message);
  await saveSession(ctx.runtime.paths, sourceSession);
  broadcastSessionUpdated(sourceSession);
  const updated = await updateAgentTask(ctx, task.id, (item) => {
    item.appendStatus = "appended";
    item.appendedToSourceSessionAt = now;
    item.appendedMessageId = message.id;
  });
  console.info("[agent-task:append-result] 已追加任务结果到来源主会话", {
    taskId: task.id,
    sourceSessionId: sourceSession.id,
    messageId: message.id,
    contentLength: content.length,
  });
  return updated ?? task;
}

/** 读取当前 session 上挂起的审批请求，驱动 AgentTask 的 waiting_user 状态。 */
function findPendingApprovals(ctx: RuntimeContext, sessionId: string): string[] {
  return ctx.state.getApprovalRequests()
    .filter((request) => request.sessionId === sessionId)
    .map((request) => request.id);
}

/** 懒加载硅基员工任务列表，避免启动阶段重复读盘。 */
async function ensureAgentTasks(ctx: RuntimeContext): Promise<AgentTask[]> {
  if (!cachedAgentTasks) {
    cachedAgentTasks = await loadAgentTasks(ctx.runtime.paths);
  }
  return cachedAgentTasks;
}

/** 原地更新任务记录并写盘，同时推送最新任务给渲染进程。 */
async function updateAgentTask(
  ctx: RuntimeContext,
  taskId: string,
  updater: (task: AgentTask) => void,
): Promise<AgentTask | null> {
  const tasks = await ensureAgentTasks(ctx);
  const task = tasks.find((item) => item.id === taskId) ?? null;
  if (!task) {
    console.warn("[agent-task] 未找到需要更新的任务", { taskId });
    return null;
  }
  updater(task);
  task.updatedAt = new Date().toISOString();
  await saveAgentTasks(ctx.runtime.paths, tasks);
  broadcastAgentTaskChanged(task);
  return task;
}

/** 读取单个任务，集中处理任务不存在时的错误日志与异常语义。 */
async function requireAgentTask(ctx: RuntimeContext, taskId: string): Promise<AgentTask> {
  const tasks = await ensureAgentTasks(ctx);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Agent task not found: ${taskId}`);
  }
  return task;
}

/** 判断任务是否已经被取消，避免后台迟到结果覆盖用户的取消决定。 */
async function isAgentTaskCancelled(ctx: RuntimeContext, taskId: string): Promise<boolean> {
  const tasks = await ensureAgentTasks(ctx);
  return tasks.find((item) => item.id === taskId)?.status === "cancelled";
}

/** 判断队列项是否仍指向当前任务轮次，避免取消后重试被旧 run 覆盖。 */
async function isAgentTaskRunCurrent(ctx: RuntimeContext, item: AgentTaskQueueItem): Promise<boolean> {
  const tasks = await ensureAgentTasks(ctx);
  const task = tasks.find((candidate) => candidate.id === item.taskId);
  return task?.childSessionIds[item.siliconPersonId] === item.sessionId;
}

/** 判断任务是否所有员工都已成功完成，用于汇总任务状态。 */
function resolveTaskStatus(task: AgentTask): AgentTaskStatus {
  const statuses = task.assigneeStatuses ?? {};
  if (task.assigneeIds.some((id) => statuses[id] === "failed")) return "failed";
  if (task.assigneeIds.some((id) => statuses[id] === "waiting_user")) return "waiting_user";
  if (task.assigneeIds.some((id) => statuses[id] === "cancelled")) return "cancelled";
  if (task.assigneeIds.length > 0 && task.assigneeIds.every((id) => statuses[id] === "succeeded")) {
    return "succeeded";
  }
  if (task.assigneeIds.some((id) => statuses[id] === "running")) return "running";
  return task.status;
}

/** 同步运行中任务的审批等待状态，真实审批 Promise 阻塞时也能及时更新任务卡。 */
async function syncPendingApprovalsForRun(ctx: RuntimeContext, item: AgentTaskQueueItem): Promise<void> {
  const approvalIds = findPendingApprovals(ctx, item.sessionId);
  if (approvalIds.length === 0 || !(await isAgentTaskRunCurrent(ctx, item))) return;
  await updateAgentTask(ctx, item.taskId, (task) => {
    task.assigneeStatuses = {
      ...(task.assigneeStatuses ?? {}),
      [item.siliconPersonId]: "waiting_user",
    };
    task.approvalIds = Array.from(new Set([...(task.approvalIds ?? []), ...approvalIds]));
    task.status = resolveTaskStatus(task);
  });
  console.info("[agent-task] 已同步员工任务待审批状态", {
    taskId: item.taskId,
    siliconPersonId: item.siliconPersonId,
    approvalIds,
  });
}

/** 把单个员工执行项放入串行队列，避免同一员工同时跑多个任务。 */
function enqueueAgentTaskRun(ctx: RuntimeContext, item: AgentTaskQueueItem): void {
  let queue = workerQueues.get(item.siliconPersonId);
  if (!queue) {
    queue = [];
    workerQueues.set(item.siliconPersonId, queue);
  }
  queue.push(item);
  console.info("[agent-task] 员工任务已入队", {
    taskId: item.taskId,
    siliconPersonId: item.siliconPersonId,
    sessionId: item.sessionId,
    queuedCount: queue.length,
  });
  if (!runningWorkers.has(item.siliconPersonId)) {
    void drainAgentTaskQueue(ctx, item.siliconPersonId);
  }
}

/** 串行消费某个员工的任务队列，并把执行结果同步回员工私有会话。 */
async function drainAgentTaskQueue(ctx: RuntimeContext, siliconPersonId: string): Promise<void> {
  if (runningWorkers.has(siliconPersonId)) return;
  runningWorkers.add(siliconPersonId);
  try {
    const queue = workerQueues.get(siliconPersonId);
    while (queue && queue.length > 0) {
      const item = queue.shift()!;
      if ((await isAgentTaskCancelled(ctx, item.taskId)) || !(await isAgentTaskRunCurrent(ctx, item))) {
        console.info("[agent-task] 跳过已取消或已过期的员工任务", {
          taskId: item.taskId,
          siliconPersonId,
          sessionId: item.sessionId,
        });
        continue;
      }
      await updateAgentTask(ctx, item.taskId, (task) => {
        task.status = "running";
        task.assigneeStatuses = {
          ...(task.assigneeStatuses ?? {}),
          [siliconPersonId]: "running",
        };
      });
      try {
        console.info("[agent-task] 开始执行员工任务", {
          taskId: item.taskId,
          siliconPersonId,
          sessionId: item.sessionId,
          remaining: queue.length,
        });
        const approvalPoll = setInterval(() => {
          void syncPendingApprovalsForRun(ctx, item);
        }, 250);
        const payload = await Promise.resolve(invokeRegisteredSessionSendMessage(item.sessionId, {
          content: item.content,
        })).finally(() => {
          clearInterval(approvalPoll);
        });
        const approvalIds = findPendingApprovals(ctx, item.sessionId);
        await syncSiliconPersonExecutionResult(ctx, {
          siliconPersonId,
          session: payload.session,
          forceCurrentSession: false,
        });
        if ((await isAgentTaskCancelled(ctx, item.taskId)) || !(await isAgentTaskRunCurrent(ctx, item))) {
          console.info("[agent-task] 员工任务结果已迟到，保留当前任务状态", {
            taskId: item.taskId,
            siliconPersonId,
            sessionId: item.sessionId,
          });
          continue;
        }
        await updateAgentTask(ctx, item.taskId, (task) => {
          const nextStatus: AgentTaskStatus = approvalIds.length > 0 ? "waiting_user" : "succeeded";
          task.assigneeStatuses = {
            ...(task.assigneeStatuses ?? {}),
            [siliconPersonId]: nextStatus,
          };
          task.approvalIds = Array.from(new Set([...(task.approvalIds ?? []), ...approvalIds]));
          const summary = extractTaskResultSummary(payload.session);
          if (summary) {
            task.assigneeResultSummaries = {
              ...(task.assigneeResultSummaries ?? {}),
              [siliconPersonId]: summary,
            };
            task.resultSummary = buildTaskResultSummary(task);
          }
          task.status = resolveTaskStatus(task);
        });
        console.info("[agent-task] 员工任务执行完成", {
          taskId: item.taskId,
          siliconPersonId,
          sessionId: item.sessionId,
        });
      } catch (error) {
        if (!(await isAgentTaskRunCurrent(ctx, item))) {
          console.info("[agent-task] 员工任务错误已迟到，忽略旧轮次结果", {
            taskId: item.taskId,
            siliconPersonId,
            sessionId: item.sessionId,
          });
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        await updateAgentTask(ctx, item.taskId, (task) => {
          task.status = "failed";
          task.error = message;
          task.assigneeStatuses = {
            ...(task.assigneeStatuses ?? {}),
            [siliconPersonId]: "failed",
          };
        });
        console.error("[agent-task] 员工任务执行失败", {
          taskId: item.taskId,
          siliconPersonId,
          error: message,
        });
      }
    }
  } finally {
    runningWorkers.delete(siliconPersonId);
    const queue = workerQueues.get(siliconPersonId);
    if (queue && queue.length > 0) {
      void drainAgentTaskQueue(ctx, siliconPersonId);
    }
  }
}

/** 重新排队一个已有任务，复用原始 instruction 与负责人，重建独立任务会话。 */
async function retryAgentTask(ctx: RuntimeContext, taskId: string): Promise<AgentTask> {
  const task = await requireAgentTask(ctx, taskId);
  await updateAgentTask(ctx, taskId, (item) => {
    item.status = "queued";
    item.error = null;
    item.resultSummary = null;
    item.appendStatus = "not_appended";
    item.appendedToSourceSessionAt = null;
    item.appendedMessageId = null;
    item.approvalIds = [];
    item.childSessionIds = {};
    item.assigneeResultSummaries = {};
    item.assigneeStatuses = Object.fromEntries(item.assigneeIds.map((id) => [id, "queued" as const]));
  });
  console.info("[agent-task:retry] 重新排队员工任务", {
    taskId,
    assigneeIds: task.assigneeIds,
  });
  return attachChildSessionsAndRun(ctx, task);
}

/** 取消任务并清理尚未开始的队列项；运行中的 session 会尽量通过 active run abort 终止。 */
async function cancelAgentTask(ctx: RuntimeContext, taskId: string): Promise<AgentTask> {
  const task = await requireAgentTask(ctx, taskId);
  for (const siliconPersonId of task.assigneeIds) {
    const queue = workerQueues.get(siliconPersonId);
    if (queue) {
      workerQueues.set(siliconPersonId, queue.filter((item) => item.taskId !== taskId));
    }
  }
  for (const sessionId of Object.values(task.childSessionIds ?? {})) {
    const activeRun = ctx.state.activeSessionRuns.get(sessionId) as ActiveSessionRun | undefined;
    if (activeRun) {
      activeRun.cancelRequested = true;
      activeRun.status = "canceling";
      releasePendingApprovalsForRun(ctx, activeRun);
      if (activeRun.abortController && !activeRun.abortController.signal.aborted) {
        activeRun.abortController.abort();
      }
    }
  }
  const updated = await updateAgentTask(ctx, taskId, (item) => {
    item.status = "cancelled";
    item.assigneeStatuses = Object.fromEntries(item.assigneeIds.map((id) => [id, "cancelled" as const]));
    item.error = null;
  });
  console.info("[agent-task:cancel] 已取消员工任务", {
    taskId,
    assigneeIds: task.assigneeIds,
  });
  return updated ?? task;
}

/** 基于原任务创建追问子任务，保留主聊天来源和负责人边界。 */
async function createAgentTaskFollowUp(
  ctx: RuntimeContext,
  input: { taskId: string; instruction: string },
): Promise<AgentTask> {
  const parentTask = await requireAgentTask(ctx, input.taskId);
  const childTask = createAgentTaskRecord({
    sourceSessionId: parentTask.sourceSessionId,
    parentTaskId: parentTask.id,
    title: `追问: ${parentTask.title}`,
    instruction: input.instruction,
    mode: parentTask.mode,
    assigneeIds: parentTask.leadAssigneeId ? [parentTask.leadAssigneeId] : parentTask.assigneeIds,
    contextPolicy: parentTask.contextPolicy,
  });
  const tasks = await ensureAgentTasks(ctx);
  tasks.unshift(childTask);
  await saveAgentTasks(ctx.runtime.paths, tasks);
  broadcastAgentTaskChanged(childTask);
  console.info("[agent-task:follow-up] 已创建追问子任务", {
    parentTaskId: parentTask.id,
    taskId: childTask.id,
  });
  try {
    await attachChildSessionsAndRun(ctx, childTask);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAgentTask(ctx, childTask.id, (item) => {
      item.status = "failed";
      item.error = message;
      item.assigneeStatuses = Object.fromEntries(item.assigneeIds.map((id) => [id, "failed" as const]));
    });
  }
  return childTask;
}

/** 为任务中的每个 worker 创建独立会话，并启动后台执行队列。 */
async function attachChildSessionsAndRun(ctx: RuntimeContext, task: AgentTask): Promise<AgentTask> {
  for (const siliconPersonId of task.assigneeIds) {
    const { session } = await createSiliconPersonSession(ctx, {
      siliconPersonId,
      title: `任务: ${task.title}`,
      preserveCurrentSession: true,
    });
    task.childSessionIds[siliconPersonId] = session.id;
    console.info("[agent-task] 已创建员工独立任务会话", {
      taskId: task.id,
      siliconPersonId,
      sessionId: session.id,
    });
  }
  await saveAgentTasks(ctx.runtime.paths, await ensureAgentTasks(ctx));
  broadcastAgentTaskChanged(task);
  for (const siliconPersonId of task.assigneeIds) {
    const sessionId = task.childSessionIds[siliconPersonId];
    if (!sessionId) continue;
    enqueueAgentTaskRun(ctx, {
      taskId: task.id,
      siliconPersonId,
      sessionId,
      content: task.instruction,
    });
  }
  return task;
}

/** 注册 Agent Task IPC，承接 Leader 通过 @员工 下发的半自动任务。 */
export function registerAgentTaskHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("agent-task:list", async (): Promise<AgentTask[]> => {
    const tasks = await ensureAgentTasks(ctx);
    console.info("[agent-task:list] 返回任务列表", { count: tasks.length });
    return tasks;
  });

  ipcMain.handle(
    "agent-task:create",
    async (_event, input: AgentTaskCreateInput): Promise<{ task: AgentTask }> => {
      const task = createAgentTaskRecord(input);
      if (!ctx.state.sessions.some((session) => session.id === task.sourceSessionId)) {
        throw new Error(`Agent task source session not found: ${task.sourceSessionId}`);
      }
      const missingAssignees = task.assigneeIds.filter(
        (id) => !ctx.state.siliconPersons.some((person) => person.id === id),
      );
      if (missingAssignees.length > 0) {
        throw new Error(`Agent task assignee not found: ${missingAssignees.join(", ")}`);
      }

      const tasks = await ensureAgentTasks(ctx);
      tasks.unshift(task);
      await saveAgentTasks(ctx.runtime.paths, tasks);
      broadcastAgentTaskChanged(task);
      console.info("[agent-task:create] 已创建硅基员工任务", {
        taskId: task.id,
        sourceSessionId: task.sourceSessionId,
        assigneeIds: task.assigneeIds,
      });

      try {
        await attachChildSessionsAndRun(ctx, task);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateAgentTask(ctx, task.id, (item) => {
          item.status = "failed";
          item.error = message;
          item.assigneeStatuses = Object.fromEntries(item.assigneeIds.map((id) => [id, "failed" as const]));
        });
        console.error("[agent-task:create] 创建员工任务会话失败，任务已标记为失败", {
          taskId: task.id,
          error: message,
        });
      }
      return { task };
    },
  );

  ipcMain.handle("agent-task:cancel", async (_event, taskId: string): Promise<{ task: AgentTask }> => {
    return { task: await cancelAgentTask(ctx, taskId) };
  });

  ipcMain.handle("agent-task:retry", async (_event, taskId: string): Promise<{ task: AgentTask }> => {
    return { task: await retryAgentTask(ctx, taskId) };
  });

  ipcMain.handle(
    "agent-task:follow-up",
    async (_event, input: { taskId: string; instruction: string }): Promise<{ task: AgentTask }> => {
      const instruction = input.instruction.trim();
      if (!instruction) {
        throw new Error("Agent task follow-up instruction is required");
      }
      return { task: await createAgentTaskFollowUp(ctx, { taskId: input.taskId, instruction }) };
    },
  );

  ipcMain.handle("agent-task:append-result-to-source", async (_event, taskId: string): Promise<{ task: AgentTask }> => {
    return { task: await appendAgentTaskResultToSourceSession(ctx, taskId) };
  });
}
