import type {
  ModelCapability,
  ModelProfile,
  ProviderFlavor,
  ProviderKind,
} from "@shared/contracts";

type CapabilityTemplate = Omit<ModelCapability, "source">;

type RegistryEntry = {
  provider?: ProviderKind;
  providerFlavor?: ProviderFlavor;
  modelPattern?: RegExp;
  capability: CapabilityTemplate;
};

const REGISTRY_ENTRIES: RegistryEntry[] = [
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
      supportsStreaming: true,
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
      supportsStreaming: true,
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
  if (baseUrl.includes("dashscope.aliyuncs.com") || model.startsWith("qwen")) return "qwen";
  if (baseUrl.includes("ollama") || model.startsWith("ollama")) return "ollama";

  if (profile.provider === "openai-compatible") return "generic-openai-compatible";
  if (profile.provider === "local-gateway") return "generic-local-gateway";
  return undefined;
}

/**
 * 从静态 registry 中查找模型能力，命中后统一标记 source=registry。
 */
export function findRegistryCapability(profile: ModelProfile): ModelCapability | null {
  const flavor = inferProviderFlavor(profile);

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

