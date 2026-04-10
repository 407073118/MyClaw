import { describe, expect, it } from "vitest";

import type {
  ModelCapability,
  ModelProfile,
  SessionRuntimeIntent,
} from "@shared/contracts";
import { buildExecutionPlan } from "../src/main/services/reasoning-runtime";

/** 构造最小 profile，确保测试只关注 execution plan 决策。 */
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

/** 构造最小 capability，避免无关字段影响断言。 */
function makeCapability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    supportsReasoning: true,
    source: "default",
    ...overrides,
  };
}

describe("Phase 2 execution plan runtime", () => {
  it("prefers explicit adapter selection from merged intent", () => {
    const plan = buildExecutionPlan({
      session: {
        runtimeIntent: {
          adapterHint: "auto",
          reasoningEffort: "low",
        },
      },
      intent: {
        adapterHint: "br-minimax",
        reasoningEffort: "high",
      } satisfies SessionRuntimeIntent,
      profile: makeProfile(),
      capability: makeCapability(),
    });

    expect(plan).toMatchObject({
      adapterId: "br-minimax",
      adapterSelectionSource: "intent",
      reasoningEffort: "high",
      adapterHint: "br-minimax",
      planSource: "intent",
      degradationReason: null,
      fallbackAdapterIds: ["openai-compatible"],
    });
  });

  it("emits capability degradation metadata when reasoning cannot be preserved", () => {
    const plan = buildExecutionPlan({
      session: {
        runtimeIntent: {
          reasoningEnabled: true,
        },
      },
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      capability: makeCapability({ supportsReasoning: false }),
    });

    expect(plan).toMatchObject({
      adapterId: "br-minimax",
      reasoningEnabled: false,
      replayPolicy: "assistant-turn",
      degradationReason: "capability-missing",
      planSource: "capability",
    });
  });

  it("lets explicit reasoningEnabled re-enable legacy disabled sessions", () => {
    const plan = buildExecutionPlan({
      session: {
        runtimeIntent: {
          reasoningMode: "disabled",
        },
      },
      intent: {
        reasoningEnabled: true,
      },
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      capability: makeCapability({ supportsReasoning: true }),
    });

    expect(plan).toMatchObject({
      reasoningEnabled: true,
      replayPolicy: "assistant-turn-with-reasoning",
      degradationReason: null,
      planSource: "intent",
    });
  });

  it("derives replay policy from intent, capability, and provider", () => {
    const explicitReplay = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      intent: {
        replayPolicy: "assistant-turn",
      },
      capability: makeCapability(),
    });

    const minimaxReasoning = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      capability: makeCapability({ supportsReasoning: true }),
    });

    const minimaxWithoutReasoning = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      capability: makeCapability({ supportsReasoning: false }),
    });

    const impossibleExplicitReplay = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      intent: {
        replayPolicy: "assistant-turn-with-reasoning",
      },
      capability: makeCapability({ supportsReasoning: false }),
    });

    const genericProvider = buildExecutionPlan({
      profile: makeProfile(),
      capability: makeCapability({ supportsReasoning: true }),
    });

    const genericExplicitReasoningReplay = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "generic-openai-compatible",
      }),
      intent: {
        replayPolicy: "assistant-turn-with-reasoning",
      },
      capability: makeCapability({ supportsReasoning: true }),
    });

    expect(explicitReplay.replayPolicy).toBe("assistant-turn");
    expect(minimaxReasoning.replayPolicy).toBe("assistant-turn-with-reasoning");
    expect(minimaxWithoutReasoning.replayPolicy).toBe("assistant-turn");
    expect(impossibleExplicitReplay).toMatchObject({
      reasoningEnabled: false,
      replayPolicy: "assistant-turn",
      degradationReason: "capability-missing",
      planSource: "capability",
    });
    expect(genericProvider.replayPolicy).toBe("assistant-turn-with-reasoning");
    expect(genericExplicitReasoningReplay).toMatchObject({
      reasoningEnabled: true,
      replayPolicy: "assistant-turn-with-reasoning",
      degradationReason: null,
      planSource: "intent",
    });
  });

  it("keeps plan metadata stable for MiniMax and generic providers", () => {
    const minimaxPlan = buildExecutionPlan({
      session: {
        runtimeIntent: {
          reasoningEnabled: true,
          toolStrategy: "auto",
        },
      },
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      capability: makeCapability({ supportsReasoning: true }),
    });

    const genericPlan = buildExecutionPlan({
      session: {
        runtimeIntent: {
          reasoningEnabled: true,
          toolStrategy: "auto",
        },
      },
      profile: makeProfile({
        providerFlavor: "generic-openai-compatible",
      }),
      capability: makeCapability({ supportsReasoning: true }),
    });

    expect(minimaxPlan).toMatchObject({
      adapterSelectionSource: "profile",
      planSource: "profile",
      degradationReason: null,
    });
    expect(genericPlan).toMatchObject({
      adapterSelectionSource: "profile",
      planSource: "profile",
      degradationReason: null,
    });
  });

  it("marks planSource as intent for explicit replay and tool strategy overrides", () => {
    const replayOverridePlan = buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        model: "minimax-m2-5",
      }),
      intent: {
        replayPolicy: "content-only",
      },
      capability: makeCapability({ supportsReasoning: true }),
    });

    const toolStrategyOverridePlan = buildExecutionPlan({
      profile: makeProfile(),
      session: {
        runtimeIntent: {
          toolStrategy: "off",
        },
      },
      capability: makeCapability({ supportsReasoning: true }),
    });

    expect(replayOverridePlan).toMatchObject({
      planSource: "intent",
    });
    expect(toolStrategyOverridePlan).toMatchObject({
      planSource: "intent",
    });
  });

  it("keeps request-time resets to default intent-sourced", () => {
    const plan = buildExecutionPlan({
      session: {
        runtimeIntent: {
          adapterHint: "br-minimax",
        },
      },
      intent: {
        adapterHint: "auto",
      },
      profile: makeProfile({
        providerFlavor: "generic-openai-compatible",
      }),
      capability: makeCapability({ supportsReasoning: true }),
    });

    expect(plan).toMatchObject({
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      planSource: "intent",
    });
  });
});
