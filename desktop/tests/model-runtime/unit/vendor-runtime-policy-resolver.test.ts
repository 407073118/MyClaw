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
});
