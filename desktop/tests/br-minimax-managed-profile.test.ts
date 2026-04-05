import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import {
  BR_MINIMAX_BASE_URL,
  BR_MINIMAX_BUDGET_POLICY,
  BR_MINIMAX_DEFAULT_NAME,
  BR_MINIMAX_MODEL,
  BR_MINIMAX_PROVIDER_FLAVOR,
  BR_MINIMAX_REQUEST_BODY,
  createBrMiniMaxProfile,
  isBrMiniMaxProfile,
} from "@shared/br-minimax";
import { findRegistryCapability } from "../src/main/services/model-capability-registry";
import { resolveModelCapability } from "../src/main/services/model-capability-resolver";

describe("br-minimax managed profile", () => {
  it("creates a locked private deployment profile with only apiKey as input", () => {
    const profile = createBrMiniMaxProfile({ apiKey: "br-test-key" });

    expect(profile.name).toBe(BR_MINIMAX_DEFAULT_NAME);
    expect(profile.provider).toBe("openai-compatible");
    expect(profile.providerFlavor).toBe(BR_MINIMAX_PROVIDER_FLAVOR);
    expect(profile.baseUrl).toBe(BR_MINIMAX_BASE_URL);
    expect(profile.baseUrlMode).toBe("provider-root");
    expect(profile.model).toBe(BR_MINIMAX_MODEL);
    expect(profile.requestBody).toEqual(BR_MINIMAX_REQUEST_BODY);
    expect(profile.budgetPolicy).toEqual(BR_MINIMAX_BUDGET_POLICY);
    expect(isBrMiniMaxProfile(profile)).toBe(true);
  });

  it("uses br-minimax capability defaults instead of generic openai fallback", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    }) as ModelProfile;

    const registry = findRegistryCapability(profile);
    const resolved = resolveModelCapability(profile);

    expect(registry?.contextWindowTokens).toBe(102400);
    expect(registry?.maxInputTokens).toBe(98304);
    expect(registry?.maxOutputTokens).toBe(8192);
    expect(resolved.effective.contextWindowTokens).toBe(102400);
    expect(resolved.effective.supportsReasoning).toBe(true);
  });
});
