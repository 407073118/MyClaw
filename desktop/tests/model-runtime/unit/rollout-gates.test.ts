import { afterEach, describe, expect, it } from "vitest";

import {
  isProviderFamilyEnabled,
  listProviderFamilyRolloutGates,
  resolveEffectiveExecutionRolloutGate,
  resolveProviderFamilyRolloutGate,
  resolveVendorProtocolRolloutGate,
} from "../../../src/main/services/model-runtime/rollout-gates";

describe("rollout gates", () => {
  afterEach(() => {
    delete process.env.MYCLAW_ROLLOUT_OPENAI_NATIVE;
  });

  it("keeps only the generic compatible family enabled by default", () => {
    expect(resolveProviderFamilyRolloutGate("generic-openai-compatible")).toMatchObject({
      enabled: true,
      reason: "default-compatible-baseline",
    });
    expect(resolveProviderFamilyRolloutGate("openai-native")).toMatchObject({
      enabled: false,
    });
    expect(resolveProviderFamilyRolloutGate("anthropic-native")).toMatchObject({
      enabled: false,
    });
    expect(resolveProviderFamilyRolloutGate("qwen-dashscope")).toMatchObject({
      enabled: false,
    });
    expect(resolveProviderFamilyRolloutGate("br-minimax")).toMatchObject({
      enabled: false,
    });
    expect(resolveProviderFamilyRolloutGate("volcengine-ark")).toMatchObject({
      enabled: false,
    });
  });

  it("allows explicit runtime and env overrides on top of conservative defaults", () => {
    expect(isProviderFamilyEnabled("openai-native")).toBe(false);
    expect(isProviderFamilyEnabled("openai-native", { "openai-native": true })).toBe(true);

    process.env.MYCLAW_ROLLOUT_OPENAI_NATIVE = "true";
    expect(resolveProviderFamilyRolloutGate("openai-native")).toMatchObject({
      enabled: true,
      reason: "env-override",
    });
  });

  it("keeps rollout listing deterministic", () => {
    expect(listProviderFamilyRolloutGates().map((gate) => gate.providerFamily)).toEqual([
      "generic-openai-compatible",
      "qwen-dashscope",
      "qwen-native",
      "openai-native",
      "anthropic-native",
      "moonshot-native",
      "br-minimax",
      "volcengine-ark",
      "deepseek",
    ]);
  });

  it("can toggle vendor protocol gates independently", () => {
    expect(resolveVendorProtocolRolloutGate("qwen", "openai-responses")).toMatchObject({
      enabled: true,
      state: "beta",
    });
    expect(resolveVendorProtocolRolloutGate("qwen", "anthropic-messages")).toMatchObject({
      enabled: false,
      state: "beta",
    });
    expect(resolveVendorProtocolRolloutGate("kimi", "anthropic-messages")).toMatchObject({
      enabled: true,
      state: "stable",
    });
    expect(resolveVendorProtocolRolloutGate("volcengine-ark", "openai-responses")).toMatchObject({
      enabled: false,
      state: "beta",
    });
    expect(resolveVendorProtocolRolloutGate("minimax", "anthropic-messages")).toMatchObject({
      enabled: false,
      state: "beta",
    });
  });

  it("keeps Qwen responses available by default so canonical routing does not fall back to compatible", () => {
    expect(resolveEffectiveExecutionRolloutGate({
      providerFamily: "qwen-native",
      vendorFamily: "qwen",
      protocolTarget: "openai-responses",
    })).toMatchObject({
      enabled: true,
    });
  });

  it("lets explicit vendor+protocol flags override the disabled family gate", () => {
    expect(resolveEffectiveExecutionRolloutGate({
      providerFamily: "qwen-dashscope",
      vendorFamily: "qwen",
      protocolTarget: "openai-responses",
      providerFlags: {
        "qwen-dashscope": false,
      },
      vendorProtocolFlags: {
        "qwen:openai-responses": true,
      },
    })).toMatchObject({
      enabled: true,
      reason: "runtime-flag-override",
    });
  });
});
