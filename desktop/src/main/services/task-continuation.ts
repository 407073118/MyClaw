import type { Task, TaskInterruptRequest } from "@shared/contracts";

export type TaskAutoContinuationOptions = {
  isWaitingForUserInput: boolean;
  isBackgroundHandoff: boolean;
  isPlanModeManagingExecution: boolean;
  continuationCount: number;
  maxContinuations: number;
  taskInterrupts?: TaskInterruptRequest[];
};

const AUTO_CONTINUATION_BLOCKING_STATUSES = new Set<Task["status"]>([
  "waiting_user",
  "blocked",
  "failed",
  "cancelled",
]);

const USER_WAITING_PATTERNS = [
  /请(?:你|您)?(?:选择|告诉|回复|确认|补充|提供|说明|澄清)/iu,
  /(?:帮我|麻烦)(?:选择|确认|补充|澄清)/iu,
  /(?:等待|等)(?:你|您|用户)?(?:的)?(?:回复|指示|确认|选择|补充|提交|输入)/iu,
  /需要(?:你|您|用户)?(?:回复|指示|确认|选择|补充|提交|输入)/iu,
  /(?:您的?|你(?:的)?)?(?:选择|偏好|需求|场景|技术栈|团队规模)/iu,
  /(?:是否|要不要|需不需要|希望|倾向|主要针对|主要用于)/iu,
  /\?\s*$/u,
  /？\s*$/u,
] as const;

const TASK_CONTINUATION_DEBUG_LOGGING = process.env.MYCLAW_DEBUG_TASK_CONTINUATION === "1";

/** 输出 Task V2 自动续行门禁调试日志，默认关闭以避免每轮响应刷屏。 */
function logTaskContinuationDebug(message: string, detail?: Record<string, unknown>): void {
  if (!TASK_CONTINUATION_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

/** 统一判定 Task V2 是否允许自动续跑，所有 runtime 分支必须走这里。 */
export function canAutoContinueTaskChain(
  tasks: Task[],
  options: TaskAutoContinuationOptions,
): { allowed: boolean; reason: string } {
  const activeInterrupt = options.taskInterrupts?.find((request) => request.status === "active");
  if (activeInterrupt) {
    logTaskContinuationDebug("[task-continuation] 自动续跑被 active interrupt 门禁拦截", {
      taskId: activeInterrupt.taskId,
      requestId: activeInterrupt.requestId,
    });
    return { allowed: false, reason: "active_task_interrupt" };
  }

  const blockingTask = tasks.find((task) => AUTO_CONTINUATION_BLOCKING_STATUSES.has(task.status));
  if (blockingTask) {
    logTaskContinuationDebug("[task-continuation] 自动续跑被任务状态门禁拦截", {
      taskId: blockingTask.id,
      status: blockingTask.status,
    });
    return { allowed: false, reason: `task_${blockingTask.status}` };
  }
  if (options.isWaitingForUserInput) {
    logTaskContinuationDebug("[task-continuation] 自动续跑被模型等待用户输入门禁拦截");
    return { allowed: false, reason: "assistant_waiting_for_user_input" };
  }
  if (options.isBackgroundHandoff) {
    logTaskContinuationDebug("[task-continuation] 自动续跑被后台交接门禁拦截");
    return { allowed: false, reason: "background_handoff" };
  }
  if (options.isPlanModeManagingExecution) {
    logTaskContinuationDebug("[task-continuation] 自动续跑被 Plan Mode 门禁拦截");
    return { allowed: false, reason: "plan_mode_managing_execution" };
  }
  if (options.continuationCount >= options.maxContinuations) {
    logTaskContinuationDebug("[task-continuation] 自动续跑达到次数上限", {
      continuationCount: options.continuationCount,
      maxContinuations: options.maxContinuations,
    });
    return { allowed: false, reason: "continuation_limit_reached" };
  }

  const runnable = tasks.some((task) => task.status === "pending" || task.status === "in_progress");
  if (!runnable) {
    logTaskContinuationDebug("[task-continuation] 自动续跑没有可运行任务", { total: tasks.length });
    return { allowed: false, reason: "no_runnable_task" };
  }

  logTaskContinuationDebug("[task-continuation] 自动续跑通过统一门禁", { total: tasks.length });
  return { allowed: true, reason: "runnable_task_available" };
}

/** 判断助手回复是否正在等待用户补充信息或做选择。 */
export function isAssistantWaitingForUserInput(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  if (/```a2ui\s*[\s\S]*?```/iu.test(normalized)) {
    logTaskContinuationDebug("[task-continuation] 检测到 A2UI 结构化表单，进入等待用户状态");
    return true;
  }
  const matched = USER_WAITING_PATTERNS.some((pattern) => pattern.test(normalized));
  if (matched) {
    logTaskContinuationDebug("[task-continuation] 检测到澄清/选择类回复，进入等待用户状态", {
      preview: normalized.slice(0, 120),
    });
  }
  return matched;
}

/** 只返回可由模型继续自动推进的任务，等待用户的任务必须等下一条用户消息恢复。 */
export function getContinuableTasks(tasks: Task[]): Task[] {
  const blockingTask = tasks.find((task) => AUTO_CONTINUATION_BLOCKING_STATUSES.has(task.status));
  if (blockingTask) {
    logTaskContinuationDebug("[task-continuation] 检测到阻塞自动续行的任务，暂停自动续行", {
      total: tasks.length,
      waitingUser: tasks.filter((task) => task.status === "waiting_user").length,
      blockingTaskId: blockingTask.id,
      blockingStatus: blockingTask.status,
    });
    return [];
  }

  const continuable = tasks.filter((task) => task.status === "pending" || task.status === "in_progress");
  logTaskContinuationDebug("[task-continuation] 计算可自动续行任务", {
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
    logTaskContinuationDebug("[task-continuation] 没有需要切换为等待用户的任务", { reason });
    return { tasks, changed: false };
  }

  const targetSet = new Set(targetIds);
  const nextTasks = tasks.map((task) => {
    if (!targetSet.has(task.id)) return task;
    return {
      ...task,
      status: "waiting_user" as const,
      activeForm: `需要你回复：${task.subject}`,
      metadata: {
        ...(task.metadata ?? {}),
        awaitingUser: true,
        waitingReason: reason,
      },
    };
  });

  logTaskContinuationDebug("[task-continuation] 已将任务切换为等待用户", {
    taskIds: targetIds,
    reason,
  });
  return { tasks: nextTasks, changed: true };
}
