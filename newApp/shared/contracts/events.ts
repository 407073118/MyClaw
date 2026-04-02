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

export type RuntimeEvent<TPayload = Record<string, unknown>> = {
  id: string;
  type: EventType;
  createdAt: string;
  payload: TPayload;
};
