import { describe, expect, it } from "vitest";

import { resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("generic compatible family", () => {
  it("uses relaxed defaults and fallback-friendly policy", () => {
    const policy = resolveFamilyPolicy({ profile: makeProfile({ providerFlavor: "generic-openai-compatible" }), legacyExecutionPlan: makeLegacyExecutionPlan() });
    expect(policy.providerFamily).toBe("generic-openai-compatible");
    expect(policy.toolCompileMode).toBe("openai-compatible-relaxed");
  });
});
