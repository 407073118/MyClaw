import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import {
  getProviderAdapter,
  listProviderAdapters,
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

    expect(ids).toEqual(["br-minimax", "openai-compatible"]);
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
});
