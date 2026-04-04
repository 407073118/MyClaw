import type { JsonValue, ModelCapability, ModelProfile, ReasoningProtocol } from "@shared/contracts";

import type {
  ProviderReasoningAdapter,
  ProviderReasoningDecision,
  ProviderReasoningInput,
  ProviderReasoningMode,
  ReasoningReplayPolicy,
} from "./index";

/**
 * 判断 profile 是否应走 MiniMax first-class adapter。
 */
export function isMiniMaxProfile(
  profile: Pick<ModelProfile, "providerFlavor" | "baseUrl" | "model">,
): boolean {
  const baseUrl = profile.baseUrl.trim().toLowerCase();
  const model = profile.model.trim().toLowerCase();

  return profile.providerFlavor === "minimax-anthropic"
    || baseUrl.includes("minimax")
    || baseUrl.includes("minimaxi")
    || model.startsWith("minimax");
}

/**
 * 选择 MiniMax adapter 的执行模式。
 * manual URL 保守走兼容模式，避免破坏用户已有网关接法。
 */
export function selectMiniMaxMode(input: ProviderReasoningInput): ProviderReasoningMode {
  if (input.profile.baseUrlMode === "manual") {
    return "compatibility";
  }

  return "enhanced";
}

/**
 * 解析 MiniMax 回放策略。
 * 官方文档明确强调 tool-use 轮次要保留完整 assistant message，因此默认要求 replay。
 */
export function resolveMiniMaxReplayPolicy(capability: ModelCapability): ReasoningReplayPolicy {
  if (capability.requiresReasoningReplay) {
    return "required";
  }

  return "required";
}

/**
 * 为 MiniMax 生成请求 patch。
 * compatibility 只保留基础 reasoning patch，enhanced 再额外开启 reasoning_split。
 */
export function buildMiniMaxRequestPatch(input: {
  capability: ModelCapability;
  mode: ProviderReasoningMode;
}): ProviderReasoningDecision {
  const preferredProtocol = (input.capability.preferredProtocol ?? "anthropic") as ReasoningProtocol;
  const replayPolicy = resolveMiniMaxReplayPolicy(input.capability);

  if (!input.capability.supportsEffort) {
    return {
      adapterKey: "minimax",
      mode: input.mode,
      bodyPatch: {},
      replayPolicy,
      degradedReason: "minimax-reasoning-effort-unsupported",
      preferredProtocol,
    };
  }

  const bodyPatch: Record<string, JsonValue> = {
    reasoning: {
      effort: "medium",
    },
  };

  if (input.mode === "enhanced" && input.capability.raw?.supportsReasoningSplit !== false) {
    bodyPatch.reasoning_split = true;
  }

  return {
    adapterKey: "minimax",
    mode: input.mode,
    bodyPatch,
    replayPolicy,
    degradedReason: null,
    preferredProtocol,
  };
}

/**
 * MiniMax provider adapter：统一封装模式选择、请求 patch 与 replay 语义。
 */
export const minimaxReasoningAdapter: ProviderReasoningAdapter = {
  key: "minimax",

  matchesProfile(profile) {
    return isMiniMaxProfile(profile);
  },

  selectMode(input) {
    return selectMiniMaxMode(input);
  },

  buildRequestPatch(input) {
    const mode = selectMiniMaxMode(input);
    return buildMiniMaxRequestPatch({
      capability: input.capability,
      mode,
    });
  },

  resolveReplayPolicy(capability) {
    return resolveMiniMaxReplayPolicy(capability);
  },
};
