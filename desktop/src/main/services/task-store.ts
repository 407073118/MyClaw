/**
 * Task V2 无状态 CRUD 服务。
 *
 * 所有函数接收 Task[] 数组，返回新的数组（不修改原数组）。
 * 状态由 session.tasks 持有，本模块不保存任何自有状态。
 */

import { randomUUID } from "node:crypto";
import type { Task, TaskStatus } from "@shared/contracts";

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
// CRUD
// ---------------------------------------------------------------------------

/** 创建新任务，返回更新后的数组和创建的任务对象。 */
export function createTask(
  tasks: Task[],
  input: TaskCreateInput,
): { tasks: Task[]; created: Task } {
  const created: Task = {
    id: randomUUID().slice(0, 8),
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    owner: input.owner,
    status: input.status ?? "pending",
    blocks: input.blocks ?? [],
    blockedBy: input.blockedBy ?? [],
    metadata: input.metadata,
  };

  let next = [...tasks, created];

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
  return tasks;
}

/** 按 ID 查询单个任务。 */
export function getTask(tasks: Task[], taskId: string): Task | null {
  return tasks.find((t) => t.id === taskId) ?? null;
}

/** 更新任务字段。设 status=in_progress 时自动 demote 其他 in_progress 任务。 */
export function updateTask(
  tasks: Task[],
  taskId: string,
  input: TaskUpdateInput,
): { tasks: Task[]; updated: Task } {
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index < 0) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const original = tasks[index]!;
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

  let next = [...tasks];
  next[index] = updated;

  // 设为 in_progress 时，把其他 in_progress 任务降级为 pending
  if (input.status === "in_progress") {
    next = next.map((t) =>
      t.id !== taskId && t.status === "in_progress"
        ? { ...t, status: "pending" as const }
        : t,
    );
  }

  return { tasks: next, updated };
}

/** 新轮次开始时清理已完成的任务，保留 pending / in_progress。 */
export function clearCompletedTasks(tasks: Task[]): {
  tasks: Task[];
  cleared: number;
} {
  const remaining = tasks.filter((t) => t.status !== "completed");
  return {
    tasks: remaining,
    cleared: tasks.length - remaining.length,
  };
}
