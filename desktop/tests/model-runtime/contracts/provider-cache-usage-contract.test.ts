import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@shared/contracts";
import type { TurnOutcomeUsage } from "../../../shared/contracts/session-runtime";

describe("provider cache usage contract", () => {
  it("allows cache-aware usage fields on turn outcomes and messages", () => {
    const usage: TurnOutcomeUsage = {
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cachedInputTokens: 600,
      cacheHitInputTokens: 600,
      cacheMissInputTokens: 400,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      effectiveBillableInputTokens: 400,
      cacheEfficiency: 0.6,
      rawProviderUsage: { prompt_cache_hit_tokens: 600 },
    };
    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "ok",
      createdAt: "2026-05-16T00:00:00.000Z",
      usage,
    };

    expect(message.usage?.cacheHitInputTokens).toBe(600);
    expect(message.usage?.rawProviderUsage?.prompt_cache_hit_tokens).toBe(600);
  });
});
