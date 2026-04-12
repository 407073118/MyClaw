import { describe, expect, it } from "vitest";

import { buildTurnTelemetryEvent } from "../../../src/main/services/model-runtime/telemetry";
import type { TurnExecutionPlan, TurnOutcome } from "@shared/contracts";

describe("turn telemetry", () => {
  it("captures required rollout and policy fields", () => {
    const plan = {
      experienceProfileId: "balanced",
      promptPolicyId: "prompt.id",
      taskPolicyId: "task.id",
      toolPolicyId: "tool.id",
      contextPolicyId: "context.id",
      reliabilityPolicyId: "reliability.id",
      providerFamily: "generic-openai-compatible",
      protocolTarget: "openai-chat-compatible",
    } as TurnExecutionPlan;
    const outcome = {
      requestVariantId: "primary",
      retryCount: 1,
      success: true,
      latencyMs: 120,
      toolCompileMode: "openai-compatible-relaxed",
      replayMode: "assistant-turn",
      finishedAt: "2026-04-10T00:00:00.000Z",
    } as TurnOutcome;

    const telemetry = buildTurnTelemetryEvent({
      plan,
      outcome,
      fallbackEvents: [],
    });

    expect(telemetry.experienceProfileId).toBe("balanced");
    expect(telemetry.protocolTarget).toBe("openai-chat-compatible");
    expect(telemetry.retryCount).toBe(1);
  });
});
