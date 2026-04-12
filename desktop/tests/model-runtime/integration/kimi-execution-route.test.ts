import { describe, expect, it } from "vitest";

import { type ModelProfile } from "@shared/contracts";
import { buildProtocolRequestHeaders, resolveProtocolEndpointUrl } from "../../../src/main/services/model-client";
import { resolveVendorRuntimePolicy } from "../../../src/main/services/model-runtime/vendor-runtime-policy-resolver";
import { makeLegacyExecutionPlan } from "../contracts/test-helpers";

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "kimi-profile",
    name: "Kimi",
    provider: "openai-compatible",
    providerFlavor: "moonshot",
    baseUrl: "https://api.moonshot.cn",
    baseUrlMode: "provider-root",
    apiKey: "kimi-test-key",
    model: "kimi-k2-0905-preview",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("kimi execution route", () => {
  it("resolves anthropic-first execution to a messages endpoint while keeping bearer auth", () => {
    const profile = makeProfile();
    const policy = resolveVendorRuntimePolicy({
      profile,
      legacyExecutionPlan: makeLegacyExecutionPlan(),
    });

    expect(policy.vendorFamily).toBe("kimi");
    expect(policy.selectedProtocolTarget).toBe("anthropic-messages");
    expect(resolveProtocolEndpointUrl(profile, policy.selectedProtocolTarget)).toBe("https://api.moonshot.cn/v1/messages");
    expect(buildProtocolRequestHeaders(profile, policy.selectedProtocolTarget)).toMatchObject({
      authorization: "Bearer kimi-test-key",
    });
  });
});
