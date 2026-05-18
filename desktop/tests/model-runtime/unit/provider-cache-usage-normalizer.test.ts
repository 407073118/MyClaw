import { describe, expect, it } from "vitest";

import { normalizeProviderCacheUsage } from "../../../src/main/services/model-runtime/provider-cache-orchestrator";

describe("provider cache usage normalizer", () => {
  it("parses DeepSeek prompt cache usage from SSE usage", () => {
    const parsed = normalizeProviderCacheUsage("deepseek", {
      prompt_tokens: 1000,
      completion_tokens: 80,
      total_tokens: 1080,
      prompt_cache_hit_tokens: 750,
      prompt_cache_miss_tokens: 250,
    });

    expect(parsed?.cacheHitInputTokens).toBe(750);
    expect(parsed?.cacheMissInputTokens).toBe(250);
    expect(parsed?.cacheEfficiency).toBeCloseTo(0.75);
  });

  it("parses OpenAI-compatible cached token details for Qwen MiniMax Ark and Kimi routes", () => {
    for (const vendor of ["qwen", "minimax", "volcengine-ark", "kimi"]) {
      const parsed = normalizeProviderCacheUsage(vendor, {
        prompt_tokens: 1200,
        completion_tokens: 120,
        total_tokens: 1320,
        input_tokens_details: {
          cached_tokens: 900,
        },
      });

      expect(parsed?.cachedInputTokens).toBe(900);
      expect(parsed?.cacheHitInputTokens).toBe(900);
      expect(parsed?.cacheEfficiency).toBeCloseTo(0.75);
    }
  });
});
