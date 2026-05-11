import type { Task } from "@shared/contracts";

const USER_WAITING_PATTERNS = [
  /请(?:你|您)?(?:选择|告诉|回复|确认|补充|提供|说明|澄清)/iu,
  /(?:帮我|麻烦)(?:选择|确认|补充|澄清)/iu,
  /(?:您的?|你(?:的)?)?(?:选择|偏好|需求|场景|技术栈|团队规模)/iu,
  /(?:是否|要不要|需不需要|希望|倾向|主要针对|主要用于)/iu,
  /\?\s*$/u,
  /？\s*$/u,
] as const;

/** 判断助手回复是否正在等待用户补充信息或做选择。 */
export function isAssistantWaitingForUserInput(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  if (/```a2ui\s*[\s\S]*?```/iu.test(normalized)) {
    console.info("[task-continuation] 检测到 A2UI 结构化表单，进入等待用户状态");
    return true;
  }
  const matched = USER_WAITING_PATTERNS.some((pattern) => pattern.test(normalized));
  if (matched) {
    console.info("[task-continuation] 检测到澄清/选择类回复，进入等待用户状态", {
      preview: normalized.slice(0, 120),
    });
  }
  return matched;
}

/** 只返回可由模型继续自动推进的任务，等待用户的任务必须等下一条用户消息恢复。 */
export function getContinuableTasks(tasks: Task[]): Task[] {
  const continuable = tasks.filter((task) => task.status === "pending" || task.status === "in_progress");
  console.info("[task-continuation] 计算可自动续行任务", {
    total: tasks.length,
    continuable: continuable.length,
  });
  return continuable;
}

/** 将当前活跃任务标记为等待用户，避免澄清问题触发自动续行。 */
export function markActiveTasksWaitingForUser(
  tasks: Task[],
  reason: string,
): { tasks: Task[]; changed: boolean } {
  const activeIds = tasks
    .filter((task) => task.status === "in_progress")
    .map((task) => task.id);
  const targetIds = activeIds.length > 0
    ? activeIds
    : tasks.find((task) => task.status === "pending")
      ? [tasks.find((task) => task.status === "pending")!.id]
      : [];

  if (targetIds.length === 0) {
    console.info("[task-continuation] 没有需要切换为等待用户的任务", { reason });
    return { tasks, changed: false };
  }

  const targetSet = new Set(targetIds);
  const nextTasks = tasks.map((task) => {
    if (!targetSet.has(task.id)) return task;
    return {
      ...task,
      status: "waiting_user" as const,
      activeForm: `等待用户补充：${task.subject}`,
      metadata: {
        ...(task.metadata ?? {}),
        awaitingUser: true,
        waitingReason: reason,
      },
    };
  });

  console.info("[task-continuation] 已将任务切换为等待用户", {
    taskIds: targetIds,
    reason,
  });
  return { tasks: nextTasks, changed: true };
}
