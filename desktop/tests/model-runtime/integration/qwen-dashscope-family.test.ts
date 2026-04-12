import { describe, expect, it } from "vitest";

import { resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("qwen dashscope family", () => {
  it("stays on compatible protocol with conservative tools", () => {
    const policy = resolveFamilyPolicy({ profile: makeProfile({ providerFlavor: "qwen", model: "qwen-max" }), legacyExecutionPlan: makeLegacyExecutionPlan() });
    expect(policy.protocolTarget).toBe("openai-chat-compatible");
    expect(policy.toolCompileMode).toBe("openai-compatible-conservative");
  });
});
