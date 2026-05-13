import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createApprovalRequest, readApprovalRequest } from "../core/approval-store.js";
import type { SiliconLogger } from "../core/employee-scaffold.js";
import { recordHeartbeatTick } from "../core/heartbeat-state.js";
import { acquireEmployeeLock, refreshEmployeeLock, releaseEmployeeLock } from "../core/lock-store.js";
import { appendMemoryEvent, type MemoryEventType } from "../core/memory-store.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import { updateEmployeeProfileStatus } from "../core/profile-store.js";
import { writeUtf8FileAtomically } from "../core/safe-file.js";
import { assertHeartbeatEvent } from "../core/schema-guards.js";
import type { EmployeeTask } from "../core/task-store.js";
import { listEmployeeTasks, writeEmployeeTask } from "../core/task-store.js";
import { buildHarnessRunPlan, writeHarnessRunFiles } from "../harness/harness-plan.js";
import { runHarnessSteps } from "../harness/step-runner.js";
import { evaluateEmployeeCapabilityPolicy, isCapabilityId } from "../policy/policy-engine.js";

export type HeartbeatEventType =
  | "noop"
  | "approval_requested"
  | "approval_denied"
  | "policy_denied"
  | "processed_task"
  | "blocked_task"
  | "run_started"
  | "task_observed"
  | "artifact_written"
  | "review_written"
  | "run_succeeded"
  | "run_blocked";

export type HeartbeatRunEvent = {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  taskId: string;
  type: HeartbeatEventType;
  createdAt: string;
  message: string;
};

export type RunEmployeeHeartbeatInput = {
  employeeDir: string;
  now?: () => Date;
  logger?: SiliconLogger;
};

export type RunEmployeeHeartbeatResult = {
  processedTaskIds: string[];
  approvalTaskIds: string[];
  deniedTaskIds: string[];
  blockedTaskIds: string[];
  eventCount: number;
};

type HeartbeatTaskDecision =
  | { type: "execute"; task: EmployeeTask }
  | { type: "approval_requested"; taskId: string }
  | { type: "approval_denied"; taskId: string }
  | { type: "none" };

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 执行一次员工 heartbeat，扫描 inbox 并推进最小可审计运行闭环。 */
export async function runEmployeeHeartbeat(input: RunEmployeeHeartbeatInput): Promise<RunEmployeeHeartbeatResult> {
  const logger = input.logger ?? noopLogger;
  const lockTtlMs = 600_000;
  const lock = await acquireEmployeeLock(input.employeeDir, "heartbeat", { logger, ttlMs: lockTtlMs });
  const renewTimer = setInterval(() => {
    void refreshEmployeeLock(lock, { logger, ttlMs: lockTtlMs }).catch((error: unknown) => {
      logger.warn("硅基员工 heartbeat 锁续租失败", {
        employeeDir: input.employeeDir,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
  }, Math.floor(lockTtlMs / 2));
  renewTimer.unref?.();

  try {
    return await runEmployeeHeartbeatUnlocked(input, logger);
  } catch (error) {
    const failedAt = (input.now ?? (() => new Date()))().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("硅基员工 heartbeat 执行失败，写入失败状态", { employeeDir: input.employeeDir, errorMessage });
    await updateEmployeeProfileStatus({
      employeeDir: input.employeeDir,
      status: "failed",
      updatedAt: failedAt,
      lastErrorMessage: errorMessage,
      logger,
    }).catch(() => undefined);
    await recordHeartbeatTick({
      employeeDir: input.employeeDir,
      status: "failed",
      beatAt: failedAt,
      processed: 0,
      approvals: 0,
      denied: 0,
      events: 1,
      logger,
    }).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(renewTimer);
    await releaseEmployeeLock(lock, logger);
  }
}

/** 在已持有员工锁的情况下执行 heartbeat 主流程。 */
async function runEmployeeHeartbeatUnlocked(
  input: RunEmployeeHeartbeatInput,
  logger: SiliconLogger,
): Promise<RunEmployeeHeartbeatResult> {
  const now = input.now ?? (() => new Date());
  logger.info("开始执行硅基员工 heartbeat", { employeeDir: input.employeeDir });
  const decision = await prepareNextHeartbeatTask(input.employeeDir, now, logger);

  if (decision.type === "none") {
    const beatAt = now().toISOString();
    await appendHeartbeatEvent(input.employeeDir, {
      type: "noop",
      createdAt: beatAt,
      message: "本次 heartbeat 未发现可执行 task。",
    }, logger);
    await recordHeartbeatTick({
      employeeDir: input.employeeDir,
      status: "alive",
      beatAt,
      processed: 0,
      approvals: 0,
      denied: 0,
      events: 0,
      logger,
    });
    return { processedTaskIds: [], approvalTaskIds: [], deniedTaskIds: [], blockedTaskIds: [], eventCount: 0 };
  }

  if (decision.type === "approval_requested") {
    await recordHeartbeatTick({
      employeeDir: input.employeeDir,
      status: "waiting_approval",
      beatAt: now().toISOString(),
      processed: 0,
      approvals: 1,
      denied: 0,
      events: 0,
      logger,
    });
    return { processedTaskIds: [], approvalTaskIds: [decision.taskId], deniedTaskIds: [], blockedTaskIds: [], eventCount: 0 };
  }

  if (decision.type === "approval_denied") {
    await recordHeartbeatTick({
      employeeDir: input.employeeDir,
      status: "failed",
      beatAt: now().toISOString(),
      processed: 0,
      approvals: 0,
      denied: 1,
      events: 0,
      logger,
    });
    return { processedTaskIds: [], approvalTaskIds: [], deniedTaskIds: [decision.taskId], blockedTaskIds: [], eventCount: 0 };
  }

  return executeHeartbeatTask({
    employeeDir: input.employeeDir,
    task: decision.task,
    createdAt: now().toISOString(),
    logger,
  });
}

/** 准备下一条可处理任务，负责执行前 policy 与审批状态裁决。 */
async function prepareNextHeartbeatTask(
  employeeDir: string,
  now: () => Date,
  logger: SiliconLogger,
): Promise<HeartbeatTaskDecision> {
  const tasks = await listEmployeeTasks(employeeDir, logger);
  for (const task of tasks) {
    if (task.status === "queued") {
      return prepareQueuedTask(employeeDir, task, now, logger);
    }
    if (task.status === "waiting_approval") {
      const decision = await prepareWaitingApprovalTask(employeeDir, task, now, logger);
      if (decision.type !== "none") {
        return decision;
      }
    }
  }
  return { type: "none" };
}

/** 对 queued task 执行能力裁决，必要时创建审批请求并暂停任务。 */
async function prepareQueuedTask(
  employeeDir: string,
  task: EmployeeTask,
  now: () => Date,
  logger: SiliconLogger,
): Promise<HeartbeatTaskDecision> {
  const capability = task.requestedCapability ?? "artifact.write";
  const policy = await evaluateEmployeeCapabilityPolicy({ employeeDir, capability, logger });
  const timestamp = now().toISOString();

  if (policy.decision === "allow") {
    logger.info("queued task 通过 policy 裁决，可直接执行", { employeeDir, taskId: task.id, capability });
    return { type: "execute", task };
  }

  if (policy.decision === "approval_required") {
    if (!isCapabilityId(capability)) {
      await failTaskForPolicy(employeeDir, task, timestamp, policy.reason, logger);
      return { type: "approval_denied", taskId: task.id };
    }
    const approvalId = buildApprovalId(task);
    await createApprovalRequest({ employeeDir, approvalId, taskId: task.id, capability, reason: policy.reason, now, logger });
    await writeEmployeeTask(employeeDir, {
      ...task,
      schemaVersion: 1,
      status: "waiting_approval",
      approvalId,
      updatedAt: timestamp,
    }, logger);
    await updateEmployeeProfileStatus({ employeeDir, status: "waiting_approval", updatedAt: timestamp, currentTaskId: task.id, logger });
    await appendHeartbeatEvent(employeeDir, {
      type: "approval_requested",
      createdAt: timestamp,
      taskId: task.id,
      approvalId,
      capability,
      message: "任务需要审批，heartbeat 已暂停执行。",
    }, logger);
    await appendMemoryEventAt({
      employeeDir,
      eventId: `memory-${approvalId}-requested`,
      type: "approval_requested",
      subjectId: task.id,
      summary: `任务 ${task.id} 请求能力 ${capability}，已进入审批等待。`,
      confidence: 1,
      sourcePath: join("approvals", `${approvalId}.json`).replaceAll("\\", "/"),
      createdAt: timestamp,
      logger,
    });
    logger.info("queued task 已暂停并等待审批", { employeeDir, taskId: task.id, approvalId, capability });
    return { type: "approval_requested", taskId: task.id };
  }

  await failTaskForPolicy(employeeDir, task, timestamp, policy.reason, logger);
  return { type: "approval_denied", taskId: task.id };
}

/** 根据任务尝试次数生成审批 ID，重试轮次避免覆盖历史审批。 */
function buildApprovalId(task: EmployeeTask): string {
  const attempt = task.attempt ?? 1;
  return attempt <= 1 ? `approval-${task.id}` : `approval-${task.id}-${String(attempt).padStart(2, "0")}`;
}

/** 对 waiting_approval task 检查审批结果，决定继续执行或终止。 */
async function prepareWaitingApprovalTask(
  employeeDir: string,
  task: EmployeeTask,
  now: () => Date,
  logger: SiliconLogger,
): Promise<HeartbeatTaskDecision> {
  const timestamp = now().toISOString();
  if (!task.approvalId) {
    await failTaskForPolicy(employeeDir, task, timestamp, "任务缺少审批 ID，无法继续执行。", logger);
    return { type: "approval_denied", taskId: task.id };
  }

  const approval = await readApprovalRequest(employeeDir, task.approvalId);
  const expectedCapability = task.requestedCapability ?? "artifact.write";
  if (approval.taskId !== task.id || approval.capability !== expectedCapability) {
    await failTaskForPolicy(employeeDir, task, timestamp, "审批请求与任务不匹配，任务终止。", logger);
    return { type: "approval_denied", taskId: task.id };
  }
  if (approval.status === "approved") {
    logger.info("waiting_approval task 审批已通过，可继续执行", { employeeDir, taskId: task.id, approvalId: task.approvalId });
    return { type: "execute", task };
  }
  if (approval.status === "denied") {
    const reason = "审批已拒绝，任务终止。";
    await writeEmployeeTask(employeeDir, {
      ...task,
      schemaVersion: 1,
      status: "failed",
      updatedAt: timestamp,
      errorMessage: reason,
    }, logger);
    await updateEmployeeProfileStatus({
      employeeDir,
      status: "failed",
      updatedAt: timestamp,
      currentTaskId: task.id,
      lastErrorMessage: reason,
      logger,
    });
    await appendHeartbeatEvent(employeeDir, {
      type: "approval_denied",
      createdAt: timestamp,
      taskId: task.id,
      approvalId: task.approvalId,
      message: "审批已拒绝，heartbeat 已终止任务。",
    }, logger);
    await appendMemoryEventAt({
      employeeDir,
      eventId: `memory-${task.approvalId}-denied`,
      type: "approval_denied",
      subjectId: task.id,
      summary: `任务 ${task.id} 的审批 ${task.approvalId} 已拒绝，任务已终止。`,
      confidence: 1,
      sourcePath: join("approvals", `${task.approvalId}.json`).replaceAll("\\", "/"),
      createdAt: timestamp,
      logger,
    });
    logger.warn("waiting_approval task 审批已拒绝，任务终止", { employeeDir, taskId: task.id, approvalId: task.approvalId });
    return { type: "approval_denied", taskId: task.id };
  }
  return { type: "none" };
}

/** 执行单个 task 的 run 目录创建、harness 推进、产物写入和状态回写。 */
async function executeHeartbeatTask(input: {
  employeeDir: string;
  task: EmployeeTask;
  createdAt: string;
  logger: SiliconLogger;
}): Promise<RunEmployeeHeartbeatResult> {
  const queuedTask = input.task;
  const attempt = queuedTask.attempt ?? 1;
  const runId = `run-${queuedTask.id}-${String(attempt).padStart(2, "0")}`;
  const runDir = resolveEmployeeChildPath(input.employeeDir, ["runs", runId], input.logger);
  await mkdir(runDir, { recursive: true });
  const runningTask: EmployeeTask = {
    ...queuedTask,
    schemaVersion: 1,
    status: "running",
    attempt,
    runId,
    updatedAt: input.createdAt,
  };
  await writeEmployeeTask(input.employeeDir, runningTask, input.logger);
  await updateEmployeeProfileStatus({
    employeeDir: input.employeeDir,
    status: "running",
    updatedAt: input.createdAt,
    currentTaskId: queuedTask.id,
    currentRunId: runId,
    logger: input.logger,
  });

  try {
    const harness = await buildHarnessRunPlan({
      employeeDir: input.employeeDir,
      runId,
      task: runningTask,
      createdAt: input.createdAt,
      logger: input.logger,
    });
    await writeHarnessRunFiles({ runDir, context: harness.context, plan: harness.plan, logger: input.logger });
    const events: HeartbeatRunEvent[] = [
      buildRunEvent({ index: 1, runId, task: runningTask, type: "run_started", createdAt: input.createdAt, message: "run 已启动。" }),
      buildRunEvent({ index: 2, runId, task: runningTask, type: "task_observed", createdAt: input.createdAt, message: "已观测 queued task。" }),
    ];
    const execution = await runHarnessSteps({
      employeeDir: input.employeeDir,
      task: runningTask,
      plan: harness.plan,
      createdAt: input.createdAt,
      logger: input.logger,
    });

    const artifactRelativePath = join("artifacts", queuedTask.id, runId, "report.md").replaceAll("\\", "/");
    const artifactPath = resolveEmployeeChildPath(input.employeeDir, ["artifacts", queuedTask.id, runId, "report.md"], input.logger);
    await mkdir(resolveEmployeeChildPath(input.employeeDir, ["artifacts", queuedTask.id, runId], input.logger), { recursive: true });
    await writeUtf8FileAtomically(artifactPath, execution.artifactMarkdown, input.logger);
    events.push(buildRunEvent({
      index: 3,
      runId,
      task: runningTask,
      type: "artifact_written",
      createdAt: input.createdAt,
      message: `已写入产物：${artifactRelativePath}`,
    }));

    const reviewRelativePath = join("reviews", `${runId}.md`).replaceAll("\\", "/");
    await writeUtf8FileAtomically(
      resolveEmployeeChildPath(input.employeeDir, ["reviews", `${runId}.md`], input.logger),
      execution.reviewMarkdown,
      input.logger,
    );
    events.push(buildRunEvent({
      index: 4,
      runId,
      task: runningTask,
      type: "review_written",
      createdAt: input.createdAt,
      message: `已写入复盘：${reviewRelativePath}`,
    }));

    await writeUtf8FileAtomically(
      resolveEmployeeChildPath(runDir, ["steps.jsonl"], input.logger),
      `${execution.stepExecutions.map((step) => JSON.stringify(step)).join("\n")}\n`,
      input.logger,
    );
    const taskStatus = execution.status === "succeeded" ? "succeeded" : "blocked";
    const finishedTask: EmployeeTask = {
      ...runningTask,
      schemaVersion: 1,
      status: taskStatus,
      attempt,
      updatedAt: input.createdAt,
      runId,
      artifactPath: artifactRelativePath,
      reviewPath: reviewRelativePath,
      errorMessage: execution.verifier.blockedReason,
      runHistory: [
        ...(runningTask.runHistory ?? []),
        { runId, status: taskStatus, artifactPath: artifactRelativePath, reviewPath: reviewRelativePath, finishedAt: input.createdAt },
      ],
    };
    await writeEmployeeTask(input.employeeDir, finishedTask, input.logger);
    events.push(buildRunEvent({
      index: 5,
      runId,
      task: runningTask,
      type: execution.status === "succeeded" ? "run_succeeded" : "run_blocked",
      createdAt: input.createdAt,
      message: execution.status === "succeeded" ? "run 已成功完成。" : `run 已阻塞：${execution.verifier.blockedReason ?? "未知原因"}`,
    }));

    await writeUtf8FileAtomically(resolveEmployeeChildPath(runDir, ["state.json"], input.logger), `${JSON.stringify({
      schemaVersion: 1,
      runId,
      taskId: queuedTask.id,
      status: execution.status,
      startedAt: input.createdAt,
      finishedAt: input.createdAt,
      verifier: execution.verifier,
    }, null, 2)}\n`, input.logger);
    await writeUtf8FileAtomically(resolveEmployeeChildPath(runDir, ["events.jsonl"], input.logger), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, input.logger);
    await appendHeartbeatEvent(input.employeeDir, {
      type: execution.status === "succeeded" ? "processed_task" : "blocked_task",
      createdAt: input.createdAt,
      taskId: queuedTask.id,
      runId,
      message: execution.status === "succeeded"
        ? "heartbeat 已推进 queued task 到 succeeded。"
        : `heartbeat 已将 queued task 标记为 blocked：${execution.verifier.blockedReason ?? "未知原因"}`,
    }, input.logger);
    await appendMemoryEventAt({
      employeeDir: input.employeeDir,
      eventId: `memory-${runId}-${execution.status}`,
      type: execution.status === "succeeded" ? "task_succeeded" : "task_blocked",
      subjectId: queuedTask.id,
      summary: execution.status === "succeeded"
        ? `任务 ${queuedTask.id} 已成功完成，产物和复盘已落盘。`
        : `任务 ${queuedTask.id} 已阻塞，原因：${execution.verifier.blockedReason ?? "未知原因"}`,
      confidence: 0.95,
      sourcePath: join("runs", runId, "state.json").replaceAll("\\", "/"),
      createdAt: input.createdAt,
      logger: input.logger,
    });
    await updateEmployeeProfileStatus({
      employeeDir: input.employeeDir,
      status: "idle",
      updatedAt: input.createdAt,
      lastErrorMessage: execution.status === "blocked" ? execution.verifier.blockedReason : undefined,
      logger: input.logger,
    });
    await recordHeartbeatTick({
      employeeDir: input.employeeDir,
      status: "alive",
      beatAt: input.createdAt,
      processed: execution.status === "succeeded" ? 1 : 0,
      approvals: 0,
      denied: 0,
      events: events.length,
      logger: input.logger,
    });
    input.logger.info("硅基员工 heartbeat 已完成任务推进", { employeeDir: input.employeeDir, taskId: queuedTask.id, runId, status: execution.status });
    return {
      processedTaskIds: execution.status === "succeeded" ? [queuedTask.id] : [],
      approvalTaskIds: [],
      deniedTaskIds: [],
      blockedTaskIds: execution.status === "blocked" ? [queuedTask.id] : [],
      eventCount: events.length,
    };
  } catch (error) {
    return failRunningHeartbeatTask({
      employeeDir: input.employeeDir,
      task: runningTask,
      runId,
      runDir,
      failedAt: input.createdAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      logger: input.logger,
    });
  }
}

/** 将运行中异常收敛为 failed task 和 run state，避免下次 heartbeat 重复执行同一轮。 */
async function failRunningHeartbeatTask(input: {
  employeeDir: string;
  task: EmployeeTask;
  runId: string;
  runDir: string;
  failedAt: string;
  errorMessage: string;
  logger: SiliconLogger;
}): Promise<RunEmployeeHeartbeatResult> {
  await writeEmployeeTask(input.employeeDir, {
    ...input.task,
    schemaVersion: 1,
    status: "failed",
    updatedAt: input.failedAt,
    errorMessage: input.errorMessage,
    runHistory: [
      ...(input.task.runHistory ?? []),
      { runId: input.runId, status: "failed", finishedAt: input.failedAt },
    ],
  }, input.logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(input.runDir, ["state.json"], input.logger), `${JSON.stringify({
    schemaVersion: 1,
    runId: input.runId,
    taskId: input.task.id,
    status: "failed",
    startedAt: input.failedAt,
    finishedAt: input.failedAt,
    errorMessage: input.errorMessage,
  }, null, 2)}\n`, input.logger).catch(() => undefined);
  await appendHeartbeatEvent(input.employeeDir, {
    type: "blocked_task",
    createdAt: input.failedAt,
    taskId: input.task.id,
    runId: input.runId,
    message: `heartbeat 执行异常，任务已标记失败：${input.errorMessage}`,
  }, input.logger).catch(() => undefined);
  await appendMemoryEventAt({
    employeeDir: input.employeeDir,
    eventId: `memory-${input.runId}-failed`,
    type: "task_failed",
    subjectId: input.task.id,
    summary: `任务 ${input.task.id} 执行异常，已标记失败：${input.errorMessage}`,
    confidence: 1,
    sourcePath: join("runs", input.runId, "state.json").replaceAll("\\", "/"),
    createdAt: input.failedAt,
    logger: input.logger,
  }).catch(() => undefined);
  await updateEmployeeProfileStatus({
    employeeDir: input.employeeDir,
    status: "failed",
    updatedAt: input.failedAt,
    currentTaskId: input.task.id,
    currentRunId: input.runId,
    lastErrorMessage: input.errorMessage,
    logger: input.logger,
  }).catch(() => undefined);
  await recordHeartbeatTick({
    employeeDir: input.employeeDir,
    status: "failed",
    beatAt: input.failedAt,
    processed: 0,
    approvals: 0,
    denied: 0,
    events: 1,
    logger: input.logger,
  }).catch(() => undefined);
  input.logger.warn("硅基员工 heartbeat 执行异常，任务已写入 failed", {
    employeeDir: input.employeeDir,
    taskId: input.task.id,
    runId: input.runId,
    errorMessage: input.errorMessage,
  });
  return { processedTaskIds: [], approvalTaskIds: [], deniedTaskIds: [], blockedTaskIds: [input.task.id], eventCount: 1 };
}

/** 将 policy 禁止的任务写为 failed，并记录 heartbeat 控制事件。 */
async function failTaskForPolicy(
  employeeDir: string,
  task: EmployeeTask,
  timestamp: string,
  reason: string,
  logger: SiliconLogger,
): Promise<void> {
  await writeEmployeeTask(employeeDir, {
    ...task,
    schemaVersion: 1,
    status: "failed",
    updatedAt: timestamp,
    errorMessage: reason,
  }, logger);
  await updateEmployeeProfileStatus({ employeeDir, status: "failed", updatedAt: timestamp, currentTaskId: task.id, lastErrorMessage: reason, logger });
  await appendHeartbeatEvent(employeeDir, { type: "policy_denied", createdAt: timestamp, taskId: task.id, message: reason }, logger);
  await appendMemoryEventAt({
    employeeDir,
    eventId: `memory-${task.id}-policy-denied`,
    type: "policy_denied",
    subjectId: task.id,
    summary: reason,
    confidence: 1,
    sourcePath: join("inbox", `${task.id}.json`).replaceAll("\\", "/"),
    createdAt: timestamp,
    logger,
  });
  logger.warn("queued task 被 policy 禁止，已写入失败状态", { employeeDir, taskId: task.id, reason });
}

/** 按指定时间追加 memory 事件，保证 heartbeat 与 memory 时间线一致。 */
async function appendMemoryEventAt(input: {
  employeeDir: string;
  eventId: string;
  type: MemoryEventType;
  subjectId: string;
  summary: string;
  confidence: number;
  sourcePath: string;
  createdAt: string;
  logger: SiliconLogger;
}): Promise<void> {
  await appendMemoryEvent({
    employeeDir: input.employeeDir,
    eventId: input.eventId,
    type: input.type,
    subjectId: input.subjectId,
    summary: input.summary,
    confidence: input.confidence,
    sourcePath: input.sourcePath,
    now: () => new Date(input.createdAt),
    logger: input.logger,
  });
}

/** 构建单条 run 事件，保证事件 ID 稳定可重放。 */
function buildRunEvent(input: {
  index: number;
  runId: string;
  task: EmployeeTask;
  type: HeartbeatEventType;
  createdAt: string;
  message: string;
}): HeartbeatRunEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-${String(input.index).padStart(3, "0")}`,
    runId: input.runId,
    taskId: input.task.id,
    type: input.type,
    createdAt: input.createdAt,
    message: input.message,
  };
}

/** 追加 heartbeat 事件，并同步写入 runtime 日志作为平台级观测入口。 */
async function appendHeartbeatEvent(
  employeeDir: string,
  event: Record<string, unknown>,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  const heartbeatEvent = { schemaVersion: 1, ...event };
  assertHeartbeatEvent(heartbeatEvent);
  const payload = `${JSON.stringify(heartbeatEvent)}\n`;
  await writeFile(resolveEmployeeChildPath(employeeDir, ["heartbeat", "events.jsonl"], logger), payload, {
    encoding: "utf8",
    flag: "a",
  });
  await writeFile(resolveEmployeeChildPath(employeeDir, ["logs", "runtime.jsonl"], logger), payload, {
    encoding: "utf8",
    flag: "a",
  }).catch((error: unknown) => {
    logger.warn("追加 runtime 日志失败，heartbeat 事件仍已写入", {
      employeeDir,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  });
}
