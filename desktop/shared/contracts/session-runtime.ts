import type {
  ExperienceProfileId,
  JsonValue,
  ProtocolTarget,
  ProviderFamily,
  ThinkingControlKind,
  ToolChoiceConstraint,
  VendorFamily,
} from "./model";

export const SESSION_RUNTIME_VERSION = 1 as const;

export type SessionRuntimeVersion = typeof SESSION_RUNTIME_VERSION;

export type SessionRuntimeAdapterId =
  | "openai-compatible"
  | "openai-native"
  | "anthropic-native"
  | "qwen"
  | "kimi"
  | "deepseek"
  | "volcengine-ark"
  | "minimax"
  | "br-minimax";
export type SessionRuntimeAdapterHint = SessionRuntimeAdapterId | "auto";
export type SessionRuntimeAdapterSelectionSource = "intent" | "profile";

export const SESSION_RUNTIME_ADAPTER_VALUES = [
  "openai-compatible",
  "openai-native",
  "anthropic-native",
  "qwen",
  "kimi",
  "deepseek",
  "volcengine-ark",
  "minimax",
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
export type SessionReasoningEffort = "low" | "medium" | "high" | "xhigh";
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

export type Phase2SessionRuntimeIntent = SessionRuntimeIntentShell & SessionRuntimeIntentPhase2;
export type SessionRuntimeIntent = SessionRuntimeIntentShell | Phase2SessionRuntimeIntent;
export type ResolvedSessionRuntimeIntent = Required<SessionRuntimeIntentShell> & SessionRuntimeIntentPhase2;

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

export type TurnReplayMode = "none" | "assistant-turn" | "reasoning-aware" | "family-specific";
export type TurnCacheMode = "none" | "openai-prefix" | "anthropic-breakpoint" | "family-specific";
export type TurnMultimodalMode = "text-only" | "canonical-parts";

export type TurnFallbackCandidate = {
  modelProfileId: string;
  providerFamily: ProviderFamily;
  vendorFamily?: VendorFamily;
  protocolTarget: ProtocolTarget;
  reason: string;
};

export type CapabilityKind =
  | "search"
  | "page-read"
  | "computer"
  | "knowledge-retrieval"
  | "research-task"
  | "citation";

export type CapabilityRouteType =
  | "vendor-native"
  | "managed-local"
  | "disabled";

export type ToolStackSource =
  | "vendor-native"
  | "managed-local"
  | "hybrid"
  | "none";

export type CapabilityDescriptor = {
  id: CapabilityKind;
  purpose: string;
  riskLevel: "low" | "medium" | "high";
  supportsBackground?: boolean;
  supportsCitations?: boolean;
  requiresApproval?: boolean;
};

export type CapabilityExecutionRoute = {
  capabilityId: CapabilityKind;
  routeType: CapabilityRouteType;
  providerFamily: ProviderFamily;
  protocolTarget: ProtocolTarget;
  nativeToolName?: string | null;
  nativeToolStackId?: string | null;
  toolStackSource?: ToolStackSource;
  fallbackToolChain?: string[];
  reason?: string | null;
};

export type TurnExecutionPlan = {
  runtimeVersion: number;
  legacyExecutionPlan: ExecutionPlan;
  providerFamily: ProviderFamily;
  vendorFamily?: VendorFamily;
  supportedProtocolTargets?: ProtocolTarget[];
  recommendedProtocolTarget?: ProtocolTarget | null;
  fallbackChain?: ProtocolTarget[];
  deploymentProfile?: string;
  protocolSelectionSource?: "saved" | "probe" | "registry-default" | "fallback";
  protocolSelectionReason?: string | null;
  protocolTarget: ProtocolTarget;
  selectedModelProfileId: string;
  experienceProfileId: ExperienceProfileId;
  reasoningProfileId?: string;
  promptPolicyId: string;
  taskPolicyId: string;
  toolPolicyId: string;
  contextPolicyId: string;
  reliabilityPolicyId: string;
  replayMode: TurnReplayMode;
  cacheMode: TurnCacheMode;
  multimodalMode: TurnMultimodalMode;
  toolCompileTarget: ProviderFamily;
  reasoningEnabled?: boolean;
  reasoningEffort?: SessionReasoningEffort;
  thinkingControlKind?: ThinkingControlKind;
  toolChoiceConstraint?: ToolChoiceConstraint;
  nativeToolStackId?: string | null;
  capabilityRoutes?: CapabilityExecutionRoute[];
  fallbackCandidates: TurnFallbackCandidate[];
  telemetryTags: Record<string, string>;
};

export type PromptSectionLayer =
  | "identity"
  | "environment"
  | "context"
  | "task"
  | "tools"
  | "skills"
  | "guidelines"
  | "family-overlay"
  | (string & {});

export type PromptSection = {
  id: string;
  layer: PromptSectionLayer;
  title: string | null;
  content: string;
  kind?: string;
};

export type CanonicalMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string; detail?: "low" | "high" | "auto" }
  | { type: "reasoning"; text: string }
  | { type: "tool_call_ref"; toolCallId: string }
  | { type: "tool_result_ref"; toolCallId: string }
  | { type: "json"; value: JsonValue };

export type CanonicalToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  input?: Record<string, unknown> | null;
};

export type CanonicalMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | CanonicalMessagePart[];
  reasoning?: string | null;
  toolCallId?: string | null;
  toolCalls?: CanonicalToolCall[] | null;
  metadata?: Record<string, JsonValue | null>;
};

export type CanonicalTaskState = {
  taskCount?: number;
  inProgressTaskId?: string | null;
  completedTaskIds?: string[];
  blockedTaskIds?: string[];
  summary?: string | null;
};

export type CanonicalToolSpec = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: "builtin" | "skill" | "mcp" | "browser" | "task" | "ppt" | "other";
  metadata?: Record<string, JsonValue | null>;
};

export type CanonicalToolResult = {
  toolCallId: string;
  name: string;
  output: string;
  success: boolean;
  error?: string | null;
  metadata?: Record<string, JsonValue | null>;
};

export type CanonicalApprovalEvent = {
  id: string;
  toolCallId: string;
  status: "pending" | "approved" | "rejected";
  reason?: string | null;
  createdAt?: string;
};

export type CapabilityEventType =
  | "web_search_call"
  | "computer_call"
  | "file_search_call"
  | "background_response_started"
  | "tool_fallback"
  | (string & {});

export type CapabilityEvent = {
  type: CapabilityEventType;
  capabilityId: CapabilityKind;
  sessionId?: string | null;
  toolCallId?: string | null;
  createdAt: string;
  vendor?: VendorFamily;
  payload?: Record<string, JsonValue | null>;
};

export type CitationSourceType =
  | "vendor-web-search"
  | "local-web-search"
  | "http-fetch"
  | "browser-page"
  | "file-search";

export type CitationRecord = {
  id: string;
  url?: string | null;
  title?: string | null;
  domain?: string | null;
  snippet?: string | null;
  startIndex?: number | null;
  endIndex?: number | null;
  publishedAt?: string | null;
  fileId?: string | null;
  filename?: string | null;
  sourceType: CitationSourceType;
  traceRef?: string | null;
};

export type BackgroundTaskStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | (string & {});

export type BackgroundTaskHandle = {
  id: string;
  providerFamily: ProviderFamily;
  protocolTarget: ProtocolTarget;
  providerResponseId: string;
  status: BackgroundTaskStatus;
  pollAfterMs?: number | null;
  startedAt: string;
  updatedAt: string;
};

export type ComputerAction = {
  type: string;
  [key: string]: JsonValue | undefined;
};

export type ComputerCall = {
  id: string;
  callId?: string | null;
  status?: string | null;
  actions: ComputerAction[];
};

export type CanonicalTurnContent = {
  systemSections: PromptSection[];
  userSections: PromptSection[];
  taskState: CanonicalTaskState | null;
  messages: CanonicalMessage[];
  toolCalls: CanonicalToolCall[];
  toolResults: CanonicalToolResult[];
  approvalEvents: CanonicalApprovalEvent[];
  replayHints: {
    preserveReasoning: boolean;
    preserveToolLedger: boolean;
    preserveCachePrefix: boolean;
  };
};

export type TurnFallbackEvent = {
  fromVariant: string;
  toVariant: string;
  reason: string;
};

export type TurnActualExecutionPath =
  | "legacy-shim"
  | "canonical-driver"
  | "canonical-rollout-fallback";

export type TurnOutcomeUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export type TurnTelemetryTags = Record<string, string>;

export type TurnTelemetryEvent = {
  experienceProfileId: ExperienceProfileId;
  promptPolicyId: string;
  taskPolicyId: string;
  toolPolicyId: string;
  contextPolicyId: string;
  reliabilityPolicyId: string;
  providerFamily: ProviderFamily;
  vendorFamily?: VendorFamily;
  protocolTarget: ProtocolTarget;
  requestVariantId: string | null;
  retryCount: number;
  success: boolean;
  latencyMs: number;
  toolCompileMode: string;
  replayMode: string;
  reasoningEnabled?: boolean;
  thinkingControlKind?: ThinkingControlKind;
  toolChoiceConstraint?: ToolChoiceConstraint;
  nativeToolStackId?: string | null;
  toolStackSource?: ToolStackSource;
  actualExecutionPath?: TurnActualExecutionPath;
  fallbackEvents: TurnFallbackEvent[];
  createdAt: string;
};

export type TurnOutcome = {
  id: string;
  sessionId?: string | null;
  workflowRunId?: string | null;
  providerFamily: ProviderFamily;
  vendorFamily?: VendorFamily;
  protocolTarget: ProtocolTarget;
  modelProfileId: string;
  experienceProfileId: ExperienceProfileId;
  promptPolicyId?: string;
  taskPolicyId?: string;
  toolPolicyId?: string;
  contextPolicyId?: string;
  reliabilityPolicyId?: string;
  requestVariantId?: string | null;
  fallbackReason?: string | null;
  retryCount: number;
  toolCompileMode: string;
  replayMode: string;
  reasoningEnabled?: boolean;
  thinkingControlKind?: ThinkingControlKind;
  toolChoiceConstraint?: ToolChoiceConstraint;
  nativeToolStackId?: string | null;
  toolStackSource?: ToolStackSource;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  finishReason?: string | null;
  latencyMs: number;
  usage?: TurnOutcomeUsage;
  responseId?: string | null;
  actualExecutionPath?: TurnActualExecutionPath;
  fallbackEvents?: TurnFallbackEvent[];
  toolCallCount?: number;
  toolSuccessCount?: number;
  contextStability?: boolean;
  citations?: CitationRecord[];
  capabilityEvents?: CapabilityEvent[];
  computerCalls?: ComputerCall[];
  backgroundTask?: BackgroundTaskHandle | null;
  telemetry?: TurnTelemetryEvent;
  telemetryTags?: TurnTelemetryTags;
};

export type ProviderFamilyScorecard = {
  providerFamily: ProviderFamily;
  completionRate: number;
  toolSuccessRate: number;
  fallbackRate: number;
  p95Latency: number;
  contextStabilityRate: number;
  sampleSize: number;
};

export type VendorProtocolScorecard = {
  vendorFamily: VendorFamily | string;
  protocolTarget: ProtocolTarget;
  completionRate: number;
  toolSuccessRate: number;
  fallbackRate: number;
  p95Latency: number;
  contextStabilityRate: number;
  vendorNativeToolRate?: number;
  activeNativeToolStackIds?: string[];
  thinkingControlKinds?: ThinkingControlKind[];
  sampleSize: number;
};

export type ProviderRolloutGate = {
  providerFamily: ProviderFamily;
  enabled: boolean;
  rolloutOrder: number;
};
