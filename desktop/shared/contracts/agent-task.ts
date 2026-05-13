export type AgentTaskMode = "ask" | "speak" | "delegate" | "review" | "broadcast";

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentTaskAppendStatus =
  | "not_appended"
  | "appending"
  | "appended"
  | "failed";

export type AgentTask = {
  id: string;
  sourceSessionId: string;
  sourceMessageId?: string;
  parentTaskId?: string;
  title: string;
  instruction: string;
  mode: AgentTaskMode;
  status: AgentTaskStatus;
  assigneeIds: string[];
  leadAssigneeId?: string;
  assigneeStatuses?: Partial<Record<string, AgentTaskStatus>>;
  assigneeResultSummaries?: Partial<Record<string, string>>;
  childSessionIds: Record<string, string>;
  resultSummary?: string | null;
  error?: string | null;
  appendStatus?: AgentTaskAppendStatus;
  appendedToSourceSessionAt?: string | null;
  appendedMessageId?: string | null;
  approvalIds?: string[];
  contextPolicy?: {
    includeLastMessages: number;
    includeArtifacts: boolean;
    includeSelectedFiles: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

export type AgentTaskCreateInput = {
  sourceSessionId: string;
  sourceMessageId?: string;
  parentTaskId?: string;
  title?: string;
  instruction: string;
  mode?: AgentTaskMode;
  assigneeIds: string[];
  contextPolicy?: {
    includeLastMessages?: number;
    includeArtifacts?: boolean;
    includeSelectedFiles?: boolean;
  };
};
