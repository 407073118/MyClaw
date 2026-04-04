import { describe, expect, it } from "vitest";

import type { ModelCapability, ModelProfile } from "@shared/contracts";
import { buildReasoningExecutionPlan, resolveSessionThinkingState } from "../src/main/services/reasoning-runtime";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "minimax-profile",
    name: "MiniMax Profile",
    provider: "openai-compatible",
    providerFlavor: "minimax-anthropic",
    baseUrl: "https://api.minimaxi.com",
    baseUrlMode: "provider-root",
    apiKey: "test-key",
    model: "MiniMax-M2.5",
    ...overrides,
  };
}

function buildCapability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    source: "registry",
    supportsReasoning: true,
    supportsEffort: true,
    requiresReasoningReplay: true,
    preferredProtocol: "anthropic",
    raw: {
      supportsReasoningSplit: true,
    },
    ...overrides,
  };
}

describe("phase 10 minimax adapter", () => {
  it("uses enhanced mode for provider-root MiniMax profiles and enables reasoning_split", () => {
    const thinkingState = resolveSessionThinkingState({
      thinkingEnabled: true,
      thinkingSource: "user-toggle",
    });

    const plan = buildReasoningExecutionPlan({
      thinkingState,
      capability: buildCapability(),
      profile: buildProfile(),
    });

    expect(plan.enabled).toBe(true);
    expect(plan.degradedReason).toBeNull();
    expect(plan.adapterKey).toBe("minimax");
    expect(plan.mode).toBe("enhanced");
    expect(plan.replayPolicy).toBe("required");
    expect(plan.bodyPatch).toEqual({
      reasoning: {
        effort: "medium",
      },
      reasoning_split: true,
    });
  });

  it("keeps manual MiniMax profiles on compatibility mode without forcing reasoning_split", () => {
    const thinkingState = resolveSessionThinkingState({
      thinkingEnabled: true,
      thinkingSource: "user-toggle",
    });

    const plan = buildReasoningExecutionPlan({
      thinkingState,
      capability: buildCapability(),
      profile: buildProfile({
        baseUrl: "https://gateway.example.com/v1",
        baseUrlMode: "manual",
      }),
    });

    expect(plan.enabled).toBe(true);
    expect(plan.degradedReason).toBeNull();
    expect(plan.adapterKey).toBe("minimax");
    expect(plan.mode).toBe("compatibility");
    expect(plan.bodyPatch).toEqual({
      reasoning: {
        effort: "medium",
      },
    });
    expect(plan.bodyPatch.reasoning_split).toBeUndefined();
  });

  it("returns a degraded plan when MiniMax reasoning effort is unsupported", () => {
    const thinkingState = resolveSessionThinkingState({
      thinkingEnabled: true,
      thinkingSource: "user-toggle",
    });

    const plan = buildReasoningExecutionPlan({
      thinkingState,
      capability: buildCapability({
        supportsEffort: false,
      }),
      profile: buildProfile(),
    });

    expect(plan.enabled).toBe(true);
    expect(plan.adapterKey).toBe("minimax");
    expect(plan.mode).toBe("enhanced");
    expect(plan.degradedReason).toBe("minimax-reasoning-effort-unsupported");
    expect(plan.bodyPatch).toEqual({});
  });
});
