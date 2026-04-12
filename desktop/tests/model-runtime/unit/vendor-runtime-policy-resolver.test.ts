import { describe, expect, it } from "vitest";

import { resolveVendorRuntimePolicy } from "../../../src/main/services/model-runtime/vendor-runtime-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("vendor runtime policy resolver", () => {
  it("resolves multiple supported protocols for Qwen", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.vendorFamily).toBe("qwen");
    expect(policy.supportedProtocolTargets).toEqual(expect.arrayContaining([
      "openai-chat-compatible",
      "openai-responses",
      "anthropic-messages",
    ]));
    expect(policy.recommendedProtocolTarget).toBe("openai-responses");
  });

  it("prefers anthropic messages for Kimi by default", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2-0905-preview",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.vendorFamily).toBe("kimi");
    expect(policy.recommendedProtocolTarget).toBe("anthropic-messages");
    expect(policy.selectedProtocolTarget).toBe("anthropic-messages");
  });

  it("respects saved protocol preferences when no explicit protocolTarget is set", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
        protocolTarget: undefined,
        savedProtocolPreferences: ["anthropic-messages", "openai-chat-compatible"],
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.selectedProtocolTarget).toBe("anthropic-messages");
    expect(policy.protocolSelectionSource).toBe("saved");
    expect(policy.protocolSelectionReason).toBe("saved-protocol-preference");
  });

  it("falls back from unsupported saved protocol preferences to the recommended route", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1",
        protocolTarget: undefined,
        savedProtocolPreferences: ["anthropic-messages"],
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.selectedProtocolTarget).toBe("openai-responses");
    expect(policy.protocolSelectionSource).toBe("fallback");
    expect(policy.protocolSelectionReason).toBe("saved-protocol-unsupported");
  });

  it("keeps Ark responses as the recommended protocol while retaining fallbacks", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "volcengine-ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-code",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.vendorFamily).toBe("volcengine-ark");
    expect(policy.recommendedProtocolTarget).toBe("openai-responses");
    expect(policy.fallbackChain).toEqual([
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
  });

  it("keeps BR MiniMax as a MiniMax deployment profile", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "br-minimax",
        baseUrl: "http://api-pre.cybotforge.100credit.cn",
        model: "minimax-m2-5",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan({
        replayPolicy: "assistant-turn-with-reasoning",
      }),
    });

    expect(policy.vendorFamily).toBe("minimax");
    expect(policy.deploymentProfile).toBe("br-private");
    expect(policy.providerFamily).toBe("br-minimax");
  });

  it("keeps public minimax on the public vendor path without inheriting the br-private deployment profile", () => {
    const policy = resolveVendorRuntimePolicy({
      profile: makeProfile({
        providerFlavor: "minimax-anthropic",
        baseUrl: "https://api.minimax.chat/v1",
        model: "minimax-text-01",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
      requestedProtocolTarget: "anthropic-messages",
    });

    expect(policy.vendorFamily).toBe("minimax");
    expect(policy.deploymentProfile).toBeUndefined();
  });
});
