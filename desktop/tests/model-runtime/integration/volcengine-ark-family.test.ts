import { describe, expect, it } from "vitest";

import { inferProviderFamily, resolveFamilyPolicy } from "../../../src/main/services/model-runtime/family-policy-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("volcengine ark family", () => {
  it("recognizes ark taxonomy from base url", () => {
    expect(inferProviderFamily(makeProfile({ providerFlavor: "volcengine-ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }))).toBe("volcengine-ark");
  });

  it("keeps ark on compatible protocol with ark-specific tool policy", () => {
    const policy = resolveFamilyPolicy({
      profile: makeProfile({
        providerFlavor: "volcengine-ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      }),
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.providerFamily).toBe("volcengine-ark");
    expect(policy.protocolTarget).toBe("openai-chat-compatible");
    expect(policy.toolCompileMode).toBe("openai-compatible-ark");
    expect(policy.fallbackFamilies).toEqual(["generic-openai-compatible"]);
  });
});
