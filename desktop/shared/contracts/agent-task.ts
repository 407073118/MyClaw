export type AgentTaskMode = "speak" | "delegate" | "review" | "broadcast";

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentTask = {
  id: string;
  sourceSessionId: string;
  title: string;
  instruction: string;
  mode: AgentTaskMode;
  status: AgentTaskStatus;
  assigneeIds: string[];
  assigneeStatuses?: Partial<Record<string, AgentTaskStatus>>;
  childSessionIds: Record<string, string>;
  resultSummary?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentTaskCreateInput = {
  sourceSessionId: string;
  title?: string;
  instruction: string;
  mode?: AgentTaskMode;
  assigneeIds: string[];
};
