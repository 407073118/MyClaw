import { describe, expect, it } from "vitest";

import { resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { SESSION_RUNTIME_VERSION, type ExecutionPlan, type ModelProfile } from "@shared/contracts";

const legacyExecutionPlan: ExecutionPlan = {
  runtimeVersion: SESSION_RUNTIME_VERSION,
  adapterId: "openai-compatible",
  adapterSelectionSource: "profile",
  reasoningMode: "auto",
  replayPolicy: "assistant-turn-with-reasoning",
  fallbackAdapterIds: [],
};

const profile: ModelProfile = {
  id: "profile-1",
  name: "OpenAI",
  provider: "openai-compatible",
  providerFlavor: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "key",
  model: "gpt-4.1",
};

describe("family policy resolver", () => {
  it("produces stable policy ids and fallback families", () => {
    const policy = resolveFamilyPolicy({
      profile,
      legacyExecutionPlan,
      role: "plan",
    });

    expect(policy.providerFamily).toBe("openai-native");
    expect(policy.protocolTarget).toBe("openai-responses");
    expect(policy.fallbackFamilies).toEqual(["generic-openai-compatible"]);
    expect(policy.promptPolicyId).toBe("openai.responses.default");
    expect(policy.toolPolicyId).toBe("openai.tools.full");
    expect(policy.reasoningProfileId).toBe("openai.reasoning.native");
  });

  it("promotes qwen flavor to qwen-native while preserving the routed protocol target", () => {
    const policy = resolveFamilyPolicy({
      profile: {
        ...profile,
        providerFlavor: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
        protocolTarget: "openai-responses",
      },
      legacyExecutionPlan,
    });

    expect(policy.providerFamily).toBe("qwen-native");
    expect(policy.protocolTarget).toBe("openai-responses");
  });

  it("promotes moonshot flavor to moonshot-native while preserving the routed protocol target", () => {
    const policy = resolveFamilyPolicy({
      profile: {
        ...profile,
        providerFlavor: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2.5",
        protocolTarget: "anthropic-messages",
      },
      legacyExecutionPlan,
    });

    expect(policy.providerFamily).toBe("moonshot-native");
    expect(policy.protocolTarget).toBe("anthropic-messages");
  });
});
