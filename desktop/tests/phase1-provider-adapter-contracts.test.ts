import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import {
  getProviderAdapter,
  listProviderAdapters,
  resolveProviderAdapterId,
} from "../src/main/services/provider-adapters";
import type {
  ProviderAdapter,
  ProviderAdapterContext,
  ProviderAdapterId,
  ProviderAdapterRequestInput,
} from "../src/main/services/provider-adapters/base";

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-openai",
    name: "OpenAI Compatible",
    provider: "openai-compatible",
    providerFlavor: "generic-openai-compatible",
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

function makeContext(profile: ModelProfile = makeProfile()): ProviderAdapterContext {
  return { profile };
}

function assertAdapterContract(adapter: ProviderAdapter, expectedId: ProviderAdapterId): void {
  expect(adapter.id).toBe(expectedId);
  expect(typeof adapter.materializeReplayMessages).toBe("function");
  expect(typeof adapter.prepareRequest).toBe("function");
}

describe("phase1 provider adapter contracts", () => {
  it("exposes the registered adapter ids", () => {
    const ids = listProviderAdapters().map((adapter) => adapter.id);

    expect(ids).toEqual([
      "openai-compatible",
      "openai-native",
      "anthropic-native",
      "qwen",
      "kimi",
      "deepseek",
      "volcengine-ark",
      "minimax",
      "br-minimax",
    ]);
  });

  it("defines a stable adapter interface shape", () => {
    const adapter = getProviderAdapter("openai-compatible");

    assertAdapterContract(adapter, "openai-compatible");
  });

  it("prepares request variants with a primary-first fallback contract", () => {
    const adapter = getProviderAdapter("openai-compatible");
    const context = makeContext();
    const input: ProviderAdapterRequestInput = {
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function",
        function: {
          name: "lookup_weather",
          description: "Lookup weather",
          parameters: { type: "object", properties: {} },
        },
      }],
    };

    const replayMessages = adapter.materializeReplayMessages(context, input);
    const variants = adapter.prepareRequest(context, {
      ...input,
      messages: replayMessages,
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      id: "primary",
      body: {
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        tool_choice: "auto",
      },
    });
    expect(variants[0]?.fallbackReason).toBeNull();
  });

  it("selects adapters from either an explicit id or a model profile", () => {
    const explicit = getProviderAdapter("br-minimax");
    const selected = getProviderAdapter(makeProfile({
      providerFlavor: "br-minimax",
      model: "minimax-m2-5",
      baseUrl: "http://api-pre.cybotforge.100credit.cn",
    }));

    assertAdapterContract(explicit, "br-minimax");
    assertAdapterContract(selected, "br-minimax");
  });

  it("routes first-tier compatible vendors through the current compatible adapter until dedicated adapters land", () => {
    expect(resolveProviderAdapterId(makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
    }))).toBe("qwen");

    expect(resolveProviderAdapterId(makeProfile({
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
    }))).toBe("kimi");

    expect(resolveProviderAdapterId(makeProfile({
      providerFlavor: "volcengine-ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-code",
    }))).toBe("volcengine-ark");

    expect(resolveProviderAdapterId(makeProfile({
      vendorFamily: "minimax",
      deploymentProfile: "br-private",
      providerFlavor: "generic-openai-compatible",
      baseUrl: "https://api.minimax.chat/v1",
      model: "minimax-m2-5",
    }))).toBe("br-minimax");

    expect(resolveProviderAdapterId(makeProfile({
      providerFlavor: "minimax-anthropic",
      baseUrl: "https://api.minimax.chat/v1",
      model: "minimax-text-01",
    }))).toBe("minimax");

    expect(resolveProviderAdapterId(makeProfile({
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
    }))).toBe("openai-native");

    expect(resolveProviderAdapterId(makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
    }))).toBe("anthropic-native");
  });

  it("keeps Qwen on a dedicated adapter contract with vendor-native request fields and a compatibility fallback", () => {
    const profile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
      requestBody: {
        enable_search: true,
        enable_code_interpreter: true,
      },
    });
    const adapter = getProviderAdapter(profile);
    const context = { profile, reasoningEffort: "high" } as ProviderAdapterContext;
    const variants = adapter.prepareRequest(context, {
      messages: adapter.materializeReplayMessages(context, {
        messages: [{ role: "user", content: "hello" }],
        tools: [{
          type: "function",
          function: {
            name: "lookup_weather",
            description: "Lookup weather",
            parameters: { type: "object", properties: {} },
          },
        }],
      }),
      tools: [{
        type: "function",
        function: {
          name: "lookup_weather",
          description: "Lookup weather",
          parameters: { type: "object", properties: {} },
        },
      }],
    });

    expect(adapter.id).toBe("qwen");
    expect(variants[0]).toMatchObject({
      id: "primary",
      body: {
        enable_thinking: true,
        thinking_budget: 8192,
        enable_search: true,
        enable_code_interpreter: true,
      },
    });
    expect(variants[0]?.body).not.toHaveProperty("tool_choice");
    expect(variants[1]).toMatchObject({
      id: "compatibility-fallback",
      fallbackReason: "qwen_vendor_patch_unsupported",
    });
  });
});
