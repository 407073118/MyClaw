export enum EventType {
  SessionUpdated = "session.updated",
  MessageDelta = "message.delta",
  MessageCompleted = "message.completed",
  RunStarted = "run.started",
  ApprovalRequested = "approval.requested",
  ApprovalResolved = "approval.resolved",
  ToolStarted = "tool.started",
  ToolCompleted = "tool.completed",
  ToolFailed = "tool.failed",
  RuntimeStatus = "runtime.status",
  TasksUpdated = "tasks.updated",
}

export enum ToolRiskCategory {
  Read = "read",
  Write = "write",
  Exec = "exec",
  Install = "install",
  Network = "network",
}

export enum ScopeKind {
  Global = "global",
  Session = "session",
  Workspace = "workspace",
  Agent = "agent",
}

export type ChatRunPhase =
  | "planning"
  | "model"
  | "approval"
  | "tools"
  | "persisting";

export const CHAT_RUN_PHASE_VALUES = [
  "planning",
  "model",
  "approval",
  "tools",
  "persisting",
] as const satisfies readonly ChatRunPhase[];

export type ChatRunStatus =
  | "running"
  | "canceling"
  | "canceled"
  | "completed"
  | "failed";

export const CHAT_RUN_STATUS_VALUES = [
  "running",
  "canceling",
  "canceled",
  "completed",
  "failed",
] as const satisfies readonly ChatRunStatus[];

export type ChatRunRuntimeStatusPayload = {
  sessionId: string;
  runId: string;
  status: ChatRunStatus;
  phase: ChatRunPhase;
  messageId?: string;
  reason?: string;
};

export type RuntimeEvent<TPayload = Record<string, unknown>> = {
  id: string;
  type: EventType;
  createdAt: string;
  payload: TPayload;
};
