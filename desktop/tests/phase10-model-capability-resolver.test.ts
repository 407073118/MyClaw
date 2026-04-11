import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { findRegistryCapability } from "../src/main/services/model-capability-registry";
import { resolveModelCapability } from "../src/main/services/model-capability-resolver";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "Profile",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    model: "test-model",
    ...overrides,
  };
}

describe("resolveModelCapability", () => {
  it("uses manual override over discovered and registry", () => {
    const profile = buildProfile({
      providerFlavor: "openrouter",
      model: "openai/gpt-4.1",
      discoveredCapabilities: {
        contextWindowTokens: 200000,
        maxInputTokens: 180000,
        maxOutputTokens: 32768,
        source: "provider-detail",
      },
      capabilityOverrides: {
        maxOutputTokens: 4096,
      },
    });

    const resolved = resolveModelCapability(profile);

    expect(resolved.effective.source).toBe("manual-override");
    expect(resolved.effective.maxOutputTokens).toBe(4096);
    expect(resolved.effective.contextWindowTokens).toBe(200000);
  });

  it("uses discovered capability over registry", () => {
    const profile = buildProfile({
      providerFlavor: "openrouter",
      model: "openai/gpt-4.1",
      discoveredCapabilities: {
        contextWindowTokens: 190000,
        maxInputTokens: 170000,
        maxOutputTokens: 12000,
        source: "provider-detail",
      },
    });

    const resolved = resolveModelCapability(profile);

    expect(resolved.effective.source).toBe("provider-detail");
    expect(resolved.effective.maxOutputTokens).toBe(12000);
    expect(resolved.effective.contextWindowTokens).toBe(190000);
  });

  it("uses registry when no discovered or override exists", () => {
    const profile = buildProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      model: "claude-sonnet-4-20250514",
    });

    const resolved = resolveModelCapability(profile);

    expect(resolved.registry).not.toBeNull();
    expect(resolved.effective.source).toBe("registry");
    expect((resolved.effective.contextWindowTokens ?? 0) > 32768).toBe(true);
  });

  it("falls back to safe defaults when no capability source is available", () => {
    const profile = buildProfile({
      providerFlavor: "generic-openai-compatible",
      model: "custom-model",
    });

    const resolved = resolveModelCapability(profile, { registryCapability: null });

    expect(resolved.registry).toBeNull();
    expect(resolved.effective.source).toBe("default");
    expect(resolved.effective.contextWindowTokens).toBe(32768);
    expect(resolved.effective.maxOutputTokens).toBe(4096);
  });

  it("keeps backward compatibility with legacy contextWindow", () => {
    const profile = buildProfile({
      providerFlavor: "generic-openai-compatible",
      model: "legacy-model",
      contextWindow: 131072,
    });

    const resolved = resolveModelCapability(profile, { registryCapability: null });

    expect(resolved.effective.source).toBe("observed-response");
    expect(resolved.effective.contextWindowTokens).toBe(131072);
    expect(resolved.effective.maxInputTokens).toBe(122880);
    expect(resolved.effective.maxOutputTokens).toBe(4096);
  });
});

describe("findRegistryCapability", () => {
  it("returns capability from registry for known provider flavor", () => {
    const profile = buildProfile({
      providerFlavor: "openrouter",
      model: "openai/gpt-4.1",
    });

    const capability = findRegistryCapability(profile);

    expect(capability).not.toBeNull();
    expect(capability?.source).toBe("registry");
    expect((capability?.contextWindowTokens ?? 0) > 0).toBe(true);
  });

  it("returns capability from registry for Moonshot/Kimi profiles", () => {
    const profile = buildProfile({
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
    });

    const capability = findRegistryCapability(profile);

    expect(capability).not.toBeNull();
    expect(capability?.source).toBe("registry");
    expect(capability?.supportsTools).toBe(true);
    expect(capability?.supportsPromptCaching).toBe(true);
    expect(capability?.supportsReasoning).toBe(true);
    expect(capability?.contextWindowTokens).toBe(262144);
  });
});
