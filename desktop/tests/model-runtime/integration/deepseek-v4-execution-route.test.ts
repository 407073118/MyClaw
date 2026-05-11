import { describe, expect, it } from "vitest";

import { type ModelProfile } from "@shared/contracts";
import { buildProtocolRequestHeaders, resolveProtocolEndpointUrl } from "../../../src/main/services/model-client";
import { resolveVendorRuntimePolicy } from "../../../src/main/services/model-runtime/vendor-runtime-policy-resolver";
import { resolveTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan } from "../contracts/test-helpers";

/** 构造 DeepSeek V4 测试配置，覆盖默认官方根地址与 V4 Pro 模型。 */
function makeDeepSeekProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "deepseek-v4-profile",
    name: "DeepSeek V4",
    provider: "openai-compatible",
    providerFlavor: "deepseek",
    providerFamily: "deepseek",
    vendorFamily: "deepseek",
    baseUrl: "https://api.deepseek.com",
    baseUrlMode: "provider-root",
    apiKey: "deepseek-test-key",
    model: "deepseek-v4-pro",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("deepseek v4 execution route", () => {
  it("keeps OpenAI-compatible as the default route while exposing the official Anthropic route", () => {
    const profile = makeDeepSeekProfile();
    const legacyExecutionPlan = makeLegacyExecutionPlan();
    const policy = resolveVendorRuntimePolicy({
      profile,
      legacyExecutionPlan,
    });
    const plan = resolveTurnExecutionPlan({
      profile,
      legacyExecutionPlan,
      selectedModelProfileId: profile.id,
    });

    expect(policy.vendorFamily).toBe("deepseek");
    expect(policy.recommendedProtocolTarget).toBe("openai-chat-compatible");
    expect(policy.selectedProtocolTarget).toBe("openai-chat-compatible");
    expect(policy.supportedProtocolTargets).toEqual(expect.arrayContaining([
      "openai-chat-compatible",
      "anthropic-messages",
    ]));
    expect(plan.providerFamily).toBe("deepseek");
    expect(plan.vendorFamily).toBe("deepseek");
    expect(plan.protocolTarget).toBe("openai-chat-compatible");
    expect(plan.recommendedProtocolTarget).toBe("openai-chat-compatible");
  });

  it("resolves DeepSeek Anthropic API endpoint and x-api-key headers", () => {
    const profile = makeDeepSeekProfile();
    const anthropicBaseProfile = makeDeepSeekProfile({ baseUrl: "https://api.deepseek.com/anthropic" });
    const anthropicV1BaseProfile = makeDeepSeekProfile({ baseUrl: "https://api.deepseek.com/anthropic/v1" });

    expect(resolveProtocolEndpointUrl(profile, "openai-chat-compatible")).toBe("https://api.deepseek.com/chat/completions");
    expect(resolveProtocolEndpointUrl(profile, "anthropic-messages")).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(resolveProtocolEndpointUrl(anthropicBaseProfile, "anthropic-messages")).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(resolveProtocolEndpointUrl(anthropicV1BaseProfile, "anthropic-messages")).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(buildProtocolRequestHeaders(profile, "anthropic-messages")).toMatchObject({
      "x-api-key": "deepseek-test-key",
    });
    expect(buildProtocolRequestHeaders(profile, "anthropic-messages")).not.toHaveProperty("authorization");
  });
});
