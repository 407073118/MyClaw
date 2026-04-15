import { describe, expect, it } from "vitest";

import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("kimi family", () => {
  it("treats Moonshot/Kimi as a first-tier vendor with anthropic-first recommendation", () => {
    const plan = buildTurnExecutionPlan({
      profile: makeProfile({
        providerFlavor: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2-0905-preview",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(plan.vendorFamily).toBe("kimi");
    expect(plan.providerFamily).toBe("moonshot-native");
    expect(plan.recommendedProtocolTarget).toBe("anthropic-messages");
    expect(plan.protocolTarget).toBe("anthropic-messages");
    expect(plan.supportedProtocolTargets).toEqual(expect.arrayContaining([
      "anthropic-messages",
      "openai-chat-compatible",
    ]));
  });
});
