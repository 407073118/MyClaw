import { ipcMain, webContents } from "electron";

import type { AgentTask, AgentTaskCreateInput, AgentTaskStatus } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { createAgentTaskRecord, loadAgentTasks, saveAgentTasks } from "../services/agent-task-store";
import { createSiliconPersonSession, syncSiliconPersonExecutionResult } from "../services/silicon-person-session";
import { invokeRegisteredSessionSendMessage } from "./sessions";

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

/** 判断任务是否所有员工都已成功完成，用于汇总任务状态。 */
function resolveTaskStatus(task: AgentTask): AgentTaskStatus {
  const statuses = task.assigneeStatuses ?? {};
  if (task.assigneeIds.some((id) => statuses[id] === "failed")) return "failed";
  if (task.assigneeIds.length > 0 && task.assigneeIds.every((id) => statuses[id] === "succeeded")) {
    return "succeeded";
  }
  if (task.assigneeIds.some((id) => statuses[id] === "running")) return "running";
  return task.status;
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
        const payload = await invokeRegisteredSessionSendMessage(item.sessionId, {
          content: item.content,
        });
        await syncSiliconPersonExecutionResult(ctx, {
          siliconPersonId,
          session: payload.session,
          forceCurrentSession: true,
        });
        await updateAgentTask(ctx, item.taskId, (task) => {
          task.assigneeStatuses = {
            ...(task.assigneeStatuses ?? {}),
            [siliconPersonId]: "succeeded",
          };
          task.status = resolveTaskStatus(task);
        });
        console.info("[agent-task] 员工任务执行完成", {
          taskId: item.taskId,
          siliconPersonId,
          sessionId: item.sessionId,
        });
      } catch (error) {
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

/** 为任务中的每个 worker 创建独立会话，并启动后台执行队列。 */
async function attachChildSessionsAndRun(ctx: RuntimeContext, task: AgentTask): Promise<AgentTask> {
  for (const siliconPersonId of task.assigneeIds) {
    const { session } = await createSiliconPersonSession(ctx, {
      siliconPersonId,
      title: `任务: ${task.title}`,
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

      await attachChildSessionsAndRun(ctx, task);
      return { task };
    },
  );
}
