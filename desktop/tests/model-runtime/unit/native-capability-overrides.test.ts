import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { findRegistryCapability } from "../../../src/main/services/model-capability-registry";
import { resolveModelCapability } from "../../../src/main/services/model-capability-resolver";

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-openai",
    name: "OpenAI",
    provider: "openai-compatible",
    providerFlavor: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-5.4",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("native capability overrides", () => {
  it("loads exact OpenAI native capability data from the bundled model catalog", () => {
    const capability = findRegistryCapability(makeProfile({
      model: "gpt-5.4",
    }));

    expect(capability).not.toBeNull();
    expect(capability).toMatchObject({
      source: "registry",
      supportsReasoning: true,
      supportsPromptCaching: true,
      supportsVision: true,
      tokenCountingMode: "provider-native",
    });
    expect((capability?.contextWindowTokens ?? 0) > 131072).toBe(true);
  });

  it("falls back to the OpenAI family rule for unknown gpt-5 variants", () => {
    const capability = findRegistryCapability(makeProfile({
      model: "gpt-5.4-pro-preview",
    }));

    expect(capability).not.toBeNull();
    expect(capability?.supportsReasoning).toBe(true);
    expect(capability?.tokenCountingMode).toBe("provider-native");
    expect((capability?.contextWindowTokens ?? 0) >= 1000000).toBe(true);
  });

  it("still lets manual overrides win over bundled OpenAI capability data", () => {
    const resolved = resolveModelCapability(makeProfile({
      model: "gpt-5.4",
      capabilityOverrides: {
        maxOutputTokens: 4096,
      },
    }));

    expect(resolved.effective.source).toBe("manual-override");
    expect(resolved.effective.maxOutputTokens).toBe(4096);
    expect((resolved.registry?.contextWindowTokens ?? 0) >= 1000000).toBe(true);
  });
});
