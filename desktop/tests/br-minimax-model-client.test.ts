import { describe, expect, it } from "vitest";

import {
  createBrMiniMaxProfile,
  withBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";
import { buildRequestBodyVariants } from "../src/main/services/model-client";

describe("br-minimax request body variants", () => {
  it("builds a best-practice primary request and a compatibility fallback", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    });

    expect(profile.vendorFamily).toBe("minimax");
    expect(profile.deploymentProfile).toBe("br-private");

    const variants = buildRequestBodyVariants({
      profile,
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      }],
    });

    expect(variants).toHaveLength(2);

    expect(variants[0]).toMatchObject({
      model: "minimax-m2-5",
      stream: true,
      temperature: 1,
      top_p: 0.95,
      top_k: 40,
      reasoning_split: true,
      chat_template_kwargs: {
        enable_thinking: true,
      },
      tool_choice: "auto",
    });

    expect(variants[1]).toMatchObject({
      model: "minimax-m2-5",
      stream: true,
      temperature: 1,
      top_p: 0.95,
      top_k: 40,
      chat_template_kwargs: {
        enable_thinking: true,
      },
      tool_choice: "auto",
    });
    expect(variants[1]).not.toHaveProperty("reasoning_split");
  });

  it("replays assistant reasoning back into the next request as a full assistant turn", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    });

    const variants = buildRequestBodyVariants({
      profile,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "final answer", reasoning: "step one\nstep two" },
      ],
    });

    expect(variants[0]).toMatchObject({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "<think>step one\nstep two</think>\n\nfinal answer" },
      ],
    });
  });

  it("strips low-value generic tuning fields while keeping supported output limits", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    });
    profile.requestBody = {
      ...profile.requestBody,
      presence_penalty: 1.5,
      frequency_penalty: 0.8,
      logit_bias: { "42": 1 },
      function_call: "auto",
      max_tokens: 4096,
    };

    const variants = buildRequestBodyVariants({
      profile,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(variants[0]).toMatchObject({
      max_tokens: 4096,
    });
    expect(variants[0]).not.toHaveProperty("presence_penalty");
    expect(variants[0]).not.toHaveProperty("frequency_penalty");
    expect(variants[0]).not.toHaveProperty("logit_bias");
    expect(variants[0]).not.toHaveProperty("function_call");
  });

  it("uses a single reasoning_split request after support has been validated", () => {
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

    const variants = buildRequestBodyVariants({
      profile,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toHaveProperty("reasoning_split", true);
  });

  it("uses a single compatibility request after fallback mode has been validated", () => {
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

    const variants = buildRequestBodyVariants({
      profile,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]).not.toHaveProperty("reasoning_split");
  });

  it("maps xhigh reasoning effort to a larger MiniMax thinking budget", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-minimax-profile",
      apiKey: "br-test-key",
    });

    const variants = buildRequestBodyVariants({
      profile,
      messages: [{ role: "user", content: "hello" }],
      adapterId: "br-minimax",
      reasoningEffort: "xhigh" as any,
    } as any);

    expect(variants[0]).toMatchObject({
      chat_template_kwargs: {
        thinking_budget: 65536,
      },
    });
  });
});
