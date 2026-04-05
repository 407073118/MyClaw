import type {
  ChatSession,
  ExecutionPlan,
  ModelCapability,
  ModelProfile,
  SessionReplayPolicy,
  SessionRuntimeAdapterId,
  SessionRuntimeAdapterSelectionSource,
  SessionRuntimeIntent,
} from "@shared/contracts";
import { SESSION_RUNTIME_VERSION } from "@shared/contracts";
import { isBrMiniMaxProfile } from "@shared/br-minimax";

export type ResolvedSessionRuntimeIntent = Required<SessionRuntimeIntent>;

export type BuildExecutionPlanInput = {
  session?: Pick<ChatSession, "runtimeIntent"> | null;
  intent?: SessionRuntimeIntent | null;
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model">;
  capability?: Pick<ModelCapability, "supportsReasoning"> | null;
};

const DEFAULT_SESSION_RUNTIME_INTENT: ResolvedSessionRuntimeIntent = {
  reasoningMode: "auto",
  reasoningEffort: "medium",
  adapterHint: "auto",
  replayPolicy: "content-only",
};

/** 合并会话级与调用级 runtime intent，生成 Phase 1 的默认执行意图。 */
export function resolveSessionRuntimeIntent(
  session: Pick<ChatSession, "runtimeIntent"> | null = null,
  intent: SessionRuntimeIntent | null = null,
): ResolvedSessionRuntimeIntent {
  return {
    ...DEFAULT_SESSION_RUNTIME_INTENT,
    ...(session?.runtimeIntent ?? {}),
    ...(intent ?? {}),
  };
}

/** 解析本轮执行应该走哪个 provider adapter。 */
function resolveAdapterSelection(input: BuildExecutionPlanInput): {
  adapterId: SessionRuntimeAdapterId;
  adapterSelectionSource: SessionRuntimeAdapterSelectionSource;
} {
  const adapterHint = input.intent?.adapterHint ?? input.session?.runtimeIntent?.adapterHint;
  if (adapterHint && adapterHint !== "auto") {
    return {
      adapterId: adapterHint,
      adapterSelectionSource: "intent",
    };
  }

  if (isBrMiniMaxProfile(input.profile)) {
    return {
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
    };
  }

  return {
    adapterId: "openai-compatible",
    adapterSelectionSource: "profile",
  };
}

/** 根据 adapter 和能力信息生成 Phase 1 的 replay 默认值。 */
function resolveReplayPolicy(
  adapterId: SessionRuntimeAdapterId,
  explicitReplayPolicy: SessionReplayPolicy | undefined,
  capability: Pick<ModelCapability, "supportsReasoning"> | null | undefined,
): SessionReplayPolicy {
  if (explicitReplayPolicy) return explicitReplayPolicy;
  if (adapterId !== "br-minimax") return "content-only";
  if (capability?.supportsReasoning === false) return "assistant-turn";
  return "assistant-turn-with-reasoning";
}

/** 生成 Phase 1 最小执行计划，先固化 adapter 选择与 replay 兜底链。 */
export function buildExecutionPlan(input: BuildExecutionPlanInput): ExecutionPlan {
  const resolvedIntent = resolveSessionRuntimeIntent(input.session ?? null, input.intent ?? null);
  const adapterSelection = resolveAdapterSelection(input);
  const replayPolicy = resolveReplayPolicy(
    adapterSelection.adapterId,
    input.intent?.replayPolicy ?? input.session?.runtimeIntent?.replayPolicy,
    input.capability,
  );

  return {
    runtimeVersion: SESSION_RUNTIME_VERSION,
    adapterId: adapterSelection.adapterId,
    adapterSelectionSource: adapterSelection.adapterSelectionSource,
    reasoningMode: resolvedIntent.reasoningMode,
    replayPolicy,
    fallbackAdapterIds: adapterSelection.adapterId === "br-minimax" ? ["openai-compatible"] : [],
  };
}
