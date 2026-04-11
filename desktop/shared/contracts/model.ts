export type ProviderKind = "openai-compatible" | "anthropic" | "local-gateway";

export type ProviderFlavor =
  | "openai"
  | "openrouter"
  | "vercel-ai-gateway"
  | "qwen"
  | "moonshot"
  | "ollama"
  | "lm-studio"
  | "vllm"
  | "br-minimax"
  | "volcengine-ark"
  | "generic-openai-compatible"
  | "anthropic"
  | "minimax-anthropic"
  | "generic-local-gateway";

export const PROVIDER_FLAVOR_VALUES = [
  "openai",
  "openrouter",
  "vercel-ai-gateway",
  "qwen",
  "moonshot",
  "ollama",
  "lm-studio",
  "vllm",
  "br-minimax",
  "volcengine-ark",
  "generic-openai-compatible",
  "anthropic",
  "minimax-anthropic",
  "generic-local-gateway",
] as const satisfies readonly ProviderFlavor[];

export type ProviderFamily =
  | "openai-native"
  | "anthropic-native"
  | "qwen-dashscope"
  | "br-minimax"
  | "volcengine-ark"
  | "generic-openai-compatible";

export const PROVIDER_FAMILY_VALUES = [
  "openai-native",
  "anthropic-native",
  "qwen-dashscope",
  "br-minimax",
  "volcengine-ark",
  "generic-openai-compatible",
] as const satisfies readonly ProviderFamily[];

export type VendorFamily =
  | "openai"
  | "anthropic"
  | "qwen"
  | "kimi"
  | "volcengine-ark"
  | "minimax"
  | "generic-openai-compatible"
  | "generic-local-gateway";

export const VENDOR_FAMILY_VALUES = [
  "openai",
  "anthropic",
  "qwen",
  "kimi",
  "volcengine-ark",
  "minimax",
  "generic-openai-compatible",
  "generic-local-gateway",
] as const satisfies readonly VendorFamily[];

export type ProtocolTarget =
  | "openai-responses"
  | "anthropic-messages"
  | "openai-chat-compatible";

export const PROTOCOL_TARGET_VALUES = [
  "openai-responses",
  "anthropic-messages",
  "openai-chat-compatible",
] as const satisfies readonly ProtocolTarget[];

export const PROTOCOL_TARGET_RECOMMENDATION_ORDER = [
  "openai-responses",
  "anthropic-messages",
  "openai-chat-compatible",
] as const satisfies readonly ProtocolTarget[];

export type ModelRouteProbeEntry = {
  protocolTarget: ProtocolTarget;
  ok: boolean;
  latencyMs?: number;
  reason?: string | null;
  notes?: string[];
};

export type ModelRouteProbeResult = {
  recommendedProtocolTarget: ProtocolTarget | null;
  availableProtocolTargets: ProtocolTarget[];
  entries: ModelRouteProbeEntry[];
  testedAt: string;
};

export type ExperienceProfileId =
  | "gpt-best"
  | "claude-best"
  | "qwen-best"
  | "balanced"
  | "fast"
  | "planner-strong"
  | "long-context"
  | (string & {});

export const EXPERIENCE_PROFILE_VALUES = [
  "gpt-best",
  "claude-best",
  "qwen-best",
  "balanced",
  "fast",
  "planner-strong",
  "long-context",
] as const satisfies readonly ExperienceProfileId[];

export type ModelCapabilitySource =
  | "default"
  | "registry"
  | "provider-catalog"
  | "provider-detail"
  | "provider-token-count"
  | "manual-override"
  | "observed-response"
  | "degraded-after-error";

export const MODEL_CAPABILITY_SOURCE_VALUES = [
  "default",
  "registry",
  "provider-catalog",
  "provider-detail",
  "provider-token-count",
  "manual-override",
  "observed-response",
  "degraded-after-error",
] as const satisfies readonly ModelCapabilitySource[];

export type TokenCountingMode =
  | "provider-native"
  | "openai-compatible-estimate"
  | "anthropic-estimate"
  | "local-heuristic"
  | "character-fallback";

export const TOKEN_COUNTING_MODE_VALUES = [
  "provider-native",
  "openai-compatible-estimate",
  "anthropic-estimate",
  "local-heuristic",
  "character-fallback",
] as const satisfies readonly TokenCountingMode[];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ModelCapability = {
  contextWindowTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsStreaming?: boolean;
  supportsPromptCaching?: boolean;
  supportsVision?: boolean;
  tokenCountingMode?: TokenCountingMode;
  source: ModelCapabilitySource;
  lastValidatedAt?: string | null;
  raw?: Record<string, JsonValue>;
};

export type ContextBudgetPolicy = {
  outputReserveTokens?: number;
  systemReserveTokens?: number;
  toolReserveTokens?: number;
  memoryReserveTokens?: number;
  safetyMarginTokens?: number;
  compactTriggerRatio?: number;
  minRecentTurnsToKeep?: number;
  /** 保留最近 N 条工具输出的完整内容，更早的替换为摘要占位符（Observation Masking）。 */
  recentToolOutputTurnsToKeep?: number;
  /** 累计压缩次数达到此阈值时，建议用户新建对话。 */
  suggestNewChatAfterCompactions?: number;
  maxSummaryBlocks?: number;
  enableLongTermMemory?: boolean;
  enableContextCheckpoint?: boolean;
};

export const DEFAULT_CONTEXT_BUDGET_POLICY: Readonly<Required<ContextBudgetPolicy>> = {
  outputReserveTokens: 4096,
  systemReserveTokens: 2048,
  toolReserveTokens: 4096,
  memoryReserveTokens: 4096,
  safetyMarginTokens: 1024,
  compactTriggerRatio: 0.8,
  minRecentTurnsToKeep: 12,
  recentToolOutputTurnsToKeep: 10,
  suggestNewChatAfterCompactions: 2,
  maxSummaryBlocks: 4,
  enableLongTermMemory: true,
  enableContextCheckpoint: true,
};

export type ModelCatalogItem = {
  id: string;
  name: string;
  provider: ProviderKind;
  providerFlavor?: ProviderFlavor;
  providerFamily?: ProviderFamily;
  vendorFamily?: VendorFamily;
  protocolTarget?: ProtocolTarget;
  experienceProfileId?: ExperienceProfileId;
  contextWindowTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  source?: ModelCapabilitySource;
  raw?: Record<string, JsonValue>;
};

export type ModelProfile = {
  id: string;
  name: string;
  provider: ProviderKind;
  providerFlavor?: ProviderFlavor;
  providerFamily?: ProviderFamily;
  vendorFamily?: VendorFamily;
  deploymentProfile?: string;
  savedProtocolPreferences?: ProtocolTarget[];
  protocolSelectionSource?: "saved" | "probe" | "registry-default" | "fallback";
  protocolTarget?: ProtocolTarget;
  experienceProfileId?: ExperienceProfileId;
  baseUrl: string;
  baseUrlMode?: "manual" | "provider-root";
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
  requestBody?: Record<string, JsonValue>;
  contextWindow?: number; // legacy field kept for backward compatibility
  discoveredCapabilities?: ModelCapability | null;
  capabilityOverrides?: Partial<ModelCapability>;
  budgetPolicy?: ContextBudgetPolicy;
};
