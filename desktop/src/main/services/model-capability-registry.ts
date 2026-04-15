import type {
  ModelCapability,
  ModelProfile,
  ProviderFlavor,
  ProviderKind,
} from "@shared/contracts";
import openAiModels from "./openai-models.json";

type CapabilityTemplate = Omit<ModelCapability, "source">;

type RegistryEntry = {
  provider?: ProviderKind;
  providerFlavor?: ProviderFlavor;
  modelPattern?: RegExp;
  capability: CapabilityTemplate;
};

type OpenAiCapabilityCatalog = {
  models: Record<string, CapabilityTemplate>;
  families: Array<{
    pattern: string;
    capability: CapabilityTemplate;
  }>;
  defaults: CapabilityTemplate;
};

const REGISTRY_ENTRIES: RegistryEntry[] = [
  {
    providerFlavor: "qwen",
    modelPattern: /^qwen3-coder-(plus|next)$/i,
    capability: {
      contextWindowTokens: 131072,
      maxInputTokens: 122880,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsVision: true,
      supportsNativeWebSearch: true,
      supportsNativeWebExtractor: true,
      supportsNativeCodeInterpreter: true,
      supportsNativeFileSearch: true,
      thinkingControlKind: "unsupported",
      toolChoiceConstraint: "no_forced_when_thinking",
      requiresReasoningReplay: false,
      nativeToolStackId: "qwen-native",
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "moonshot",
    modelPattern: /^kimi-k2-thinking/i,
    capability: {
      contextWindowTokens: 262144,
      maxInputTokens: 253952,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsPromptCaching: true,
      supportsNativeWebSearch: true,
      supportsNativeCodeInterpreter: true,
      thinkingControlKind: "always_on",
      toolChoiceConstraint: "auto_none_only_when_thinking",
      requiresReasoningReplay: true,
      nativeToolStackId: "moonshot-formula",
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "moonshot",
    modelPattern: /^kimi-k2\.5$/i,
    capability: {
      contextWindowTokens: 262144,
      maxInputTokens: 253952,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsPromptCaching: true,
      supportsNativeWebSearch: true,
      supportsNativeCodeInterpreter: true,
      thinkingControlKind: "boolean",
      toolChoiceConstraint: "auto_none_only_when_thinking",
      requiresReasoningReplay: true,
      nativeToolStackId: "moonshot-formula",
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "br-minimax",
    modelPattern: /^minimax-m2-5$/i,
    capability: {
      contextWindowTokens: 102400,
      maxInputTokens: 98304,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsPromptCaching: true,
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "moonshot",
    modelPattern: /^kimi/i,
    capability: {
      contextWindowTokens: 262144,
      maxInputTokens: 253952,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsPromptCaching: true,
      supportsNativeWebSearch: true,
      supportsNativeCodeInterpreter: true,
      thinkingControlKind: "boolean",
      toolChoiceConstraint: "auto_none_only_when_thinking",
      requiresReasoningReplay: true,
      nativeToolStackId: "moonshot-formula",
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "openrouter",
    modelPattern: /^openai\/gpt-4\.1/i,
    capability: {
      contextWindowTokens: 1047576,
      maxInputTokens: 1014800,
      maxOutputTokens: 32768,
      supportsTools: true,
      supportsStreaming: true,
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "anthropic",
    modelPattern: /^claude/i,
    capability: {
      contextWindowTokens: 200000,
      maxInputTokens: 180000,
      maxOutputTokens: 64000,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsVision: true,
      tokenCountingMode: "anthropic-estimate",
    },
  },
  {
    providerFlavor: "qwen",
    modelPattern: /^qwen/i,
    capability: {
      contextWindowTokens: 131072,
      maxInputTokens: 122880,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsVision: true,
      supportsNativeWebSearch: true,
      supportsNativeWebExtractor: true,
      supportsNativeCodeInterpreter: true,
      supportsNativeFileSearch: true,
      thinkingControlKind: "budget",
      toolChoiceConstraint: "no_forced_when_thinking",
      requiresReasoningReplay: false,
      nativeToolStackId: "qwen-native",
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "deepseek",
    modelPattern: /^deepseek/i,
    capability: {
      contextWindowTokens: 65536,
      maxInputTokens: 63488,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "volcengine-ark",
    capability: {
      contextWindowTokens: 131072,
      maxInputTokens: 122880,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    providerFlavor: "ollama",
    capability: {
      contextWindowTokens: 32768,
      maxInputTokens: 28672,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsStreaming: true,
      tokenCountingMode: "local-heuristic",
    },
  },
  {
    provider: "openai-compatible",
    capability: {
      contextWindowTokens: 131072,
      maxInputTokens: 122880,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStreaming: true,
      tokenCountingMode: "openai-compatible-estimate",
    },
  },
  {
    provider: "anthropic",
    capability: {
      contextWindowTokens: 200000,
      maxInputTokens: 180000,
      maxOutputTokens: 64000,
      supportsTools: true,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsVision: true,
      tokenCountingMode: "anthropic-estimate",
    },
  },
  {
    provider: "local-gateway",
    capability: {
      contextWindowTokens: 32768,
      maxInputTokens: 28672,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsStreaming: true,
      tokenCountingMode: "local-heuristic",
    },
  },
];

const OPENAI_CAPABILITY_CATALOG = openAiModels as OpenAiCapabilityCatalog;

/**
 * 根据 profile 猜测 providerFlavor，优先使用显式配置。
 */
function inferProviderFlavor(profile: ModelProfile): ProviderFlavor | undefined {
  if (profile.providerFlavor) return profile.providerFlavor;

  const baseUrl = profile.baseUrl.toLowerCase();
  const model = profile.model.toLowerCase();

  if (baseUrl.includes("openrouter.ai")) return "openrouter";
  if (baseUrl.includes("vercel.com") && baseUrl.includes("gateway")) return "vercel-ai-gateway";
  if (baseUrl.includes("anthropic.com") || profile.provider === "anthropic") return "anthropic";
  if (baseUrl.includes("cybotforge.100credit.cn") || model === "minimax-m2-5") return "br-minimax";
  if (baseUrl.includes("moonshot") || model.startsWith("kimi")) return "moonshot";
  if (baseUrl.includes("dashscope.aliyuncs.com") || model.startsWith("qwen")) return "qwen";
  if (baseUrl.includes("api.deepseek.com") || model.startsWith("deepseek")) return "deepseek";
  if (baseUrl.includes("volces.com") || baseUrl.includes("ark.cn-beijing")) return "volcengine-ark";
  if (baseUrl.includes("ollama") || model.startsWith("ollama")) return "ollama";

  if (profile.provider === "openai-compatible") return "generic-openai-compatible";
  if (profile.provider === "local-gateway") return "generic-local-gateway";
  return undefined;
}

/** 读取内置 OpenAI 模型能力目录，优先精确匹配，再回退到 family 规则。 */
function resolveBundledOpenAiCapability(modelId: string): CapabilityTemplate {
  const exact = OPENAI_CAPABILITY_CATALOG.models[modelId];
  if (exact) {
    return {
      ...OPENAI_CAPABILITY_CATALOG.defaults,
      ...exact,
    };
  }

  for (const family of OPENAI_CAPABILITY_CATALOG.families) {
    if (new RegExp(family.pattern, "i").test(modelId)) {
      return {
        ...OPENAI_CAPABILITY_CATALOG.defaults,
        ...family.capability,
      };
    }
  }

  return OPENAI_CAPABILITY_CATALOG.defaults;
}

/**
 * 从静态 registry 中查找模型能力，命中后统一标记 source=registry。
 */
export function findRegistryCapability(profile: ModelProfile): ModelCapability | null {
  const flavor = inferProviderFlavor(profile);

  if (flavor === "openai") {
    return {
      ...resolveBundledOpenAiCapability(profile.model),
      source: "registry",
    };
  }

  for (const entry of REGISTRY_ENTRIES) {
    if (entry.providerFlavor && flavor !== entry.providerFlavor) continue;
    if (entry.provider && profile.provider !== entry.provider) continue;
    if (entry.modelPattern && !entry.modelPattern.test(profile.model)) continue;
    return {
      ...entry.capability,
      source: "registry",
    };
  }

  return null;
}
