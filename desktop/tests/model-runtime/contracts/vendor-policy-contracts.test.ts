import { describe, expect, it } from "vitest";

import {
  VENDOR_FAMILY_VALUES,
  type VendorFamily,
} from "@shared/contracts";
import {
  getVendorPolicy,
  listVendorPolicies,
} from "../../../src/main/services/model-runtime/vendor-policy-registry";

describe("vendor policy contracts", () => {
  it("exports first-tier vendor families and generic fallbacks", () => {
    const payload = JSON.parse(JSON.stringify({
      vendorFamilies: VENDOR_FAMILY_VALUES,
    })) as {
      vendorFamilies: VendorFamily[];
    };

    expect(payload.vendorFamilies).toEqual(expect.arrayContaining([
      "openai",
      "anthropic",
      "qwen",
      "kimi",
      "volcengine-ark",
      "minimax",
      "generic-openai-compatible",
      "generic-local-gateway",
    ]));
  });

  it("declares multiple protocol routes for first-tier vendors", () => {
    const qwenPolicy = getVendorPolicy("qwen");

    expect(qwenPolicy.supportedProtocols).toEqual(expect.arrayContaining([
      "openai-chat-compatible",
      "openai-responses",
      "anthropic-messages",
    ]));
  });

  it("keeps BR MiniMax as a deployment profile under the MiniMax vendor family", () => {
    const minimaxPolicy = getVendorPolicy("minimax");

    expect(minimaxPolicy.deploymentProfiles).toContain("br-private");
    expect(minimaxPolicy.supportedProtocols).toEqual(expect.arrayContaining([
      "openai-chat-compatible",
      "anthropic-messages",
    ]));
  });

  it("can enumerate the whole vendor policy registry", () => {
    const ids = listVendorPolicies().map((policy) => policy.vendorFamily);

    expect(ids).toEqual(expect.arrayContaining([
      "openai",
      "anthropic",
      "qwen",
      "kimi",
      "volcengine-ark",
      "minimax",
    ]));
  });
});
