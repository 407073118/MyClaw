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

export type SessionRuntimeIntent = {
  reasoningMode?: SessionReasoningMode;
  reasoningEffort?: SessionReasoningEffort;
  adapterHint?: SessionRuntimeAdapterHint;
  replayPolicy?: SessionReplayPolicy;
};

export type ExecutionPlan = {
  runtimeVersion: SessionRuntimeVersion;
  adapterId: SessionRuntimeAdapterId;
  adapterSelectionSource: SessionRuntimeAdapterSelectionSource;
  reasoningMode: SessionReasoningMode;
  replayPolicy: SessionReplayPolicy;
  fallbackAdapterIds: SessionRuntimeAdapterId[];
};
