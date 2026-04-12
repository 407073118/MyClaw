import { describe, expect, it } from "vitest";

import { type ModelProfile } from "@shared/contracts";
import { resolveProtocolEndpointUrl } from "../../../src/main/services/model-client";
import { resolveVendorRuntimePolicy } from "../../../src/main/services/model-runtime/vendor-runtime-policy-resolver";
import { makeLegacyExecutionPlan } from "../contracts/test-helpers";

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "ark-profile",
    name: "Ark",
    provider: "openai-compatible",
    providerFlavor: "volcengine-ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    baseUrlMode: "manual",
    apiKey: "ark-test-key",
    model: "doubao-seed-code",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("ark execution route", () => {
  it("keeps ark on responses-first routing with a protocol-specific endpoint", () => {
    const profile = makeProfile();
    const policy = resolveVendorRuntimePolicy({
      profile,
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.vendorFamily).toBe("volcengine-ark");
    expect(policy.recommendedProtocolTarget).toBe("openai-responses");
    expect(resolveProtocolEndpointUrl(profile, "openai-responses")).toBe("https://ark.cn-beijing.volces.com/api/v3/responses");
  });
});
