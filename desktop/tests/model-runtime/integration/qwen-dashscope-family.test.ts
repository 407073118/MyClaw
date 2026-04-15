import { describe, expect, it } from "vitest";

import { resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("qwen dashscope family", () => {
  it("promotes qwen to qwen-native and preserves the routed protocol with conservative tools", () => {
    const policy = resolveFamilyPolicy({
      profile: makeProfile({
        providerFlavor: "qwen",
        model: "qwen-max",
        protocolTarget: "openai-responses",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });
    expect(policy.providerFamily).toBe("qwen-native");
    expect(policy.protocolTarget).toBe("openai-responses");
    expect(policy.toolCompileMode).toBe("openai-compatible-conservative");
  });
});
