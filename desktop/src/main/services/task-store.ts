/**
 * Task V2 无状态 CRUD 服务。
 *
 * 所有函数接收 Task[] 数组，返回新的数组（不修改原数组）。
 * 状态由 session.tasks 持有，本模块不保存任何自有状态。
 */

import { randomUUID } from "node:crypto";
import type { Task, TaskStatus } from "@shared/contracts";
import { buildTaskFingerprint, coalesceTasks } from "@shared/task-logical";

const MAX_TASKS_PER_SESSION = 200;

// ---------------------------------------------------------------------------
// Input 类型
// ---------------------------------------------------------------------------

export type TaskCreateInput = {
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status?: TaskStatus;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
};

export type TaskUpdateInput = {
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  status?: TaskStatus;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// 依赖检查
// ---------------------------------------------------------------------------

/** 检查指定任务是否被尚未完成的前置任务阻塞。 */
export function getUnfinishedBlockers(tasks: Task[], task: Task): Task[] {
  if (!task.blockedBy || task.blockedBy.length === 0) return [];
  return tasks.filter(
    (t) => task.blockedBy.includes(t.id) && t.status !== "completed",
  );
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** 创建新任务，返回更新后的数组和创建的任务对象。 */
export function createTask(
  tasks: Task[],
  input: TaskCreateInput,
): { tasks: Task[]; created: Task } {
  const compacted = coalesceTasks(tasks);
  const normalizedTasks = compacted.tasks;
  const inputFingerprint = buildTaskFingerprint(input);
  const existing = normalizedTasks.find(
    (task) => task.status !== "completed" && buildTaskFingerprint(task) === inputFingerprint,
  );
  if (existing) {
    console.info("[task-store] 复用已有逻辑任务，跳过重复创建", {
      taskId: existing.id,
      subject: existing.subject,
      fingerprint: inputFingerprint,
    });
    return { tasks: normalizedTasks, created: existing };
  }
  // 自动链式依赖：如果调用方未显式指定 blockedBy，则自动依赖数组中最后一个未完成的任务，
  // 保证默认按创建顺序逐个执行。传入 blockedBy: [] 表示显式无依赖。
  let resolvedBlockedBy = input.blockedBy;
  if (resolvedBlockedBy === undefined) {
    const lastPending = [...normalizedTasks].reverse().find((t) => t.status !== "completed");
    resolvedBlockedBy = lastPending ? [lastPending.id] : [];
  }

  const created: Task = {
    id: randomUUID().slice(0, 8),
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    owner: input.owner,
    status: input.status ?? "pending",
    blocks: input.blocks ?? [],
    blockedBy: resolvedBlockedBy,
    metadata: input.metadata,
  };

  let next = [...normalizedTasks, created];
  console.info("[task-store] 创建新任务", {
    taskId: created.id,
    subject: created.subject,
    blockedBy: created.blockedBy,
    total: next.length,
  });

  // 超出上限时淘汰已完成任务，若无则淘汰最早的任务
  if (next.length > MAX_TASKS_PER_SESSION) {
    const completedIdx = next.findIndex((t) => t.status === "completed");
    if (completedIdx >= 0) {
      next.splice(completedIdx, 1);
    } else {
      next.shift();
    }
  }

  return { tasks: next, created };
}

/** 列出所有任务（原样返回，不过滤）。 */
export function listTasks(tasks: Task[]): Task[] {
  const compacted = coalesceTasks(tasks).tasks;
  console.info("[task-store] 列出任务", {
    rawCount: tasks.length,
    compactedCount: compacted.length,
  });
  return compacted;
}

/** 按 ID 查询单个任务。 */
export function getTask(tasks: Task[], taskId: string): Task | null {
  const compacted = coalesceTasks(tasks);
  const resolvedTaskId = compacted.aliasMap[taskId] ?? taskId;
  const found = compacted.tasks.find((t) => t.id === resolvedTaskId) ?? null;
  console.info("[task-store] 查询任务", {
    requestedTaskId: taskId,
    resolvedTaskId,
    found: !!found,
  });
  return found;
}

/** 更新任务字段。设 status=in_progress 时自动 demote 其他 in_progress 任务。 */
export function updateTask(
  tasks: Task[],
  taskId: string,
  input: TaskUpdateInput,
): { tasks: Task[]; updated: Task } {
  const compacted = coalesceTasks(tasks);
  const resolvedTaskId = compacted.aliasMap[taskId] ?? taskId;
  const index = compacted.tasks.findIndex((t) => t.id === resolvedTaskId);
  if (index < 0) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const original = compacted.tasks[index]!;
  const updated: Task = {
    ...original,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.activeForm !== undefined ? { activeForm: input.activeForm } : {}),
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
    ...(input.blockedBy !== undefined ? { blockedBy: input.blockedBy } : {}),
    ...(input.metadata !== undefined
      ? { metadata: { ...original.metadata, ...input.metadata } }
      : {}),
  };

  let next = [...compacted.tasks];
  next[index] = updated;

  // 设为 in_progress 时：
  // 1. 校验 blockedBy 中所有前置任务是否已完成，未完成则拒绝
  // 2. 把其他 in_progress 任务降级为 pending
  if (input.status === "in_progress") {
    const blockers = getUnfinishedBlockers(next, updated);
    if (blockers.length > 0) {
      const blockerNames = blockers.map((b) => `"${b.subject}" (${b.id})`).join(", ");
      throw new Error(
        `无法开始任务 "${updated.subject}": 前置任务未完成 → ${blockerNames}。请按顺序先完成前置任务。`,
      );
    }
    next = next.map((t) =>
      t.id !== resolvedTaskId && t.status === "in_progress"
        ? { ...t, status: "pending" as const }
        : t,
    );
  }

  console.info("[task-store] 更新任务", {
    requestedTaskId: taskId,
    resolvedTaskId,
    status: updated.status,
    subject: updated.subject,
  });
  return { tasks: next, updated };
}

/** 新轮次开始时清理已完成的任务，保留 pending / in_progress。 */
export function clearCompletedTasks(tasks: Task[]): {
  tasks: Task[];
  cleared: number;
} {
  const compacted = coalesceTasks(tasks).tasks;
  const remaining = compacted.filter((t) => t.status !== "completed");
  console.info("[task-store] 清理已完成任务", {
    rawCount: tasks.length,
    compactedCount: compacted.length,
    cleared: compacted.length - remaining.length,
  });
  return {
    tasks: remaining,
    cleared: compacted.length - remaining.length,
  };
}
