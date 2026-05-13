import { readdir, readFile } from "node:fs/promises";

import type { CapabilityId } from "../policy/policy-engine.js";
import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { writeNewUtf8File, writeUtf8FileAtomically } from "./safe-file.js";
import { assertEmployeeTask, parseJsonRecord } from "./schema-guards.js";
import { upsertEmployeeTodoFromTask } from "./todo-store.js";

export type EmployeeTaskStatus =
  | "queued"
  | "waiting_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type EmployeeTaskRunHistoryEntry = {
  runId: string;
  status: "succeeded" | "blocked" | "failed";
  artifactPath?: string;
  reviewPath?: string;
  finishedAt: string;
};

export type EmployeeTask = {
  schemaVersion: 1;
  id: string;
  title: string;
  instruction: string;
  status: EmployeeTaskStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  requestedCapability?: CapabilityId;
  approvalId?: string;
  runId?: string;
  artifactPath?: string;
  reviewPath?: string;
  errorMessage?: string;
  runHistory?: EmployeeTaskRunHistoryEntry[];
};

export type CreateEmployeeTaskInput = {
  employeeDir: string;
  taskId: string;
  title: string;
  instruction: string;
  requestedCapability?: CapabilityId;
  now?: () => Date;
  logger?: SiliconLogger;
};

const TASK_ID_PATTERN = /^[a-z][a-z0-9-]{1,95}$/;

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 计算员工 inbox 中指定任务的稳定 JSON 文件路径。 */
export function resolveEmployeeTaskPath(
  employeeDir: string,
  taskId: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["inbox", `${taskId}.json`], logger);
}

/** 创建进入员工 inbox 的排队任务，并写入中文结构化日志。 */
export async function createEmployeeTask(input: CreateEmployeeTaskInput): Promise<EmployeeTask> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始创建硅基员工 inbox 任务", {
    employeeDir: input.employeeDir,
    taskId: input.taskId,
    title: input.title,
  });
  if (!TASK_ID_PATTERN.test(input.taskId)) {
    logger.warn("硅基员工任务 ID 校验失败", { taskId: input.taskId });
    throw new Error(`Invalid taskId: ${input.taskId}`);
  }

  const now = (input.now ?? (() => new Date()))().toISOString();
  const task: EmployeeTask = {
    schemaVersion: 1,
    id: input.taskId,
    title: input.title,
    instruction: input.instruction,
    status: "queued",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    runHistory: [],
  };
  if (input.requestedCapability) {
    task.requestedCapability = input.requestedCapability;
  }

  await writeEmployeeTask(input.employeeDir, task, logger, { createOnly: true });
  logger.info("硅基员工 inbox 任务已创建", {
    employeeDir: input.employeeDir,
    taskId: task.id,
    status: task.status,
  });
  return task;
}

/** 读取员工 inbox 中的任务 JSON，并返回结构化任务对象。 */
export async function readEmployeeTask(employeeDir: string, taskId: string): Promise<EmployeeTask> {
  const raw = await readFile(resolveEmployeeTaskPath(employeeDir, taskId), "utf8");
  const parsed = parseJsonRecord(raw, "EmployeeTask");
  assertEmployeeTask(parsed);
  return normalizeEmployeeTask(parsed);
}

/** 列出员工 inbox 内全部任务，供 CLI 和 daemon 管理面观察任务队列。 */
export async function listEmployeeTasks(
  employeeDir: string,
  logger: SiliconLogger = noopLogger,
): Promise<EmployeeTask[]> {
  logger.info("开始列出硅基员工 inbox 任务", { employeeDir });
  const inboxDir = resolveEmployeeChildPath(employeeDir, ["inbox"], logger);
  const entries = await readdir(inboxDir).catch(() => []);
  const tasks: EmployeeTask[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    const taskPath = resolveEmployeeChildPath(employeeDir, ["inbox", entry], logger);
    try {
      const raw = await readFile(taskPath, "utf8");
      const parsed = parseJsonRecord(raw, "EmployeeTask");
      assertEmployeeTask(parsed);
      tasks.push(normalizeEmployeeTask(parsed));
    } catch (error) {
      logger.warn("读取硅基员工 inbox 任务失败，已跳过坏任务文件", {
        employeeDir,
        taskPath,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info("硅基员工 inbox 任务已列出", { employeeDir, count: tasks.length });
  return tasks;
}

/** 将尚未完成的任务标记为取消，保留原始指令和可审计状态。 */
export async function cancelEmployeeTask(input: {
  employeeDir: string;
  taskId: string;
  now?: () => Date;
  logger?: SiliconLogger;
}): Promise<EmployeeTask> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始取消硅基员工任务", { employeeDir: input.employeeDir, taskId: input.taskId });
  const task = await readEmployeeTask(input.employeeDir, input.taskId);
  if (["succeeded", "failed", "blocked", "cancelled"].includes(task.status)) {
    logger.warn("硅基员工任务已处于终态，拒绝重复取消", {
      employeeDir: input.employeeDir,
      taskId: input.taskId,
      status: task.status,
    });
    throw new Error(`Task is already terminal: ${input.taskId}`);
  }
  const updated: EmployeeTask = {
    ...task,
    schemaVersion: 1,
    status: "cancelled",
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    errorMessage: "任务已由 CLI 手动取消。",
  };
  await writeEmployeeTask(input.employeeDir, updated, logger);
  logger.info("硅基员工任务已取消", { employeeDir: input.employeeDir, taskId: updated.id });
  return updated;
}

/** 将 failed、blocked、cancelled 任务重新放回 queued，复用原任务 ID 继续闭环。 */
export async function retryEmployeeTask(input: {
  employeeDir: string;
  taskId: string;
  now?: () => Date;
  logger?: SiliconLogger;
}): Promise<EmployeeTask> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始重试硅基员工任务", { employeeDir: input.employeeDir, taskId: input.taskId });
  const task = await readEmployeeTask(input.employeeDir, input.taskId);
  if (!["failed", "blocked", "cancelled"].includes(task.status)) {
    logger.warn("硅基员工任务不是可重试终态，拒绝重试", {
      employeeDir: input.employeeDir,
      taskId: input.taskId,
      status: task.status,
    });
    throw new Error(`Task is not retryable: ${input.taskId}`);
  }
  const updated: EmployeeTask = {
    ...task,
    schemaVersion: 1,
    status: "queued",
    attempt: (task.attempt ?? 1) + 1,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    approvalId: undefined,
    runId: undefined,
    artifactPath: undefined,
    reviewPath: undefined,
    errorMessage: undefined,
  };
  await writeEmployeeTask(input.employeeDir, updated, logger);
  logger.info("硅基员工任务已重新排队", { employeeDir: input.employeeDir, taskId: updated.id });
  return updated;
}

/** 覆盖写入员工任务 JSON，供 heartbeat 推进状态时复用。 */
export async function writeEmployeeTask(
  employeeDir: string,
  task: EmployeeTask,
  logger: SiliconLogger = noopLogger,
  options?: { createOnly?: boolean },
): Promise<void> {
  logger.info("写入硅基员工任务状态", {
    employeeDir,
    taskId: task.id,
    status: task.status,
  });
  const taskPath = resolveEmployeeTaskPath(employeeDir, task.id, logger);
  const normalizedTask = normalizeEmployeeTask(task);
  const payload = `${JSON.stringify({ ...normalizedTask, schemaVersion: 1 }, null, 2)}\n`;
  if (options?.createOnly) {
    await writeNewUtf8File(taskPath, payload, logger);
  } else {
    await writeUtf8FileAtomically(taskPath, payload, logger);
  }
  await upsertEmployeeTodoFromTask(employeeDir, { ...normalizedTask, schemaVersion: 1 }, logger);
}

/** 规范化历史任务记录，给旧数据补齐 attempt 和 runHistory 默认值。 */
function normalizeEmployeeTask(task: EmployeeTask): EmployeeTask {
  return {
    ...task,
    schemaVersion: 1,
    attempt: task.attempt ?? 1,
    runHistory: task.runHistory ?? [],
  };
}
