import type { JsonValue, ModelCapability, ModelProfile, ReasoningProtocol } from "@shared/contracts";

import { minimaxReasoningAdapter } from "./minimax";

export type ReasoningReplayPolicy = "none" | "required";
export type ProviderReasoningMode = "compatibility" | "enhanced";

export type ProviderReasoningProfile = Pick<
  ModelProfile,
  "provider" | "providerFlavor" | "model" | "baseUrl" | "baseUrlMode"
>;

export type ProviderReasoningInput = {
  capability: ModelCapability;
  profile: ProviderReasoningProfile;
};

export type ProviderReasoningDecision = {
  adapterKey: string;
  mode: ProviderReasoningMode | null;
  bodyPatch: Record<string, JsonValue>;
  replayPolicy: ReasoningReplayPolicy;
  degradedReason: string | null;
  preferredProtocol: ReasoningProtocol | null;
};

export type ProviderReasoningAdapter = {
  key: string;
  matchesProfile: (profile: ProviderReasoningProfile) => boolean;
  selectMode: (input: ProviderReasoningInput) => ProviderReasoningMode;
  buildRequestPatch: (input: ProviderReasoningInput) => ProviderReasoningDecision;
  resolveReplayPolicy: (capability: ModelCapability) => ReasoningReplayPolicy;
};

const DEFAULT_OPENAI_COMPATIBLE_ADAPTER: ProviderReasoningAdapter = {
  key: "default-openai-compatible",

  matchesProfile() {
    return true;
  },

  selectMode() {
    return "compatibility";
  },

  /**
   * 默认 adapter 继续保留 Phase 9 的 OpenAI-compatible reasoning patch 行为。
   */
  buildRequestPatch(input) {
    const preferredProtocol = input.capability.preferredProtocol ?? null;

    if (preferredProtocol === "openai-compatible" && input.capability.supportsEffort) {
      const bodyPatch: Record<string, JsonValue> = {
        reasoning: {
          effort: "medium",
        },
      };
      return {
        adapterKey: "default-openai-compatible",
        mode: "compatibility",
        bodyPatch,
        replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
        degradedReason: null,
        preferredProtocol,
      };
    }

    return {
      adapterKey: "default-openai-compatible",
      mode: "compatibility",
      bodyPatch: {} as Record<string, JsonValue>,
      replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
      degradedReason: "reasoning-patch-not-supported-by-adapter",
      preferredProtocol,
    };
  },

  resolveReplayPolicy(capability) {
    return capability.requiresReasoningReplay ? "required" : "none";
  },
};

const REASONING_ADAPTERS: ProviderReasoningAdapter[] = [
  minimaxReasoningAdapter,
  DEFAULT_OPENAI_COMPATIBLE_ADAPTER,
];

/**
 * 根据 profile 选择合适的 reasoning adapter。
 */
export function resolveProviderReasoningAdapter(
  profile: ProviderReasoningProfile,
): ProviderReasoningAdapter {
  return REASONING_ADAPTERS.find((adapter) => adapter.matchesProfile(profile))
    ?? DEFAULT_OPENAI_COMPATIBLE_ADAPTER;
}
