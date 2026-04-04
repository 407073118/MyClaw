import type { ModelCapability, ModelProfile, ReasoningProtocol } from "@shared/contracts";

import { findRegistryCapability } from "./model-capability-registry";

export type ResolvedModelCapability = {
  effective: ModelCapability;
  registry: ModelCapability | null;
  discovered: ModelCapability | null;
  manualOverride: Partial<ModelCapability> | null;
};

const SAFE_DEFAULT_CAPABILITY: ModelCapability = {
  contextWindowTokens: 32768,
  maxInputTokens: 28672,
  maxOutputTokens: 4096,
  supportsTools: true,
  supportsReasoning: false,
  supportsEffort: false,
  supportsStreaming: true,
  requiresReasoningReplay: false,
  tokenCountingMode: "character-fallback",
  source: "default",
};

/**
 * 为 provider 解析默认协议偏好，避免 session/UI 层直接理解协议差异。
 */
function inferPreferredProtocol(profile: ModelProfile): ReasoningProtocol {
  if (profile.provider === "anthropic" || profile.providerFlavor === "anthropic" || profile.providerFlavor === "minimax-anthropic") {
    return "anthropic";
  }

  if (profile.provider === "local-gateway" || profile.providerFlavor === "generic-local-gateway") {
    return "local-gateway";
  }

  return "openai-compatible";
}

/**
 * 从 legacy contextWindow 推导能力字段，保证历史配置可继续使用。
 */
function buildLegacyCapability(profile: ModelProfile): ModelCapability | null {
  const contextWindow = profile.contextWindow;
  if (!contextWindow || contextWindow <= 0) return null;

  const outputReserve = 4096;
  const maxInputTokens = Math.max(contextWindow - outputReserve * 2, 1);
  return {
    contextWindowTokens: contextWindow,
    maxInputTokens,
    maxOutputTokens: outputReserve,
    supportsTools: true,
    supportsReasoning: false,
    supportsEffort: false,
    supportsStreaming: true,
    requiresReasoningReplay: false,
    preferredProtocol: inferPreferredProtocol(profile),
    tokenCountingMode: "character-fallback",
    source: "observed-response",
  };
}

/**
 * 判断手动覆盖是否包含有效字段，用于确定是否提升优先级。
 */
function hasManualOverride(value: Partial<ModelCapability> | null | undefined): value is Partial<ModelCapability> {
  if (!value) return false;
  return Object.keys(value).length > 0;
}

/**
 * 解析模型能力优先级：
 * 手动覆盖 > 已发现能力 > registry > legacy contextWindow > 默认兜底。
 */
export function resolveModelCapability(
  profile: ModelProfile,
  options?: {
    registryCapability?: ModelCapability | null;
    discoveredCapability?: ModelCapability | null;
  },
): ResolvedModelCapability {
  const registry = options && "registryCapability" in options
    ? options.registryCapability ?? null
    : findRegistryCapability(profile);
  const discovered = options && "discoveredCapability" in options
    ? options.discoveredCapability ?? null
    : profile.discoveredCapabilities ?? null;
  const legacy = buildLegacyCapability(profile);
  const manualOverride = profile.capabilityOverrides ?? null;
  const hasManual = hasManualOverride(manualOverride);

  let source: ModelCapability["source"] = "default";
  if (hasManual) source = "manual-override";
  else if (discovered) source = discovered.source ?? "provider-detail";
  else if (registry) source = "registry";
  else if (legacy) source = "observed-response";

  const effective: ModelCapability = {
    ...SAFE_DEFAULT_CAPABILITY,
    ...(legacy ?? {}),
    ...(registry ?? {}),
    ...(discovered ?? {}),
    ...(hasManual ? manualOverride : {}),
    supportsReasoning:
      (hasManual ? manualOverride?.supportsReasoning : undefined)
      ?? discovered?.supportsReasoning
      ?? registry?.supportsReasoning
      ?? legacy?.supportsReasoning
      ?? SAFE_DEFAULT_CAPABILITY.supportsReasoning,
    supportsEffort:
      (hasManual ? manualOverride?.supportsEffort : undefined)
      ?? discovered?.supportsEffort
      ?? registry?.supportsEffort
      ?? legacy?.supportsEffort
      ?? SAFE_DEFAULT_CAPABILITY.supportsEffort,
    requiresReasoningReplay:
      (hasManual ? manualOverride?.requiresReasoningReplay : undefined)
      ?? discovered?.requiresReasoningReplay
      ?? registry?.requiresReasoningReplay
      ?? legacy?.requiresReasoningReplay
      ?? SAFE_DEFAULT_CAPABILITY.requiresReasoningReplay,
    preferredProtocol:
      (hasManual ? manualOverride?.preferredProtocol : undefined)
      ?? discovered?.preferredProtocol
      ?? registry?.preferredProtocol
      ?? legacy?.preferredProtocol
      ?? inferPreferredProtocol(profile),
    source,
  };

  return {
    effective,
    registry,
    discovered,
    manualOverride: hasManual ? manualOverride : null,
  };
}
