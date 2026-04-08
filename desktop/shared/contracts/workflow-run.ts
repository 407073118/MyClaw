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
  totalSteps?: number;
  error?: string;
};

export type WorkflowCheckpointSummary = {
  checkpointId: string;
  step: number;
  status: "running" | "interrupted" | "succeeded" | "failed";
  triggeredNodes: string[];
  durationMs: number;
  createdAt: string;
  interruptPayload?: WorkflowInterruptPayload;
};

export type WorkflowInterruptPayload = {
  type: "input" | "approval" | "review";
  nodeId: string;
  formKey: string;
  prompt: string;
  currentState: Record<string, unknown>;
};
