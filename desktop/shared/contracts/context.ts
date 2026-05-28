import type { ChatMessageRole } from "./session";

export type ContextCompactionTrigger =
  | "token_threshold"
  | "message_count"
  | "large_tool_output"
  | "phase_transition"
  | "manual";

export type ContextCompactionStrategy =
  | "exact_keep"
  | "tool_mask"
  | "checkpoint"
  | "memory_retrieve"
  | "provider_native"
  | "prompt_compress";

export type ContextCheckpointToolOutcome = {
  tool: string;
  summary: string;
  sourceMessageIds: string[];
};

export type ContextCheckpoint = {
  id: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  taskGoal: string;
  currentPhase: string;
  completedActions: string[];
  activeAssumptions: string[];
  decisions: string[];
  touchedFiles: string[];
  toolOutcomes: ContextCheckpointToolOutcome[];
  openItems: string[];
  blockers: string[];
  nextGoal: string;
  sourceMessageIds: string[];
  checksum: string;
  /** 兼容旧测试和旧 UI 的摘要字段，后续可由结构化字段替代。 */
  summary?: string;
  /** 兼容旧 checkpoint 服务的近期轮次数。 */
  recentTurnCount?: number;
  /** 兼容旧 checkpoint 服务的目标列表。 */
  goals?: string[];
  /** 兼容旧 checkpoint 服务的约束列表。 */
  constraints?: string[];
};

export type ContextCompactionMetadata = {
  id: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  trigger: ContextCompactionTrigger;
  strategy: ContextCompactionStrategy[];
  budgetUsed: number;
  budgetLimit: number;
  removedMessageIds: string[];
  maskedToolOutputIds: string[];
  checkpointId?: string;
  memoryIds: string[];
  providerNativeCompactionUsed: boolean;
  reason: string;
};

export type CompiledContextSection = {
  kind: string;
  tokenBudget: number;
  sourceIds: string[];
};

export type CompiledContextMessage = {
  role: ChatMessageRole;
  content: string;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type ContextCompileResult = {
  messages: CompiledContextMessage[];
  sections: CompiledContextSection[];
  metadata: ContextCompactionMetadata;
  checkpoint?: ContextCheckpoint;
  warnings: string[];
};

export type ContextLimitWarningPayload = {
  sessionId: string;
  compactionCount: number;
  removedCount: number;
  maskedToolOutputCount: number;
  compactionReason?: string | null;
  checkpointId?: string | null;
  checkpointCreatedAt?: string | null;
  checkpointPreview?: string | null;
  budgetUsed?: number;
  budgetLimit?: number;
};
