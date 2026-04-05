import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { getProviderAdapter } from "../src/main/services/provider-adapters";

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
    requestBody: {
      temperature: 0.3,
      max_tokens: 1024,
    },
    ...overrides,
  };
}

describe("phase1 openai-compatible adapter", () => {
  it("prepares a generic request body from profile model, messages, tools, and requestBody", () => {
    const adapter = getProviderAdapter("openai-compatible");
    const profile = makeProfile();
    const messages = adapter.materializeReplayMessages(
      { profile },
      { messages: [{ role: "user", content: "hello" }] },
    );

    const variants = adapter.prepareRequest(
      { profile },
      {
        messages,
        tools: [{
          type: "function",
          function: {
            name: "lookup_weather",
            description: "Lookup weather",
            parameters: { type: "object", properties: {} },
          },
        }],
      },
    );

    expect(variants).toEqual([{
      id: "primary",
      fallbackReason: null,
      body: {
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        tools: [{
          type: "function",
          function: {
            name: "lookup_weather",
            description: "Lookup weather",
            parameters: { type: "object", properties: {} },
          },
        }],
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1024,
      },
    }]);
  });

  it("keeps non-BR assistant reasoning replay as pass-through", () => {
    const adapter = getProviderAdapter("openai-compatible");
    const profile = makeProfile();

    const replayMessages = adapter.materializeReplayMessages(
      { profile },
      {
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "final answer", reasoning: "step one\nstep two" },
        ],
      },
    );

    expect(replayMessages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "final answer", reasoning: "step one\nstep two" },
    ]);
  });

  it("uses a single primary request variant by default", () => {
    const adapter = getProviderAdapter("openai-compatible");
    const profile = makeProfile();

    const variants = adapter.prepareRequest(
      { profile },
      {
        messages: adapter.materializeReplayMessages(
          { profile },
          { messages: [{ role: "user", content: "hello" }] },
        ),
      },
    );

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      id: "primary",
      fallbackReason: null,
      body: {
        model: "gpt-test",
        stream: true,
      },
    });
  });
});
