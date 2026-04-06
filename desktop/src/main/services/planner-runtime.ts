import type { PlanState, PlanTask, PlanTaskId, PlanTaskStatus } from "@shared/contracts";
import { PLAN_TASK_STATUS_VALUES } from "@shared/contracts";

type KnownPlanTaskStatus = (typeof PLAN_TASK_STATUS_VALUES)[number];

export type PlannerStatus = KnownPlanTaskStatus;

export type PlanTaskSeed = Pick<PlanTask, "id" | "title"> & Partial<Pick<PlanTask, "status" | "detail" | "blocker">>;

export type UpdatePlanTaskStatusInput = {
  taskId: PlanTaskId;
  status: KnownPlanTaskStatus;
  detail?: string | null;
  blocker?: string | null;
  now?: string;
};

const KNOWN_PLAN_TASK_STATUS_SET = new Set<KnownPlanTaskStatus>(PLAN_TASK_STATUS_VALUES);

const ALLOWED_PLAN_TASK_TRANSITIONS: Record<KnownPlanTaskStatus, readonly KnownPlanTaskStatus[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["pending", "completed", "blocked"],
  completed: [],
  blocked: ["pending", "in_progress"],
};

function resolveTimestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function asKnownPlanTaskStatus(status: PlanTaskStatus, context: string): KnownPlanTaskStatus {
  if (KNOWN_PLAN_TASK_STATUS_SET.has(status as KnownPlanTaskStatus)) {
    return status as KnownPlanTaskStatus;
  }

  throw new Error(`Unsupported planner task status "${status}" in ${context}`);
}

function getKnownPlanTaskStatus(status: PlanTaskStatus): KnownPlanTaskStatus | null {
  return KNOWN_PLAN_TASK_STATUS_SET.has(status as KnownPlanTaskStatus)
    ? status as KnownPlanTaskStatus
    : null;
}

function canTransitionTaskStatus(
  currentStatus: KnownPlanTaskStatus,
  nextStatus: KnownPlanTaskStatus,
): boolean {
  if (currentStatus === nextStatus) return true;
  return ALLOWED_PLAN_TASK_TRANSITIONS[currentStatus].includes(nextStatus);
}

function applyTaskTextFields(
  existingTask: PlanTask,
  input: UpdatePlanTaskStatusInput,
): PlanTask {
  const nextTask = { ...(existingTask as PlanTask & Record<string, unknown>) } as PlanTask & Record<string, unknown>;

  const nextDetail = input.detail === undefined ? existingTask.detail : input.detail;
  if (nextDetail === null) {
    delete nextTask.detail;
  } else if (nextDetail !== undefined) {
    nextTask.detail = nextDetail;
  }

  if (input.status === "blocked") {
    const nextBlocker = input.blocker === undefined ? existingTask.blocker : input.blocker;
    if (nextBlocker === null) {
      delete nextTask.blocker;
    } else if (nextBlocker !== undefined) {
      nextTask.blocker = nextBlocker;
    }
    return nextTask;
  }

  if (input.blocker === null) {
    delete nextTask.blocker;
  } else if (input.blocker !== undefined) {
    nextTask.blocker = input.blocker;
  }

  return nextTask;
}

/** 初始化最小计划状态，未显式给出的任务默认从 pending 开始；未知状态保留给后续兼容层处理。 */
export function createPlanState(tasks: PlanTaskSeed[], now?: string): PlanState {
  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status ?? "pending",
      ...(task.detail ? { detail: task.detail } : {}),
      ...(task.blocker ? { blocker: task.blocker } : {}),
    })),
    updatedAt: resolveTimestamp(now),
  };
}

/** 更新单个任务状态，并确保只允许最小可解释的状态迁移。 */
export function updateTaskStatus(
  planState: PlanState,
  input: UpdatePlanTaskStatusInput,
): PlanState {
  let matchedTask = false;

  const nextTasks = planState.tasks.map((task) => {
    if (task.id !== input.taskId) return task;

    matchedTask = true;
    const currentStatus = getKnownPlanTaskStatus(task.status);

    if (currentStatus !== null && !canTransitionTaskStatus(currentStatus, input.status)) {
      throw new Error(`Invalid planner task transition: ${currentStatus} -> ${input.status}`);
    }

    const nextTask = applyTaskTextFields(task, input) as PlanTask & Record<string, unknown>;
    nextTask.status = input.status;
    return nextTask as PlanTask;
  });

  if (!matchedTask) {
    throw new Error(`Planner task not found: ${input.taskId}`);
  }

  return {
    tasks: nextTasks,
    updatedAt: resolveTimestamp(input.now),
  };
}

/** 全局 planner 状态不额外持久化，而是由任务集合推导，避免 Task 2 提前扩大 PlanState 契约。 */
export function derivePlannerStatus(planState: PlanState): PlannerStatus {
  if (planState.tasks.length === 0) return "completed";

  // 未知未来状态按“未完成但可恢复”处理，避免旧 runtime 在读取新持久化数据时崩溃。
  const taskStatuses = planState.tasks.map((task) => getKnownPlanTaskStatus(task.status));

  if (taskStatuses.every((status) => status === "completed")) return "completed";
  if (taskStatuses.some((status) => status === "in_progress")) return "in_progress";

  const remainingStatuses = taskStatuses.filter((status) => status !== null && status !== "completed");
  if (remainingStatuses.length > 0 && remainingStatuses.every((status) => status === "blocked")) {
    return "blocked";
  }

  return "pending";
}

export function startTask(
  planState: PlanState,
  taskId: PlanTaskId,
  detail?: string,
  now?: string,
): PlanState {
  return updateTaskStatus(planState, {
    taskId,
    status: "in_progress",
    detail,
    blocker: null,
    now,
  });
}

export function completeTask(
  planState: PlanState,
  taskId: PlanTaskId,
  detail?: string,
  now?: string,
): PlanState {
  return updateTaskStatus(planState, {
    taskId,
    status: "completed",
    detail,
    blocker: null,
    now,
  });
}

export function blockTask(
  planState: PlanState,
  taskId: PlanTaskId,
  blocker: string,
  now?: string,
  detail?: string,
): PlanState {
  return updateTaskStatus(planState, {
    taskId,
    status: "blocked",
    blocker,
    detail,
    now,
  });
}
