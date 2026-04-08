/** Task V2 状态枚举。 */
export type TaskStatus = "pending" | "in_progress" | "completed";

export const TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "completed",
] as const satisfies readonly TaskStatus[];

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
