import { describe, expect, it } from "vitest";

import {
  buildPromptCacheKey,
  hashCacheStableValue,
  normalizeProviderCacheUsage,
} from "../../../src/main/services/model-runtime/provider-cache-orchestrator";

describe("provider cache orchestrator", () => {
  it("builds stable prompt cache keys from stable prefix and tools", () => {
    const stablePrefixHash = hashCacheStableValue("stable prompt");
    const toolBundleHash = hashCacheStableValue([{ name: "fs_read" }]);

    expect(buildPromptCacheKey({
      profileId: "profile-openai",
      stablePrefixHash,
      toolBundleHash,
    })).toBe(`myclaw:profile-openai:${stablePrefixHash}:${toolBundleHash}`);
  });

  it("normalizes DeepSeek prompt cache hit and miss tokens", () => {
    const usage = normalizeProviderCacheUsage("deepseek", {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_cache_hit_tokens: 700,
      prompt_cache_miss_tokens: 300,
    });

    expect(usage?.cacheHitInputTokens).toBe(700);
    expect(usage?.cacheMissInputTokens).toBe(300);
    expect(usage?.cacheEfficiency).toBeCloseTo(0.7);
  });

  it("normalizes Anthropic cache read and write tokens", () => {
    const usage = normalizeProviderCacheUsage("anthropic", {
      input_tokens: 1200,
      output_tokens: 80,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 200,
    });

    expect(usage?.cacheReadInputTokens).toBe(900);
    expect(usage?.cacheWriteInputTokens).toBe(200);
    expect(usage?.cacheHitInputTokens).toBe(900);
  });
});
