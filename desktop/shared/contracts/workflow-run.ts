export const WorkflowRunStatus = {
  Queued: "queued",
  Running: "running",
  WaitingInput: "waiting-input",
  WaitingJoin: "waiting-join",
  RetryScheduled: "retry-scheduled",
  Succeeded: "succeeded",
  Failed: "failed",
  Canceled: "canceled",
} as const;

export type WorkflowRunStatus = (typeof WorkflowRunStatus)[keyof typeof WorkflowRunStatus];

export type WorkflowRunSummary = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  currentNodeIds: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
};
