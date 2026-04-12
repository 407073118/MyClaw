import { describe, expect, it } from "vitest";

import { type ModelProfile } from "@shared/contracts";
import { buildProtocolRequestHeaders, resolveProtocolEndpointUrl } from "../../../src/main/services/model-client";
import { resolveVendorRuntimePolicy } from "../../../src/main/services/model-runtime/vendor-runtime-policy-resolver";
import { resolveTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan } from "../contracts/test-helpers";

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "minimax-public-profile",
    name: "MiniMax Public",
    provider: "openai-compatible",
    providerFlavor: "minimax-anthropic",
    baseUrl: "https://api.minimax.chat",
    baseUrlMode: "provider-root",
    apiKey: "minimax-test-key",
    model: "minimax-text-01",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("public minimax execution route", () => {
  it("keeps public minimax outside the br-private deployment path while allowing messages-route execution", () => {
    const profile = makeProfile();
    const legacyExecutionPlan = makeLegacyExecutionPlan();
    const policy = resolveVendorRuntimePolicy({
      profile,
      legacyExecutionPlan,
      requestedProtocolTarget: "anthropic-messages",
    });
    const plan = resolveTurnExecutionPlan({
      profile,
      legacyExecutionPlan,
      requestedProtocolTarget: "anthropic-messages",
    });

    expect(policy.vendorFamily).toBe("minimax");
    expect(policy.deploymentProfile).toBeUndefined();
    expect(plan.providerFamily).toBe("generic-openai-compatible");
    expect(plan.protocolTarget).toBe("anthropic-messages");
    expect(resolveProtocolEndpointUrl(profile, "anthropic-messages")).toBe("https://api.minimax.chat/v1/messages");
    expect(buildProtocolRequestHeaders(profile, "anthropic-messages")).toMatchObject({
      authorization: "Bearer minimax-test-key",
    });
  });
});
