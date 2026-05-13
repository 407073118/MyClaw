import { readdir, readFile } from "node:fs/promises";

import type { CapabilityId } from "../policy/policy-engine.js";
import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { assertScheduledTask, parseJsonRecord } from "./schema-guards.js";
import { writeNewUtf8File, writeUtf8FileAtomically } from "./safe-file.js";
import { createEmployeeTask, readEmployeeTask } from "./task-store.js";

export type ScheduledTaskStatus = "scheduled" | "dispatched" | "cancelled";

export type ScheduledTask = {
  schemaVersion: 1;
  id: string;
  title: string;
  instruction: string;
  dueAt: string;
  status: ScheduledTaskStatus;
  createdAt: string;
  updatedAt: string;
  requestedCapability?: CapabilityId;
  dispatchedTaskId?: string;
};

export type CreateScheduledTaskInput = {
  employeeDir: string;
  scheduleId: string;
  title: string;
  instruction: string;
  dueAt: string;
  requestedCapability?: CapabilityId;
  now?: () => Date;
  logger?: SiliconLogger;
};

const SCHEDULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,95}$/;

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 计算员工 scheduled task 的稳定 JSON 文件路径。 */
export function resolveScheduledTaskPath(
  employeeDir: string,
  scheduleId: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["schedules", `${scheduleId}.json`], logger);
}

/** 创建员工定时任务，作为 7x24 自治循环的任务来源。 */
export async function createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始创建硅基员工定时任务", {
    employeeDir: input.employeeDir,
    scheduleId: input.scheduleId,
    dueAt: input.dueAt,
  });
  if (!SCHEDULE_ID_PATTERN.test(input.scheduleId)) {
    logger.warn("硅基员工定时任务 ID 校验失败", { scheduleId: input.scheduleId });
    throw new Error(`Invalid scheduleId: ${input.scheduleId}`);
  }
  assertValidDueAt(input.dueAt, logger);
  const now = (input.now ?? (() => new Date()))().toISOString();
  const scheduledTask: ScheduledTask = {
    schemaVersion: 1,
    id: input.scheduleId,
    title: input.title,
    instruction: input.instruction,
    dueAt: input.dueAt,
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
  };
  if (input.requestedCapability) {
    scheduledTask.requestedCapability = input.requestedCapability;
  }
  await writeScheduledTask(input.employeeDir, scheduledTask, logger, { createOnly: true });
  logger.info("硅基员工定时任务已创建", {
    employeeDir: input.employeeDir,
    scheduleId: scheduledTask.id,
    status: scheduledTask.status,
  });
  return scheduledTask;
}

/** 读取员工定时任务 JSON。 */
export async function readScheduledTask(employeeDir: string, scheduleId: string): Promise<ScheduledTask> {
  const raw = await readFile(resolveScheduledTaskPath(employeeDir, scheduleId), "utf8");
  const parsed = parseJsonRecord(raw, "ScheduledTask");
  assertScheduledTask(parsed);
  return parsed;
}

/** 列出员工所有定时任务，供 CLI 和 daemon 观测。 */
export async function listEmployeeSchedules(employeeDir: string): Promise<ScheduledTask[]> {
  return listScheduledTasks(employeeDir);
}

/** 取消尚未派发的定时任务，保留 schedule 记录供后续复盘。 */
export async function cancelScheduledTask(input: {
  employeeDir: string;
  scheduleId: string;
  now?: () => Date;
  logger?: SiliconLogger;
}): Promise<ScheduledTask> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始取消硅基员工定时任务", { employeeDir: input.employeeDir, scheduleId: input.scheduleId });
  const schedule = await readScheduledTask(input.employeeDir, input.scheduleId);
  if (schedule.status !== "scheduled") {
    logger.warn("硅基员工定时任务不是 scheduled 状态，拒绝取消", {
      employeeDir: input.employeeDir,
      scheduleId: input.scheduleId,
      status: schedule.status,
    });
    throw new Error(`Schedule is not cancellable: ${input.scheduleId}`);
  }
  const updated: ScheduledTask = {
    ...schedule,
    schemaVersion: 1,
    status: "cancelled",
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
  await writeScheduledTask(input.employeeDir, updated, logger);
  logger.info("硅基员工定时任务已取消", { employeeDir: input.employeeDir, scheduleId: updated.id });
  return updated;
}

/** 写入员工定时任务 JSON，并记录中文状态日志。 */
export async function writeScheduledTask(
  employeeDir: string,
  scheduledTask: ScheduledTask,
  logger: SiliconLogger = noopLogger,
  options?: { createOnly?: boolean },
): Promise<void> {
  logger.info("写入硅基员工定时任务状态", {
    employeeDir,
    scheduleId: scheduledTask.id,
    status: scheduledTask.status,
    dueAt: scheduledTask.dueAt,
  });
  const schedulePath = resolveScheduledTaskPath(employeeDir, scheduledTask.id, logger);
  const payload = `${JSON.stringify({ ...scheduledTask, schemaVersion: 1 }, null, 2)}\n`;
  if (options?.createOnly) {
    await writeNewUtf8File(schedulePath, payload, logger);
  } else {
    await writeUtf8FileAtomically(schedulePath, payload, logger);
  }
}

/** 扫描到期定时任务并投递为 inbox task。 */
export async function dispatchDueScheduledTasks(input: {
  employeeDir: string;
  now?: () => Date;
  logger?: SiliconLogger;
}): Promise<ScheduledTask[]> {
  const logger = input.logger ?? noopLogger;
  const now = (input.now ?? (() => new Date()))();
  logger.info("开始扫描硅基员工到期定时任务", {
    employeeDir: input.employeeDir,
    now: now.toISOString(),
  });
  const schedules = await listScheduledTasks(input.employeeDir);
  const dispatched: ScheduledTask[] = [];
  for (const schedule of schedules) {
    const dueAtMs = Date.parse(schedule.dueAt);
    if (!Number.isFinite(dueAtMs)) {
      logger.warn("硅基员工定时任务 dueAt 非法，跳过派发", {
        employeeDir: input.employeeDir,
        scheduleId: schedule.id,
        dueAt: schedule.dueAt,
      });
      continue;
    }
    if (schedule.status !== "scheduled" || dueAtMs > now.getTime()) {
      continue;
    }
    const taskId = `task-${schedule.id}`;
    await createEmployeeTask({
      employeeDir: input.employeeDir,
      taskId,
      title: schedule.title,
      instruction: schedule.instruction,
      requestedCapability: schedule.requestedCapability,
      now: () => now,
      logger,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("EEXIST")) {
        logger.warn("定时任务派发目标 task 已存在，按已派发处理", {
          employeeDir: input.employeeDir,
          scheduleId: schedule.id,
          taskId,
        });
        return undefined;
      }
      throw error;
    });
    await validateExistingDispatchedTask(input.employeeDir, schedule, taskId, logger);
    const updated: ScheduledTask = {
      ...schedule,
      schemaVersion: 1,
      status: "dispatched",
      dispatchedTaskId: taskId,
      updatedAt: now.toISOString(),
    };
    await writeScheduledTask(input.employeeDir, updated, logger);
    dispatched.push(updated);
  }
  logger.info("硅基员工到期定时任务扫描完成", {
    employeeDir: input.employeeDir,
    dispatchedCount: dispatched.length,
  });
  return dispatched;
}

/** 列出员工 schedules 目录中的所有定时任务。 */
async function listScheduledTasks(employeeDir: string, logger: SiliconLogger = noopLogger): Promise<ScheduledTask[]> {
  const schedulesDir = resolveEmployeeChildPath(employeeDir, ["schedules"], logger);
  const entries = await readdir(schedulesDir).catch(() => []);
  const schedules: ScheduledTask[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    const schedulePath = resolveEmployeeChildPath(employeeDir, ["schedules", entry], logger);
    try {
      const raw = await readFile(schedulePath, "utf8");
      const parsed = parseJsonRecord(raw, "ScheduledTask");
      assertScheduledTask(parsed);
      schedules.push(parsed);
    } catch (error) {
      logger.warn("读取硅基员工定时任务失败，已跳过坏定时任务文件", {
        employeeDir,
        schedulePath,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return schedules;
}

/** 校验定时任务 dueAt 必须是可解析的 ISO 时间。 */
/** 校验 schedule 派发目标 task 与 schedule 内容一致，避免同名任务被误认作已派发。 */
async function validateExistingDispatchedTask(
  employeeDir: string,
  schedule: ScheduledTask,
  taskId: string,
  logger: SiliconLogger,
): Promise<void> {
  const task = await readEmployeeTask(employeeDir, taskId);
  if (
    task.title !== schedule.title
    || task.instruction !== schedule.instruction
    || task.requestedCapability !== schedule.requestedCapability
  ) {
    logger.warn("定时任务派发目标 task 与 schedule 不一致，拒绝标记为已派发", {
      employeeDir,
      scheduleId: schedule.id,
      taskId,
    });
    throw new Error(`Schedule dispatch target task mismatch: ${schedule.id}`);
  }
}

function assertValidDueAt(dueAt: string, logger: SiliconLogger): void {
  logger.info("开始校验硅基员工定时任务 dueAt", { dueAt });
  const timestamp = Date.parse(dueAt);
  if (!Number.isFinite(timestamp)) {
    logger.warn("硅基员工定时任务 dueAt 校验失败", { dueAt });
    throw new Error(`Invalid dueAt: ${dueAt}`);
  }
}
