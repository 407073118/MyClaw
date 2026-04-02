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
  "generic-openai-compatible",
  "anthropic",
  "minimax-anthropic",
  "generic-local-gateway",
] as const satisfies readonly ProviderFlavor[];

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
  maxSummaryBlocks: 4,
  enableLongTermMemory: true,
  enableContextCheckpoint: true,
};

export type ModelCatalogItem = {
  id: string;
  name: string;
  provider: ProviderKind;
  providerFlavor?: ProviderFlavor;
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
