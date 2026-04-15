import type { TurnExecutionPlan, TurnFallbackEvent, TurnOutcome, TurnTelemetryEvent } from "@shared/contracts";

/** 基于统一执行计划与结果构建 telemetry 事件。 */
export function buildTurnTelemetryEvent(input: {
  plan: TurnExecutionPlan;
  outcome: TurnOutcome;
  fallbackEvents?: TurnFallbackEvent[];
}): TurnTelemetryEvent {
  const fallbackEvents = input.fallbackEvents ?? [];
  return {
    experienceProfileId: input.plan.experienceProfileId,
    promptPolicyId: input.plan.promptPolicyId,
    taskPolicyId: input.plan.taskPolicyId,
    toolPolicyId: input.plan.toolPolicyId,
    contextPolicyId: input.plan.contextPolicyId,
    reliabilityPolicyId: input.plan.reliabilityPolicyId,
    providerFamily: input.plan.providerFamily,
    vendorFamily: input.plan.vendorFamily,
    protocolTarget: input.plan.protocolTarget,
    requestVariantId: input.outcome.requestVariantId ?? null,
    retryCount: input.outcome.retryCount,
    success: input.outcome.success,
    latencyMs: input.outcome.latencyMs,
    toolCompileMode: input.outcome.toolCompileMode,
    replayMode: input.outcome.replayMode,
    reasoningEnabled: input.outcome.reasoningEnabled,
    thinkingControlKind: input.outcome.thinkingControlKind,
    toolChoiceConstraint: input.outcome.toolChoiceConstraint,
    nativeToolStackId: input.outcome.nativeToolStackId ?? null,
    toolStackSource: input.outcome.toolStackSource ?? "none",
    actualExecutionPath: input.outcome.actualExecutionPath,
    fallbackEvents,
    createdAt: input.outcome.finishedAt,
  };
}
