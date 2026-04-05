import { describe, expect, it } from "vitest";

import type {
  ModelCapability,
  ModelProfile,
  SessionRuntimeIntent,
} from "@shared/contracts";
import {
  buildExecutionPlan,
  resolveSessionRuntimeIntent,
} from "../src/main/services/reasoning-runtime";

/** 构造最小 model profile，方便聚焦验证 runtime 选择逻辑。 */
function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "Test Profile",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "gpt-4.1",
    ...overrides,
  };
}

/** 构造最小 capability，避免测试被无关字段噪声干扰。 */
function makeCapability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    supportsReasoning: true,
    source: "default",
    ...overrides,
  };
}

describe("Phase 1 reasoning runtime", () => {
  it("resolves the default runtime intent shell", () => {
    expect(resolveSessionRuntimeIntent()).toEqual<Required<SessionRuntimeIntent>>({
      reasoningMode: "auto",
      reasoningEffort: "medium",
      adapterHint: "auto",
      replayPolicy: "content-only",
    });
  });

  it("selects the BR MiniMax adapter with reasoning replay by default", () => {
    const plan = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      capability: makeCapability({ supportsReasoning: true }),
    });

    expect(plan).toMatchObject({
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      replayPolicy: "assistant-turn-with-reasoning",
      fallbackAdapterIds: ["openai-compatible"],
    });
  });

  it("uses openai-compatible defaults when no MiniMax signal is present", () => {
    const plan = buildExecutionPlan({
      profile: makeProfile(),
      capability: makeCapability({ supportsReasoning: false }),
    });

    expect(plan).toMatchObject({
      adapterId: "openai-compatible",
      replayPolicy: "content-only",
      fallbackAdapterIds: [],
    });
  });

  it("respects explicit replay overrides while keeping the Phase 1 fallback chain", () => {
    const plan = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      intent: {
        replayPolicy: "assistant-turn",
      },
      capability: makeCapability(),
    });

    expect(plan.replayPolicy).toBe("assistant-turn");
    expect(plan.fallbackAdapterIds).toEqual(["openai-compatible"]);
  });
});
