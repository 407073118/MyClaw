import { describe, expect, it } from "vitest";

import type {
  ContextBudgetPolicy,
  ModelCapability,
  ModelCatalogItem,
  ModelProfile,
  ProviderFlavor,
} from "@shared/contracts";
import {
  DEFAULT_CONTEXT_BUDGET_POLICY,
  MODEL_CAPABILITY_SOURCE_VALUES,
  PROVIDER_FLAVOR_VALUES,
  TOKEN_COUNTING_MODE_VALUES,
} from "@shared/contracts";

describe("model capability contracts", () => {
  it("exports runtime value lists for capability metadata", () => {
    expect(PROVIDER_FLAVOR_VALUES).toContain("openrouter");
    expect(PROVIDER_FLAVOR_VALUES).toContain("vercel-ai-gateway");
    expect(MODEL_CAPABILITY_SOURCE_VALUES).toContain("provider-catalog");
    expect(TOKEN_COUNTING_MODE_VALUES).toContain("openai-compatible-estimate");
    expect(DEFAULT_CONTEXT_BUDGET_POLICY.outputReserveTokens).toBeGreaterThan(0);
  });

  it("supports provider flavor and capability fields on model profiles", () => {
    const discoveredCapabilities: ModelCapability = {
      contextWindowTokens: 200000,
      maxInputTokens: 180000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStreaming: true,
      tokenCountingMode: "openai-compatible-estimate",
      source: "provider-catalog",
      lastValidatedAt: "2026-04-02T00:00:00.000Z",
      raw: {
        context_length: 200000,
      },
    };

    const budgetPolicy: ContextBudgetPolicy = {
      outputReserveTokens: 4096,
      systemReserveTokens: 2048,
      toolReserveTokens: 4096,
      memoryReserveTokens: 4096,
      safetyMarginTokens: 1024,
      compactTriggerRatio: 0.8,
      minRecentTurnsToKeep: 12,
      maxSummaryBlocks: 4,
      enableLongTermMemory: true,
      enableContextCheckpoint: true,
    };

    const profile: ModelProfile = {
      id: "profile-1",
      name: "OpenRouter GPT",
      provider: "openai-compatible",
      providerFlavor: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "openai/gpt-4.1",
      discoveredCapabilities,
      capabilityOverrides: {
        maxOutputTokens: 4096,
        source: "manual-override",
      },
      budgetPolicy,
    };

    expect(profile.providerFlavor).toBe("openrouter");
    expect(profile.discoveredCapabilities?.contextWindowTokens).toBe(200000);
    expect(profile.capabilityOverrides?.maxOutputTokens).toBe(4096);
    expect(profile.budgetPolicy?.outputReserveTokens).toBe(4096);
  });

  it("supports richer model catalog items", () => {
    const providerFlavor: ProviderFlavor = "vercel-ai-gateway";
    const item: ModelCatalogItem = {
      id: "openai/gpt-4.1",
      name: "GPT-4.1",
      provider: "openai-compatible",
      providerFlavor,
      contextWindowTokens: 1047576,
      maxInputTokens: 1014800,
      maxOutputTokens: 32768,
      supportsTools: true,
      supportsStreaming: true,
      source: "provider-catalog",
      raw: {
        context_window: 1047576,
        max_tokens: 32768,
      },
    };

    expect(item.providerFlavor).toBe("vercel-ai-gateway");
    expect(item.contextWindowTokens).toBe(1047576);
    expect(item.maxOutputTokens).toBe(32768);
    expect(item.source).toBe("provider-catalog");
  });

  it("preserves capability fields through JSON serialization", () => {
    const profile: ModelProfile = {
      id: "profile-2",
      name: "Catalog Profile",
      provider: "openai-compatible",
      providerFlavor: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test-key",
      model: "anthropic/claude-sonnet-4",
      discoveredCapabilities: {
        contextWindowTokens: 200000,
        maxInputTokens: 190000,
        maxOutputTokens: 64000,
        supportsTools: true,
        supportsStreaming: true,
        source: "provider-detail",
      },
      budgetPolicy: {
        outputReserveTokens: 8000,
        compactTriggerRatio: 0.75,
      },
    };

    const parsed = JSON.parse(JSON.stringify(profile)) as ModelProfile;

    expect(parsed.providerFlavor).toBe("openrouter");
    expect(parsed.discoveredCapabilities?.maxInputTokens).toBe(190000);
    expect(parsed.budgetPolicy?.compactTriggerRatio).toBe(0.75);
  });
});
