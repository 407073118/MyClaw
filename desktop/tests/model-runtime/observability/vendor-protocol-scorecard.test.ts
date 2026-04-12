import { describe, expect, it } from "vitest";

import { buildVendorProtocolScorecards } from "../../../src/main/services/model-runtime/provider-scorecard";
import type { TurnOutcome } from "@shared/contracts";

describe("vendor protocol scorecard", () => {
  it("aggregates outcome metrics by vendor family and protocol target", () => {
    const outcomes: TurnOutcome[] = [
      {
        id: "qwen-r",
        providerFamily: "qwen-dashscope",
        vendorFamily: "qwen",
        protocolTarget: "openai-responses",
        modelProfileId: "profile-qwen",
        experienceProfileId: "qwen-best",
        retryCount: 0,
        toolCompileMode: "openai-compatible-conservative",
        replayMode: "none",
        startedAt: "2026-04-11T00:00:00.000Z",
        finishedAt: "2026-04-11T00:00:01.000Z",
        success: true,
        toolCallCount: 1,
        toolSuccessCount: 1,
        contextStability: true,
        latencyMs: 100,
      },
      {
        id: "qwen-c",
        providerFamily: "qwen-dashscope",
        vendorFamily: "qwen",
        protocolTarget: "openai-chat-compatible",
        modelProfileId: "profile-qwen",
        experienceProfileId: "qwen-best",
        retryCount: 1,
        toolCompileMode: "openai-compatible-conservative",
        replayMode: "none",
        startedAt: "2026-04-11T00:00:02.000Z",
        finishedAt: "2026-04-11T00:00:03.000Z",
        success: false,
        fallbackReason: "rollout_disabled",
        toolCallCount: 2,
        toolSuccessCount: 1,
        contextStability: false,
        latencyMs: 200,
      },
    ];

    const scorecards = buildVendorProtocolScorecards(outcomes);
    expect(scorecards).toEqual([
      expect.objectContaining({
        vendorFamily: "qwen",
        protocolTarget: "openai-chat-compatible",
        sampleSize: 1,
        completionRate: 0,
        fallbackRate: 1,
      }),
      expect.objectContaining({
        vendorFamily: "qwen",
        protocolTarget: "openai-responses",
        sampleSize: 1,
        completionRate: 1,
        fallbackRate: 0,
      }),
    ]);
  });
});
