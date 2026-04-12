import { describe, expect, it } from "vitest";

import { resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("openai native family", () => {
  it("selects responses-native policies", () => {
    const policy = resolveFamilyPolicy({ profile: makeProfile({ providerFlavor: "openai" }), legacyExecutionPlan: makeLegacyExecutionPlan() });
    expect(policy.protocolTarget).toBe("openai-responses");
    expect(policy.toolCompileMode).toBe("openai-strict");
  });
});
