export const SESSION_RUNTIME_VERSION = 1 as const;

export type SessionRuntimeVersion = typeof SESSION_RUNTIME_VERSION;

export type SessionRuntimeAdapterId = "openai-compatible" | "br-minimax";
export type SessionRuntimeAdapterHint = SessionRuntimeAdapterId | "auto";
export type SessionRuntimeAdapterSelectionSource = "intent" | "profile";

export const SESSION_RUNTIME_ADAPTER_VALUES = [
  "openai-compatible",
  "br-minimax",
] as const satisfies readonly SessionRuntimeAdapterId[];

export type SessionReplayPolicy =
  | "content-only"
  | "assistant-turn"
  | "assistant-turn-with-reasoning";

export const SESSION_REPLAY_POLICY_VALUES = [
  "content-only",
  "assistant-turn",
  "assistant-turn-with-reasoning",
] as const satisfies readonly SessionReplayPolicy[];

export type SessionReasoningMode = "auto" | "disabled";
export type SessionReasoningEffort = "low" | "medium" | "high";
export type SessionRuntimeToolStrategy = "auto" | "off" | (string & {});
export type SessionWorkflowMode = "default" | "plan";
export type ExecutionPlanSource = "default" | "intent" | "profile" | "capability" | (string & {});
export type ExecutionPlanDegradationReason =
  | "capability-missing"
  | "adapter-fallback"
  | "reasoning-disabled"
  | "tool-strategy-downgraded"
  | (string & {});

export const SESSION_RUNTIME_TOOL_STRATEGY_VALUES = [
  "auto",
  "off",
] as const satisfies readonly SessionRuntimeToolStrategy[];

export const SESSION_WORKFLOW_MODE_VALUES = [
  "default",
  "plan",
] as const satisfies readonly SessionWorkflowMode[];

export const EXECUTION_PLAN_SOURCE_VALUES = [
  "default",
  "intent",
  "profile",
  "capability",
] as const satisfies readonly ExecutionPlanSource[];

type SessionRuntimeIntentShell = {
  /** Phase 2 优先读显式布尔开关，保留 reasoningMode 兼容旧会话。 */
  reasoningMode?: SessionReasoningMode;
  reasoningEffort?: SessionReasoningEffort;
  adapterHint?: SessionRuntimeAdapterHint;
  replayPolicy?: SessionReplayPolicy;
};

type SessionRuntimeIntentPhase2 = {
  reasoningEnabled?: boolean;
  toolStrategy?: SessionRuntimeToolStrategy;
  workflowMode?: SessionWorkflowMode;
  planModeEnabled?: boolean;
};

export type Phase2SessionRuntimeIntent =
  SessionRuntimeIntentShell & SessionRuntimeIntentPhase2;

/** 允许旧 Phase 1 消费方继续读取基础壳，Phase 2 字段按需渐进出现。 */
export type SessionRuntimeIntent =
  | SessionRuntimeIntentShell
  | Phase2SessionRuntimeIntent;

export type ResolvedSessionRuntimeIntent =
  Required<SessionRuntimeIntentShell> & SessionRuntimeIntentPhase2;

type ExecutionPlanShell = {
  runtimeVersion: SessionRuntimeVersion;
  adapterId: SessionRuntimeAdapterId;
  adapterSelectionSource: SessionRuntimeAdapterSelectionSource;
  reasoningMode: SessionReasoningMode;
  replayPolicy: SessionReplayPolicy;
  fallbackAdapterIds: SessionRuntimeAdapterId[];
};

export type ResolvedExecutionPlan = ExecutionPlanShell & {
  reasoningEnabled?: boolean;
  reasoningEffort?: SessionReasoningEffort;
  adapterHint?: SessionRuntimeAdapterHint;
  toolStrategy?: SessionRuntimeToolStrategy;
  workflowMode?: SessionWorkflowMode;
  phase?: "analysis" | "awaiting_approval" | "execution" | "completed" | "blocked";
  degradationReason: ExecutionPlanDegradationReason | null;
  planSource: ExecutionPlanSource;
};

export type ExecutionPlan = ExecutionPlanShell | ResolvedExecutionPlan;
