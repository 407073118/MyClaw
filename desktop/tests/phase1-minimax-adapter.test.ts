import { describe, expect, it } from "vitest";

import {
  createBrMiniMaxProfile,
  withBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";
import { getProviderAdapter } from "../src/main/services/provider-adapters";

describe("phase1 MiniMax adapter", () => {
  it("replays assistant reasoning as a think-wrapped assistant turn", () => {
    const adapter = getProviderAdapter("br-minimax");
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    });

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
      { role: "assistant", content: "<think>step one\nstep two</think>\n\nfinal answer" },
    ]);
  });

  it("builds a reasoning_split primary request and a compatibility fallback", () => {
    const adapter = getProviderAdapter("br-minimax");
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    });

    const replayMessages = adapter.materializeReplayMessages(
      { profile },
      { messages: [{ role: "user", content: "hello" }] },
    );
    const variants = adapter.prepareRequest(
      { profile },
      {
        messages: replayMessages,
        tools: [{
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: {} },
          },
        }],
      },
    );

    expect(variants).toHaveLength(2);

    expect(variants[0]).toMatchObject({
      id: "primary",
      body: {
        model: "minimax-m2-5",
        stream: true,
        reasoning_split: true,
        tool_choice: "auto",
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
    });

    expect(variants[1]).toMatchObject({
      id: "compatibility-fallback",
      fallbackReason: "reasoning_split_unsupported",
      body: {
        model: "minimax-m2-5",
        stream: true,
        tool_choice: "auto",
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
    });
    expect(variants[1]?.body).not.toHaveProperty("reasoning_split");
  });

  it("uses a single reasoning_split path after runtime support is validated", () => {
    const adapter = getProviderAdapter("br-minimax");
    const profile = withBrMiniMaxRuntimeDiagnostics(
      createBrMiniMaxProfile({
        id: "br-minimax-profile",
        apiKey: "br-test-key",
      }),
      {
        reasoningSplitSupported: true,
        thinkingPath: "reasoning_split",
        lastCheckedAt: "2026-04-04T12:00:00.000Z",
      },
    );

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
    });
    expect(variants[0]?.body).toHaveProperty("reasoning_split", true);
  });

  it("uses a single compatibility path after fallback mode is validated", () => {
    const adapter = getProviderAdapter("br-minimax");
    const profile = withBrMiniMaxRuntimeDiagnostics(
      createBrMiniMaxProfile({
        id: "br-minimax-profile",
        apiKey: "br-test-key",
      }),
      {
        reasoningSplitSupported: false,
        thinkingPath: "reasoning_content",
        lastCheckedAt: "2026-04-04T12:00:00.000Z",
      },
    );

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
      id: "compatibility-fallback",
      fallbackReason: "reasoning_split_unsupported",
    });
    expect(variants[0]?.body).not.toHaveProperty("reasoning_split");
  });
});
