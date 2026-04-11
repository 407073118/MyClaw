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
      workflowMode: "default",
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

  it("selects vendor-specific adapters for first-tier vendor profiles", () => {
    expect(buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1",
      }),
      capability: makeCapability(),
    }).adapterId).toBe("openai-native");

    expect(buildExecutionPlan({
      profile: makeProfile({
        provider: "anthropic",
        providerFlavor: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-3-7-sonnet",
      }),
      capability: makeCapability(),
    }).adapterId).toBe("anthropic-native");

    expect(buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
      }),
      capability: makeCapability(),
    }).adapterId).toBe("qwen");

    expect(buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2-0905-preview",
      }),
      capability: makeCapability(),
    }).adapterId).toBe("kimi");

    expect(buildExecutionPlan({
      profile: makeProfile({
        providerFlavor: "volcengine-ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-code",
      }),
      capability: makeCapability(),
    }).adapterId).toBe("volcengine-ark");
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
