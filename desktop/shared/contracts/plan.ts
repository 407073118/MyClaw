/** 任务 id 需要跨多轮规划/持久化保持稳定，便于可靠追踪同一任务。 */
export type PlanTaskId = string;

export type PlanTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | (string & {});

export const PLAN_TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
] as const satisfies readonly PlanTaskStatus[];

export type PlanTask = {
  id: PlanTaskId;
  title: string;
  status: PlanTaskStatus;
  detail?: string;
  blocker?: string;
};

export type PlanState = {
  tasks: PlanTask[];
  updatedAt: string;
};
