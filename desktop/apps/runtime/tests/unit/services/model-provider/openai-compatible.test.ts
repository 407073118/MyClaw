import type { ChatMessage, ModelProfile } from "@myclaw-desktop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runModelConversation } from "../../../../src/services/model-provider";
import { parseOpenAiStepFromSse } from "../../../../src/services/model-provider/openai-compatible/sse";

const baseMessages: ChatMessage[] = [
  {
    id: "msg-user-1",
    role: "user",
    content: "hello",
    createdAt: "2026-03-27T00:00:00.000Z",
  },
];

const openAiProfile: ModelProfile = {
  id: "openai-profile",
  name: "OpenAI Compatible",
  provider: "openai-compatible",
  baseUrl: "https://example.com/v1/",
  apiKey: "sk-openai",
  model: "gpt-4.1-mini",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openai-compatible modules", () => {
  it("parses SSE snapshots into incremental deltas", async () => {
    const seenDeltas: Array<{ content?: string; reasoning?: string }> = [];
    const response = new Response(
      [
        'data: {"choices":[{"delta":{"reasoning_content":"r"}}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"re"}}]}',
        'data: {"choices":[{"delta":{"content":"h"}}]}',
        'data: {"choices":[{"delta":{"content":"hi"}}]}',
        'data: {"choices":[{"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      },
    );

    const step = await parseOpenAiStepFromSse(response, async (delta) => {
      seenDeltas.push(delta);
    });

    expect(step.assistantReasoning).toBe("re");
    expect(step.assistantText).toBe("hi");
    expect(step.finishReason).toBe("stop");
    expect(seenDeltas).toEqual([
      { reasoning: "r" },
      { reasoning: "e" },
      { content: "h" },
      { content: "i" },
    ]);
  });

  it("routes to /chat/completions and blocks requestBody overrides for reserved fields", async () => {
    const profile: ModelProfile = {
      ...openAiProfile,
      requestBody: {
        stream: false,
        messages: [{ role: "user", content: "tampered" }],
        tools: [{ type: "function", function: { name: "tampered" } }],
        tool_choice: "none",
        max_tokens: 9999,
        custom_flag: true,
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await runModelConversation({
      profile,
      messages: baseMessages,
      onToolCall: vi.fn(),
    });

    expect(result.content).toBe("ok");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://example.com/v1/chat/completions");

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe("auto");
    expect(body.max_tokens).toBeUndefined();
    expect(body.custom_flag).toBe(true);
  });
});
