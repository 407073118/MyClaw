import type {
  ChatSession,
  ExecutionPlan,
  ExecutionPlanSource,
  ModelCapability,
  ModelProfile,
  ResolvedExecutionPlan,
  ResolvedSessionRuntimeIntent,
  SessionReplayPolicy,
  SessionRuntimeAdapterId,
  SessionRuntimeAdapterSelectionSource,
  SessionRuntimeIntent,
} from "@shared/contracts";
import { SESSION_RUNTIME_VERSION } from "@shared/contracts";
import { resolveProviderAdapterId } from "./provider-adapters";

export type BuildExecutionPlanInput = {
  session?: Pick<ChatSession, "runtimeIntent"> | null;
  intent?: SessionRuntimeIntent | null;
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model" | "vendorFamily" | "deploymentProfile">;
  capability?: Pick<ModelCapability, "supportsReasoning"> | null;
};

const DEFAULT_SESSION_RUNTIME_INTENT: ResolvedSessionRuntimeIntent = {
  reasoningMode: "auto",
  reasoningEffort: "medium",
  adapterHint: "auto",
  replayPolicy: "content-only",
  workflowMode: "default",
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

function isReasoningDisabled(intent: ResolvedSessionRuntimeIntent): boolean {
  if (intent.reasoningEnabled !== undefined) {
    return !intent.reasoningEnabled;
  }
  return intent.reasoningMode === "disabled";
}

type IntentField =
  | "reasoningMode"
  | "reasoningEffort"
  | "adapterHint"
  | "replayPolicy"
  | "reasoningEnabled"
  | "toolStrategy"
  | "workflowMode"
  | "planModeEnabled";

function hasIntentField(
  intent: SessionRuntimeIntent | null | undefined,
  field: IntentField,
): boolean {
  const intentRecord = intent as Partial<Record<IntentField, unknown>> | null | undefined;
  return !!intent
    && Object.prototype.hasOwnProperty.call(intent, field)
    && intentRecord?.[field] !== undefined;
}

function hasIntentOverrides(
  input: BuildExecutionPlanInput,
  resolvedIntent: ResolvedSessionRuntimeIntent,
): boolean {
  const defaultIntent = resolveSessionRuntimeIntent(null, null);
  const sessionResolvedIntent = resolveSessionRuntimeIntent(input.session ?? null, null);
  const sessionIntent = input.session?.runtimeIntent ?? null;
  const requestIntent = input.intent ?? null;
  const hasField = (field: IntentField) => hasIntentField(sessionIntent, field) || hasIntentField(requestIntent, field);
  const changedByRequest = (field: IntentField) => hasIntentField(requestIntent, field)
    && resolvedIntent[field] !== sessionResolvedIntent[field];
  const changedBySession = (field: IntentField) => hasIntentField(sessionIntent, field)
    && sessionResolvedIntent[field] !== defaultIntent[field];

  return changedByRequest("reasoningMode")
    || changedBySession("reasoningMode")
    || changedByRequest("reasoningEffort")
    || changedBySession("reasoningEffort")
    || changedByRequest("adapterHint")
    || changedBySession("adapterHint")
    || hasField("replayPolicy")
    || (hasIntentField(requestIntent, "reasoningEnabled")
      && resolvedIntent.reasoningEnabled !== sessionResolvedIntent.reasoningEnabled)
    || (hasIntentField(sessionIntent, "reasoningEnabled") && sessionResolvedIntent.reasoningEnabled === false)
    || (hasIntentField(requestIntent, "toolStrategy")
      && resolvedIntent.toolStrategy !== sessionResolvedIntent.toolStrategy)
    || (hasIntentField(sessionIntent, "toolStrategy")
      && sessionResolvedIntent.toolStrategy !== undefined
      && sessionResolvedIntent.toolStrategy !== "auto")
    || changedByRequest("workflowMode")
    || changedBySession("workflowMode")
    || (hasIntentField(requestIntent, "planModeEnabled")
      && resolvedIntent.planModeEnabled !== sessionResolvedIntent.planModeEnabled)
    || (hasIntentField(sessionIntent, "planModeEnabled")
      && sessionResolvedIntent.planModeEnabled === true);
}

/** 解析本轮执行应该走哪个 provider adapter。 */
function resolveAdapterSelection(
  profile: BuildExecutionPlanInput["profile"],
  resolvedIntent: ResolvedSessionRuntimeIntent,
): {
  adapterId: SessionRuntimeAdapterId;
  adapterSelectionSource: SessionRuntimeAdapterSelectionSource;
} {
  if (resolvedIntent.adapterHint !== "auto") {
    return {
      adapterId: resolvedIntent.adapterHint,
      adapterSelectionSource: "intent",
    };
  }
  return {
    adapterId: resolveProviderAdapterId(profile),
    adapterSelectionSource: "profile",
  };
}

function resolveReasoningEnabled(
  resolvedIntent: ResolvedSessionRuntimeIntent,
  capability: Pick<ModelCapability, "supportsReasoning"> | null | undefined,
): boolean {
  if (isReasoningDisabled(resolvedIntent)) return false;
  return capability?.supportsReasoning !== false;
}

function resolveDegradationReason(
  adapterId: SessionRuntimeAdapterId,
  explicitReplayPolicy: SessionReplayPolicy | undefined,
  resolvedIntent: ResolvedSessionRuntimeIntent,
  capability: Pick<ModelCapability, "supportsReasoning"> | null | undefined,
): ResolvedExecutionPlan["degradationReason"] {
  if (explicitReplayPolicy === "assistant-turn-with-reasoning") {
    // 所有适配器均已支持推理重放，不再按 adapter 区分
    if (isReasoningDisabled(resolvedIntent)) return "reasoning-disabled";
    if (capability?.supportsReasoning === false) return "capability-missing";
  }

  if (capability?.supportsReasoning === false
    && (adapterId === "br-minimax" || adapterId === "minimax")
    && explicitReplayPolicy !== "assistant-turn"
    && explicitReplayPolicy !== "content-only"
    && !isReasoningDisabled(resolvedIntent)) {
    return "capability-missing";
  }

  if ((adapterId === "br-minimax" || adapterId === "minimax") && isReasoningDisabled(resolvedIntent)) {
    return "reasoning-disabled";
  }

  return null;
}

/**
 * 根据 adapter、intent 与能力信息生成 replay 决策。
 *
 * 当推理（thinking）开启时，Kimi / DeepSeek / MiniMax 等 API
 * 要求对话历史中所有 assistant 消息都携带 reasoning 内容，
 * 否则返回 400。因此不能仅对 MiniMax 开启推理重放。
 */
function resolveReplayPolicy(
  adapterId: SessionRuntimeAdapterId,
  explicitReplayPolicy: SessionReplayPolicy | undefined,
  resolvedIntent: ResolvedSessionRuntimeIntent,
  capability: Pick<ModelCapability, "supportsReasoning"> | null | undefined,
): SessionReplayPolicy {
  // 显式指定 with-reasoning 但推理不可用时降级
  if (explicitReplayPolicy === "assistant-turn-with-reasoning"
    && (isReasoningDisabled(resolvedIntent)
      || capability?.supportsReasoning === false)) {
    return "assistant-turn";
  }

  if (explicitReplayPolicy) return explicitReplayPolicy;

  // 推理已禁用
  if (isReasoningDisabled(resolvedIntent)) {
    return adapterId === "br-minimax" || adapterId === "minimax" ? "assistant-turn" : "content-only";
  }
  // 能力明确不支持推理
  if (capability?.supportsReasoning === false) {
    return adapterId === "br-minimax" || adapterId === "minimax" ? "assistant-turn" : "content-only";
  }
  // 所有可能支持推理的模型都重放 reasoning，
  // 对于不产出 reasoning 的模型无副作用（没有内容可重放）
  return "assistant-turn-with-reasoning";
}

function resolvePlanSource(
  input: BuildExecutionPlanInput,
  adapterSelectionSource: SessionRuntimeAdapterSelectionSource,
  degradationReason: ResolvedExecutionPlan["degradationReason"],
  resolvedIntent: ResolvedSessionRuntimeIntent,
): ExecutionPlanSource {
  if (degradationReason === "capability-missing") return "capability";
  if (degradationReason === "reasoning-disabled" || hasIntentOverrides(input, resolvedIntent)) return "intent";
  if (adapterSelectionSource === "profile") return "profile";
  return "default";
}

/** 生成 Phase 2 执行计划，使 intent / capability / provider 的决策可追踪。 */
export function buildExecutionPlan(input: BuildExecutionPlanInput): ExecutionPlan {
  const resolvedIntent = resolveSessionRuntimeIntent(input.session ?? null, input.intent ?? null);
  const adapterSelection = resolveAdapterSelection(input.profile, resolvedIntent);
  const explicitReplayPolicy = input.intent?.replayPolicy ?? input.session?.runtimeIntent?.replayPolicy;
  const degradationReason = resolveDegradationReason(
    adapterSelection.adapterId,
    explicitReplayPolicy,
    resolvedIntent,
    input.capability,
  );
  const replayPolicy = resolveReplayPolicy(
    adapterSelection.adapterId,
    explicitReplayPolicy,
    resolvedIntent,
    input.capability,
  );

  return {
    runtimeVersion: SESSION_RUNTIME_VERSION,
    adapterId: adapterSelection.adapterId,
    adapterSelectionSource: adapterSelection.adapterSelectionSource,
    reasoningMode: resolvedIntent.reasoningMode,
    reasoningEnabled: resolveReasoningEnabled(resolvedIntent, input.capability),
    reasoningEffort: resolvedIntent.reasoningEffort,
    adapterHint: resolvedIntent.adapterHint,
    replayPolicy,
    toolStrategy: resolvedIntent.toolStrategy,
    workflowMode: resolvedIntent.workflowMode,
    degradationReason,
    planSource: resolvePlanSource(
      input,
      adapterSelection.adapterSelectionSource,
      degradationReason,
      resolvedIntent,
    ),
    fallbackAdapterIds: adapterSelection.adapterId === "openai-compatible" ? [] : ["openai-compatible"],
  };
}
