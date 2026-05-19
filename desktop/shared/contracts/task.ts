/** Task V2 状态枚举。 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "waiting_user"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";

export const TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "waiting_user",
  "blocked",
  "failed",
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatus[];

export type TaskInterruptAction = "submit" | "approve" | "reject" | "cancel";

export type TaskInterruptRequest = {
  requestId: string;
  taskId: string;
  status: "active" | "resolved" | "expired" | "cancelled";
  reason: string;
  question: string;
  inputSchema?: Record<string, unknown>;
  choices?: Array<{ label: string; value: string; description?: string }>;
  resumeToken: string;
  schemaVersion: 1;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
};

export type TaskResumeInput = {
  requestId: string;
  taskId: string;
  resumeToken: string;
  action: TaskInterruptAction;
  payload?: unknown;
};

/** Task V2: session-scoped 任务追踪，独立于 Plan Mode。 */
export type Task = {
  id: string;
  subject: string;
  description: string;
  /** 执行中的进行时表述，如 "正在运行测试"。 */
  activeForm?: string;
  /** 任务归属（预留给多 agent 场景）。 */
  owner?: string;
  status: TaskStatus;
  /** 该任务阻塞的其他任务 ID 列表。 */
  blocks: string[];
  /** 阻塞该任务的其他任务 ID 列表。 */
  blockedBy: string[];
  /** 任意扩展元数据。 */
  metadata?: Record<string, unknown>;
};
