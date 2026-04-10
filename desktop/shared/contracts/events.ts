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
  /** 上下文压缩次数过多，建议用户新建对话 */
  ContextLimitWarning = "context.limit_warning",
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

export type SiliconPersonStatus =
  | "idle"
  | "running"
  | "needs_approval"
  | "done"
  | "error"
  | "canceling"
  | "canceled";

export const SILICON_PERSON_STATUS_VALUES = [
  "idle",
  "running",
  "needs_approval",
  "done",
  "error",
  "canceling",
  "canceled",
] as const satisfies readonly SiliconPersonStatus[];

export type RuntimeEvent<TPayload = Record<string, unknown>> = {
  id: string;
  type: EventType;
  createdAt: string;
  payload: TPayload;
};
