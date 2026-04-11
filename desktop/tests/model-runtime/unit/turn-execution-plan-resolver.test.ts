import { describe, expect, it } from "vitest";

import { resolveTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { SESSION_RUNTIME_VERSION, type ExecutionPlan, type ModelProfile } from "@shared/contracts";

function buildLegacyExecutionPlan(): ExecutionPlan {
  return {
    runtimeVersion: SESSION_RUNTIME_VERSION,
    adapterId: "openai-compatible",
    adapterSelectionSource: "profile",
    reasoningMode: "auto",
    replayPolicy: "assistant-turn",
    fallbackAdapterIds: [],
  };
}

function buildProfile(overrides: Partial<ModelProfile>): ModelProfile {
  return {
    id: "profile-1",
    name: "Profile",
    provider: "openai-compatible",
    providerFlavor: "generic-openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "key",
    model: "gpt-4.1-mini",
    ...overrides,
  };
}

describe("turn execution plan resolver", () => {
  it.each([
    [buildProfile({ providerFlavor: "openai", baseUrl: "https://api.openai.com/v1" }), "openai-native", "openai", "openai-responses", "openai-responses"],
    [buildProfile({ provider: "anthropic", providerFlavor: "anthropic", model: "claude-3-7-sonnet" }), "anthropic-native", "anthropic", "anthropic-messages", "anthropic-messages"],
    [buildProfile({ providerFlavor: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" }), "qwen-dashscope", "qwen", "openai-chat-compatible", "openai-responses"],
    [buildProfile({ providerFlavor: "br-minimax", baseUrl: "https://api.minimax.chat/v1", model: "minimax-m2-5" }), "br-minimax", "minimax", "openai-chat-compatible", "anthropic-messages"],
    [buildProfile({ providerFlavor: "minimax-anthropic", baseUrl: "https://api.minimax.chat/v1", model: "minimax-m2-5" }), "br-minimax", "minimax", "openai-chat-compatible", "anthropic-messages"],
    [buildProfile({ providerFlavor: "volcengine-ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }), "volcengine-ark", "volcengine-ark", "openai-chat-compatible", "openai-responses"],
    [buildProfile({ providerFlavor: "generic-openai-compatible" }), "generic-openai-compatible", "generic-openai-compatible", "openai-chat-compatible", "openai-chat-compatible"],
  ])("maps %s to %s / %s / %s / %s", (profile, providerFamily, vendorFamily, protocolTarget, recommendedProtocolTarget) => {
    const plan = resolveTurnExecutionPlan({
      profile,
      legacyExecutionPlan: buildLegacyExecutionPlan(),
      selectedModelProfileId: profile.id,
    });

    expect(plan.providerFamily).toBe(providerFamily);
    expect(plan.vendorFamily).toBe(vendorFamily);
    expect(plan.protocolTarget).toBe(protocolTarget);
    expect(plan.recommendedProtocolTarget).toBe(recommendedProtocolTarget);
    expect(plan.supportedProtocolTargets?.length).toBeGreaterThan(0);
    expect(plan.fallbackChain).toBeDefined();
    expect(plan.selectedModelProfileId).toBe(profile.id);
  });
});
