import { describe, expect, it } from "vitest";

import { buildProviderScorecards } from "../../../src/main/services/model-runtime/provider-scorecard";
import type { TurnOutcome } from "@shared/contracts";

describe("provider scorecard", () => {
  it("aggregates outcome metrics by family", () => {
    const outcomes: TurnOutcome[] = [
      {
        id: "1",
        providerFamily: "generic-openai-compatible",
        vendorFamily: "generic-openai-compatible",
        protocolTarget: "openai-chat-compatible",
        modelProfileId: "profile-1",
        experienceProfileId: "balanced",
        retryCount: 0,
        toolCompileMode: "relaxed",
        replayMode: "none",
        startedAt: "2026-04-10T00:00:00.000Z",
        finishedAt: "2026-04-10T00:00:01.000Z",
        success: true,
        toolCallCount: 2,
        toolSuccessCount: 1,
        contextStability: true,
        latencyMs: 100,
      },
      {
        id: "2",
        providerFamily: "generic-openai-compatible",
        vendorFamily: "generic-openai-compatible",
        protocolTarget: "openai-chat-compatible",
        modelProfileId: "profile-1",
        experienceProfileId: "balanced",
        retryCount: 1,
        toolCompileMode: "relaxed",
        replayMode: "assistant-turn",
        startedAt: "2026-04-10T00:00:02.000Z",
        finishedAt: "2026-04-10T00:00:03.000Z",
        success: false,
        fallbackReason: "429",
        toolCallCount: 1,
        toolSuccessCount: 1,
        contextStability: false,
        latencyMs: 200,
      },
    ];

    const [scorecard] = buildProviderScorecards(outcomes);
    expect(scorecard.providerFamily).toBe("generic-openai-compatible");
    expect(scorecard.sampleSize).toBe(2);
    expect(scorecard.completionRate).toBe(0.5);
    expect(scorecard.toolSuccessRate).toBeCloseTo(2 / 3);
    expect(scorecard.fallbackRate).toBe(0.5);
    expect(scorecard.p95Latency).toBe(200);
    expect(scorecard.contextStabilityRate).toBe(0.5);
  });

  it("orders families by rollout order for stable scorecard output", () => {
    const outcomes: TurnOutcome[] = [
      {
        id: "openai-1",
        providerFamily: "openai-native",
        vendorFamily: "openai",
        protocolTarget: "openai-responses",
        modelProfileId: "profile-openai",
        experienceProfileId: "gpt-best",
        retryCount: 0,
        toolCompileMode: "openai-strict",
        replayMode: "assistant-turn",
        startedAt: "2026-04-10T00:00:00.000Z",
        finishedAt: "2026-04-10T00:00:01.000Z",
        success: true,
        latencyMs: 120,
      },
      {
        id: "generic-1",
        providerFamily: "generic-openai-compatible",
        vendorFamily: "generic-openai-compatible",
        protocolTarget: "openai-chat-compatible",
        modelProfileId: "profile-generic",
        experienceProfileId: "balanced",
        retryCount: 0,
        toolCompileMode: "relaxed",
        replayMode: "none",
        startedAt: "2026-04-10T00:00:02.000Z",
        finishedAt: "2026-04-10T00:00:03.000Z",
        success: true,
        latencyMs: 80,
      },
    ];

    expect(buildProviderScorecards(outcomes).map((scorecard) => scorecard.providerFamily)).toEqual([
      "generic-openai-compatible",
      "openai-native",
    ]);
  });
});
