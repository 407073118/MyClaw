import type { ModelProfile, ProviderFamily } from "@shared/contracts";
import { inferProviderFamily } from "./family-policy-resolver";

export type RuntimeRole = "plan" | "execute" | "review" | "long-context";

export type RoleModelRoute = {
  modelProfileId: string | null;
  providerFamily: ProviderFamily | null;
  reason: string;
};

/**
 * 按角色在现有模型配置里挑一个最合适的候选，避免在多个入口重复挑选逻辑。
 */
export function routeModelForRole(
  role: RuntimeRole,
  profiles: ModelProfile[],
): RoleModelRoute {
  if (profiles.length === 0) {
    return {
      modelProfileId: null,
      providerFamily: null,
      reason: "no-model-profile",
    };
  }

  const ranked = [...profiles].sort((left, right) => {
    const leftCapability = left.discoveredCapabilities?.contextWindowTokens ?? left.contextWindow ?? 0;
    const rightCapability = right.discoveredCapabilities?.contextWindowTokens ?? right.contextWindow ?? 0;
    return rightCapability - leftCapability;
  });

  if (role === "long-context") {
    const candidate = ranked[0] ?? profiles[0]!;
    return {
      modelProfileId: candidate.id,
      providerFamily: inferProviderFamily(candidate),
      reason: "largest-context-window",
    };
  }

  const familyPreference: ProviderFamily[] = role === "plan"
    ? ["anthropic-native", "openai-native", "br-minimax", "generic-openai-compatible"]
    : role === "review"
      ? ["anthropic-native", "openai-native", "generic-openai-compatible"]
      : ["openai-native", "generic-openai-compatible", "qwen-dashscope", "br-minimax"];

  for (const family of familyPreference) {
    const candidate = profiles.find((profile) => inferProviderFamily(profile) === family);
    if (candidate) {
      return {
        modelProfileId: candidate.id,
        providerFamily: family,
        reason: `matched-${role}-family`,
      };
    }
  }

  const fallback = profiles[0]!;
  return {
    modelProfileId: fallback.id,
    providerFamily: inferProviderFamily(fallback),
    reason: "fallback-first-profile",
  };
}
