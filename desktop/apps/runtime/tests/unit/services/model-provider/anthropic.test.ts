import type { ChatMessage, ModelProfile } from "@myclaw-desktop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runModelConversation } from "../../../../src/services/model-provider";
import { parseAnthropicStepFromSse } from "../../../../src/services/model-provider/anthropic/sse";

const messagesWithSystem: ChatMessage[] = [
  {
    id: "msg-system-1",
    role: "system",
    content: "system-guard",
    createdAt: "2026-03-27T00:00:00.000Z",
  },
  {
    id: "msg-user-1",
    role: "user",
    content: "hello",
    createdAt: "2026-03-27T00:00:01.000Z",
  },
];

const anthropicProfile: ModelProfile = {
  id: "anthropic-profile",
  name: "Anthropic",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-anthropic",
  model: "claude-3-5-sonnet-latest",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("anthropic modules", () => {
  it("parses thinking and tool_use input_json_delta from SSE", async () => {
    const seenDeltas: Array<{ content?: string; reasoning?: string }> = [];
    const response = new Response(
      [
        "event: content_block_start",
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}',
        "",
        "event: content_block_start",
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"fs_read_file","input":{}}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"README.md\\"}"}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
        "",
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      },
    );

    const step = await parseAnthropicStepFromSse(response, async (delta) => {
      seenDeltas.push(delta);
    });

    expect(step.assistantReasoning).toBe("plan");
    expect(step.toolCalls).toEqual([
      {
        id: "toolu_1",
        name: "fs_read_file",
        input: { path: "README.md" },
      },
    ]);
    expect(step.finishReason).toBe("tool_use");
    expect(seenDeltas).toEqual([{ reasoning: "plan" }]);
  });

  it("routes to /messages and blocks requestBody overrides for reserved fields", async () => {
    const profile: ModelProfile = {
      ...anthropicProfile,
      requestBody: {
        stream: false,
        max_tokens: 12,
        messages: [{ role: "user", content: [{ type: "text", text: "tampered" }] }],
        tools: [{ name: "tampered" }],
        tool_choice: "none",
        system: "tampered-system",
        custom_flag: "ok",
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await runModelConversation({
      profile,
      messages: messagesWithSystem,
      onToolCall: vi.fn(),
    });

    expect(result.content).toBe("ok");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.anthropic.com/v1/messages");

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(2048);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.system).toBe("system-guard");
    expect(body.custom_flag).toBe("ok");
  });
});
