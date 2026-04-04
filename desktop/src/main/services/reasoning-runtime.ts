import type {
  ChatSessionThinkingSource,
  JsonValue,
  ModelCapability,
  ModelProfile,
  ReasoningProtocol,
} from "@shared/contracts";

import { createLogger } from "./logger";
import {
  resolveProviderReasoningAdapter,
  type ProviderReasoningMode,
  type ReasoningReplayPolicy,
} from "./provider-adapters";

const log = createLogger("reasoning-runtime");

export type SessionThinkingState = {
  enabled: boolean;
  source: ChatSessionThinkingSource;
};

export type ReasoningExecutionPlan = {
  enabled: boolean;
  bodyPatch: Record<string, JsonValue>;
  replayPolicy: ReasoningReplayPolicy;
  degradedReason: string | null;
  preferredProtocol: ReasoningProtocol | null;
  adapterKey?: string;
  mode?: ProviderReasoningMode | null;
};

/**
 * 解析会话层的抽象 thinking 状态，避免调用链重复处理默认值。
 */
export function resolveSessionThinkingState(input?: {
  thinkingEnabled?: boolean;
  thinkingSource?: ChatSessionThinkingSource;
} | null): SessionThinkingState {
  const state: SessionThinkingState = {
    enabled: input?.thinkingEnabled ?? false,
    source: input?.thinkingSource ?? "default",
  };

  log.info("解析会话 thinking 状态", {
    thinkingEnabled: state.enabled,
    thinkingSource: state.source,
  });

  return state;
}

/**
 * 构建 provider-neutral 的 reasoning 执行计划，当前仅对 OpenAI-compatible patch 开放。
 */
export function buildReasoningExecutionPlan(input: {
  thinkingState: SessionThinkingState;
  capability: ModelCapability;
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "model" | "baseUrl" | "baseUrlMode">;
}): ReasoningExecutionPlan {
  const preferredProtocol = input.capability.preferredProtocol ?? null;

  if (!input.thinkingState.enabled) {
    return {
      enabled: false,
      bodyPatch: {},
      replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
      degradedReason: null,
      preferredProtocol,
      adapterKey: undefined,
      mode: null,
    };
  }

  if (!input.capability.supportsReasoning) {
    const degradedReason = "reasoning-disabled-by-capability";
    log.info("reasoning runtime 降级为空 patch", {
      providerFlavor: input.profile.providerFlavor ?? input.profile.provider,
      degradedReason,
    });
    return {
      enabled: false,
      bodyPatch: {},
      replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
      degradedReason,
      preferredProtocol,
      adapterKey: undefined,
      mode: null,
    };
  }

  const adapter = resolveProviderReasoningAdapter(input.profile);
  const decision = adapter.buildRequestPatch({
    capability: input.capability,
    profile: input.profile,
  });
  log.info("reasoning runtime 已通过 provider adapter 生成执行计划", {
    providerFlavor: input.profile.providerFlavor ?? input.profile.provider,
    adapterKey: decision.adapterKey,
    mode: decision.mode,
    degradedReason: decision.degradedReason,
  });

  return {
    enabled: true,
    bodyPatch: decision.bodyPatch,
    replayPolicy: decision.replayPolicy,
    degradedReason: decision.degradedReason,
    preferredProtocol: decision.preferredProtocol ?? preferredProtocol,
    adapterKey: decision.adapterKey,
    mode: decision.mode,
  };
}
