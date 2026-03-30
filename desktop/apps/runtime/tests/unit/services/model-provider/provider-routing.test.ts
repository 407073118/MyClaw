import type { ChatMessage, ModelProfile } from "@myclaw-desktop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runModelConversation } from "../../../../src/services/model-provider";

const messages: ChatMessage[] = [
  {
    id: "msg-user-1",
    role: "user",
    content: "hello",
    createdAt: "2026-03-27T00:00:00.000Z",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider routing compatibility", () => {
  it("routes openai-compatible to /chat/completions", async () => {
    const profile: ModelProfile = {
      id: "openai-profile",
      name: "OpenAI",
      provider: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "sk-openai",
      model: "gpt-4.1-mini",
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

    await runModelConversation({ profile, messages });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://example.com/v1/chat/completions");
  });

  it("routes anthropic to /messages", async () => {
    const profile: ModelProfile = {
      id: "anthropic-profile",
      name: "Anthropic",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-anthropic",
      model: "claude-3-5-sonnet-latest",
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

    await runModelConversation({ profile, messages });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.anthropic.com/v1/messages");
  });
});
