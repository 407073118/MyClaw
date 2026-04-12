import { describe, expect, it } from "vitest";

import { resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("anthropic native family", () => {
  it("selects messages-native policies", () => {
    const policy = resolveFamilyPolicy({ profile: makeProfile({ provider: "anthropic", providerFlavor: "anthropic", model: "claude-3-7-sonnet" }), legacyExecutionPlan: makeLegacyExecutionPlan() });
    expect(policy.protocolTarget).toBe("anthropic-messages");
    expect(policy.toolCompileMode).toBe("anthropic-detailed-description");
  });
});
