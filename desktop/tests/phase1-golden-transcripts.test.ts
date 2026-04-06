import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import { callModel, buildRequestBodyVariants } from "../src/main/services/model-client";
import { getProviderAdapter } from "../src/main/services/provider-adapters";
import type { ProviderAdapterRequestInput } from "../src/main/services/provider-adapters";
import { buildExecutionPlan } from "../src/main/services/reasoning-runtime";

describe("phase1 golden transcripts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("freezes the MiniMax replay shape with reasoning preserved in the replay path", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-golden-replay",
      apiKey: "br-test-key",
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: {
        supportsReasoning: true,
      },
    });

    const variants = buildRequestBodyVariants({
      profile,
      adapterId: executionPlan.adapterId,
      messages: [
        { role: "user", content: "Summarize the prior run" },
        { role: "assistant", content: "Final answer", reasoning: "step one\nstep two" },
      ],
    });

    expect(executionPlan).toMatchObject({
      adapterId: "br-minimax",
      replayPolicy: "assistant-turn-with-reasoning",
      fallbackAdapterIds: ["openai-compatible"],
    });
    expect(variants[0]).toMatchObject({
      reasoning_split: true,
      messages: [
        { role: "user", content: "Summarize the prior run" },
        { role: "assistant", content: "<think>step one\nstep two</think>\n\nFinal answer" },
      ],
    });
  });

  it("freezes the tool-loop reasoning shape through the execution-plan session path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = createBrMiniMaxProfile({
      id: "br-golden-tool-loop",
      apiKey: "br-test-key",
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: {
        supportsReasoning: true,
      },
    });

    await callModel({
      profile,
      messages: [
        { role: "user", content: "Should we call the weather tool?" },
        {
          role: "assistant",
          content: "",
          reasoning: "Need the tool result before answering.",
          tool_calls: [{
            id: "tool-1",
            type: "function",
            function: {
              name: "lookup_weather",
              arguments: "{\"city\":\"Shanghai\"}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "tool-1",
          content: "{\"temperature\":22}",
        },
      ],
      executionPlan: {
        adapterId: executionPlan.adapterId,
        replayPolicy: executionPlan.replayPolicy,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rawRequestBody = fetchMock.mock.calls[0]?.[1]?.body;

    expect(rawRequestBody).toBeTypeOf("string");

    const requestBody = JSON.parse(rawRequestBody) as {
      messages: Array<Record<string, unknown>>;
      reasoning_split?: boolean;
    };

    expect(requestBody.reasoning_split).toBe(true);
    expect(requestBody.messages).toEqual([
      { role: "user", content: "Should we call the weather tool?" },
      {
        role: "assistant",
        content: "<think>Need the tool result before answering.</think>",
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "tool-1",
        content: "{\"temperature\":22}",
      },
    ]);
  });

  it("freezes the BR MiniMax downgrade shape as primary then openai-compatible compatibility semantics", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-golden-fallback",
      apiKey: "br-test-key",
    });
    const input: ProviderAdapterRequestInput = {
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function" as const,
        function: {
          name: "lookup_weather",
          description: "Lookup weather",
          parameters: { type: "object", properties: {} },
        },
      }],
    };

    const brAdapter = getProviderAdapter("br-minimax");
    const compatibilityAdapter = getProviderAdapter("openai-compatible");

    const brReplayMessages = brAdapter.materializeReplayMessages({ profile }, input);
    const brVariants = brAdapter.prepareRequest(
      { profile },
      { ...input, messages: brReplayMessages },
    );
    const compatibilityVariant = compatibilityAdapter.prepareRequest(
      { profile },
      {
        ...input,
        messages: compatibilityAdapter.materializeReplayMessages({ profile }, input),
      },
    )[0];

    expect(brVariants.map((variant) => ({
      id: variant.id,
      fallbackReason: variant.fallbackReason,
    }))).toEqual([
      { id: "primary", fallbackReason: null },
      {
        id: "compatibility-fallback",
        fallbackReason: "reasoning_split_unsupported",
      },
    ]);
    expect(brVariants[0]?.body).toMatchObject({
      reasoning_split: true,
      model: "minimax-m2-5",
      stream: true,
      tool_choice: "auto",
    });
    expect(brVariants[1]?.body).toMatchObject({
      model: compatibilityVariant?.body.model,
      messages: compatibilityVariant?.body.messages,
      stream: compatibilityVariant?.body.stream,
      tools: compatibilityVariant?.body.tools,
      tool_choice: compatibilityVariant?.body.tool_choice,
    });
    expect(brVariants[1]?.body).not.toHaveProperty("reasoning_split");
    expect(compatibilityVariant?.body).not.toHaveProperty("reasoning_split");
  });
});
