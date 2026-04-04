import type {
  ChatSessionThinkingSource,
  JsonValue,
  ModelCapability,
  ModelProfile,
  ReasoningProtocol,
} from "@shared/contracts";

import { createLogger } from "./logger";

const log = createLogger("reasoning-runtime");

export type SessionThinkingState = {
  enabled: boolean;
  source: ChatSessionThinkingSource;
};

export type ReasoningReplayPolicy = "none" | "required";

export type ReasoningExecutionPlan = {
  enabled: boolean;
  bodyPatch: Record<string, JsonValue>;
  replayPolicy: ReasoningReplayPolicy;
  degradedReason: string | null;
  preferredProtocol: ReasoningProtocol | null;
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
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "model">;
}): ReasoningExecutionPlan {
  const preferredProtocol = input.capability.preferredProtocol ?? null;

  if (!input.thinkingState.enabled) {
    return {
      enabled: false,
      bodyPatch: {},
      replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
      degradedReason: null,
      preferredProtocol,
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
    };
  }

  if (preferredProtocol === "openai-compatible" && input.capability.supportsEffort) {
    const bodyPatch: Record<string, JsonValue> = {
      reasoning: {
        effort: "medium",
      },
    };
    log.info("reasoning runtime 应用 OpenAI-compatible patch", {
      providerFlavor: input.profile.providerFlavor ?? input.profile.provider,
      thinkingEnabled: true,
    });
    return {
      enabled: true,
      bodyPatch,
      replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
      degradedReason: null,
      preferredProtocol,
    };
  }

  const degradedReason = "reasoning-patch-not-supported-in-phase9";
  log.info("reasoning runtime 降级为空 patch", {
    providerFlavor: input.profile.providerFlavor ?? input.profile.provider,
    degradedReason,
  });
  return {
    enabled: true,
    bodyPatch: {},
    replayPolicy: input.capability.requiresReasoningReplay ? "required" : "none",
    degradedReason,
    preferredProtocol,
  };
}
