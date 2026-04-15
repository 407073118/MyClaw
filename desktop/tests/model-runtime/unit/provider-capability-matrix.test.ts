import { describe, expect, it } from "vitest";

import type { ModelCapability, ModelProfile } from "@shared/contracts";
import { findRegistryCapability } from "../../../src/main/services/model-capability-registry";
import { resolveProviderNativeCapabilities } from "../../../src/main/services/model-runtime/provider-capability-matrix";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-openai",
    name: "OpenAI Profile",
    provider: "openai-compatible",
    providerFlavor: "openai",
    providerFamily: "openai-native",
    vendorFamily: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "gpt-5.4",
    ...overrides,
  };
}

function buildCapability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    source: "observed-response",
    supportsTools: true,
    supportsReasoning: true,
    supportsStreaming: true,
    ...overrides,
  };
}

describe("provider capability matrix", () => {
  it("recognizes OpenAI-native models as eligible for vendor-native search and computer routes", () => {
    const resolved = resolveProviderNativeCapabilities(
      buildProfile(),
      buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeComputer: true,
        supportsNativeFileSearch: true,
        supportsBackgroundMode: true,
        supportsContinuation: true,
        supportsToolSearch: true,
        supportsCompaction: true,
      }),
    );

    expect(resolved.supportsNativeWebSearch).toBe(true);
    expect(resolved.supportsNativeComputer).toBe(true);
    expect(resolved.supportsNativeFileSearch).toBe(true);
    expect(resolved.supportsBackgroundMode).toBe(true);
    expect(resolved.preferredSearchRoute).toBe("vendor-native");
    expect(resolved.preferredComputerRoute).toBe("vendor-native");
    expect(resolved.preferredKnowledgeRoute).toBe("vendor-native");
  });

  it("downgrades generic compatible providers to managed-local capability routes", () => {
    const resolved = resolveProviderNativeCapabilities(
      buildProfile({
        id: "profile-generic",
        providerFlavor: "generic-openai-compatible",
        providerFamily: "generic-openai-compatible",
        vendorFamily: "generic-openai-compatible",
        baseUrl: "https://api.example.com/v1",
      }),
      buildCapability(),
    );

    expect(resolved.supportsNativeWebSearch).toBe(false);
    expect(resolved.supportsNativeComputer).toBe(false);
    expect(resolved.supportsNativeFileSearch).toBe(false);
    expect(resolved.preferredSearchRoute).toBe("managed-local");
    expect(resolved.preferredComputerRoute).toBe("managed-local");
    expect(resolved.preferredKnowledgeRoute).toBe("disabled");
  });

  it("exposes Qwen exact-model thinking and tool constraints from the capability registry", () => {
    const qwenDefault = findRegistryCapability(buildProfile({
      providerFlavor: "qwen",
      providerFamily: "qwen-native",
      vendorFamily: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
    }));
    const qwenCoder = findRegistryCapability(buildProfile({
      providerFlavor: "qwen",
      providerFamily: "qwen-native",
      vendorFamily: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3-coder-plus",
    }));

    expect(qwenDefault?.thinkingControlKind).toBe("budget");
    expect(qwenDefault?.toolChoiceConstraint).toBe("no_forced_when_thinking");
    expect(qwenCoder?.thinkingControlKind).toBe("unsupported");
  });

  it("exposes Kimi exact-model thinking and replay constraints from the capability registry", () => {
    const kimiDefault = findRegistryCapability(buildProfile({
      providerFlavor: "moonshot",
      providerFamily: "moonshot-native",
      vendorFamily: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.5",
    }));
    const kimiThinking = findRegistryCapability(buildProfile({
      providerFlavor: "moonshot",
      providerFamily: "moonshot-native",
      vendorFamily: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-thinking",
    }));

    expect(kimiDefault?.thinkingControlKind).toBe("boolean");
    expect(kimiDefault?.toolChoiceConstraint).toBe("auto_none_only_when_thinking");
    expect(kimiDefault?.requiresReasoningReplay).toBe(true);
    expect(kimiThinking?.thinkingControlKind).toBe("always_on");
  });

  it("enables Qwen responses-native routes beyond the OpenAI-native family", () => {
    const resolved = resolveProviderNativeCapabilities(
      buildProfile({
        providerFlavor: "qwen",
        providerFamily: "qwen-native",
        vendorFamily: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
      }),
      buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeWebExtractor: true,
        supportsNativeCodeInterpreter: true,
        supportsNativeFileSearch: true,
        supportsContinuation: true,
      }),
    );

    expect(resolved.supportsNativeWebSearch).toBe(true);
    expect(resolved.supportsNativeWebExtractor).toBe(true);
    expect(resolved.supportsNativeCodeInterpreter).toBe(true);
    expect(resolved.supportsNativeFileSearch).toBe(true);
    expect(resolved.supportsContinuation).toBe(true);
  });

  it("keeps Moonshot anthropic routes agent-oriented instead of inheriting OpenAI-native tool routes", () => {
    const resolved = resolveProviderNativeCapabilities(
      buildProfile({
        providerFlavor: "moonshot",
        providerFamily: "moonshot-native",
        vendorFamily: "kimi",
        protocolTarget: "anthropic-messages",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2.5",
      }),
      buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
        requiresReasoningReplay: true,
      }),
    );

    expect(resolved.supportsNativeWebSearch).toBe(false);
    expect(resolved.supportsNativeCodeInterpreter).toBe(false);
    expect(resolved.requiresReasoningReplay).toBe(true);
    expect(resolved.preferredSearchRoute).toBe("managed-local");
  });

  it("keeps Moonshot chat-compatible routes on managed-local tools until a Formula bridge exists", () => {
    const resolved = resolveProviderNativeCapabilities(
      buildProfile({
        providerFlavor: "moonshot",
        providerFamily: "moonshot-native",
        vendorFamily: "kimi",
        protocolTarget: "openai-chat-compatible",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2.5",
      }),
      buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
        requiresReasoningReplay: true,
      }),
    );

    expect(resolved.supportsNativeWebSearch).toBe(false);
    expect(resolved.supportsNativeCodeInterpreter).toBe(false);
    expect(resolved.requiresReasoningReplay).toBe(true);
    expect(resolved.preferredSearchRoute).toBe("managed-local");
    expect(resolved.preferredComputerRoute).toBe("managed-local");
  });
});
