import { describe, expect, it } from "vitest";

import type { ModelCapability, ModelProfile } from "@shared/contracts";
import { resolveCapabilityRoutes } from "../../../src/main/services/model-runtime/capability-router";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "Profile",
    provider: "openai-compatible",
    providerFlavor: "openai",
    providerFamily: "openai-native",
    vendorFamily: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "key",
    model: "gpt-5.4",
    responsesApiConfig: {
      fileSearch: {
        vectorStoreIds: ["vs_knowledge_1"],
        maxNumResults: 8,
      },
    },
    ...overrides,
  };
}

function buildCapability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    source: "observed-response",
    supportsTools: true,
    supportsNativeWebSearch: true,
    supportsNativeComputer: true,
    supportsNativeFileSearch: true,
    supportsBackgroundMode: true,
    ...overrides,
  };
}

describe("capability router", () => {
  it("prefers vendor-native OpenAI routes when native capabilities are available", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile(),
      capability: buildCapability(),
      protocolTarget: "openai-responses",
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "web_search",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "computer",
    });
    expect(routes.find((route) => route.capabilityId === "knowledge-retrieval")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "file_search",
    });
  });

  it("falls back to managed-local routes for generic compatible providers", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "generic-openai-compatible",
        providerFamily: "generic-openai-compatible",
        vendorFamily: "generic-openai-compatible",
        baseUrl: "https://api.example.com/v1",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: false,
        supportsNativeComputer: false,
        supportsNativeFileSearch: false,
        supportsBackgroundMode: false,
      }),
      protocolTarget: "openai-chat-compatible",
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "managed-local",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "managed-local",
    });
    expect(routes.find((route) => route.capabilityId === "knowledge-retrieval")).toMatchObject({
      routeType: "disabled",
      nativeToolName: null,
    });
  });

  it("disables native knowledge retrieval when vector stores are not configured", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        responsesApiConfig: {
          fileSearch: {
            vectorStoreIds: [],
          },
        },
      }),
      capability: buildCapability(),
      protocolTarget: "openai-responses",
    });

    expect(routes.find((route) => route.capabilityId === "knowledge-retrieval")).toMatchObject({
      routeType: "disabled",
      nativeToolName: null,
    });
  });

  it("routes qwen-native responses capabilities to vendor-native tool names", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "qwen",
        providerFamily: "qwen-native",
        vendorFamily: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeWebExtractor: true,
        supportsNativeCodeInterpreter: true,
        supportsNativeFileSearch: true,
        supportsContinuation: true,
      }),
      protocolTarget: "openai-responses",
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "web_search",
    });
    expect(routes.find((route) => route.capabilityId === "page-read")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "web_extractor",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "code_interpreter",
    });
    expect(routes.find((route) => route.capabilityId === "knowledge-retrieval")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "file_search",
    });
    expect(routes.find((route) => route.capabilityId === "research-task")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "previous_response_id",
    });
  });

  it("routes qwen-native chat-compatible capabilities to chat-native tools instead of managed-local fallback", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "qwen",
        providerFamily: "qwen-native",
        vendorFamily: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
      }),
      protocolTarget: "openai-chat-compatible",
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "enable_search",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "enable_code_interpreter",
    });
  });

  it("requires explicit thinking before exposing qwen3-max native extractor and code interpreter routes", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "qwen",
        providerFamily: "qwen-native",
        vendorFamily: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3-max",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeWebExtractor: true,
        supportsNativeCodeInterpreter: true,
        thinkingControlKind: "budget",
      }),
      protocolTarget: "openai-responses",
      reasoningEnabled: false,
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "web_search",
    });
    expect(routes.find((route) => route.capabilityId === "page-read")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
      reason: "qwen_native_tool_requires_thinking",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
      reason: "qwen_native_tool_requires_thinking",
    });
  });

  it("re-enables qwen3-max native extractor and code interpreter routes once thinking is active", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "qwen",
        providerFamily: "qwen-native",
        vendorFamily: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3-max",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeWebExtractor: true,
        supportsNativeCodeInterpreter: true,
        thinkingControlKind: "budget",
      }),
      protocolTarget: "openai-responses",
      reasoningEffort: "medium",
    });

    expect(routes.find((route) => route.capabilityId === "page-read")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "web_extractor",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "code_interpreter",
    });
  });

  it("keeps moonshot-native chat-compatible routes on managed-local tools until a Formula bridge exists", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "moonshot",
        providerFamily: "moonshot-native",
        vendorFamily: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2.5",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
        requiresReasoningReplay: true,
      }),
      protocolTarget: "openai-chat-compatible",
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
      reason: "moonshot_formula_bridge_unavailable",
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
      reason: "moonshot_formula_bridge_unavailable",
    });
  });

  it("keeps moonshot-native anthropic routes agent-oriented instead of inheriting openai-native tools", () => {
    const routes = resolveCapabilityRoutes({
      profile: buildProfile({
        providerFlavor: "moonshot",
        providerFamily: "moonshot-native",
        vendorFamily: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2.5",
      }),
      capability: buildCapability({
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
        requiresReasoningReplay: true,
      }),
      protocolTarget: "anthropic-messages",
    });

    expect(routes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
    });
    expect(routes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
    });
    expect(routes.find((route) => route.capabilityId === "knowledge-retrieval")).toMatchObject({
      routeType: "disabled",
      nativeToolName: null,
    });
  });
});
