import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { callModel } from "../src/main/services/model-client";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "phase10-profile",
    name: "Phase 10 Profile",
    provider: "openai-compatible",
    providerFlavor: "minimax-anthropic",
    baseUrl: "https://api.minimaxi.com",
    baseUrlMode: "provider-root",
    apiKey: "test-key",
    model: "MiniMax-M2.5",
    ...overrides,
  };
}

function createSseResponse(chunks: unknown[]): Response {
  const body = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("") + "data: [DONE]\n\n";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("phase 10 model client replay", () => {
  it("returns assistant replay payload and replays prior assistant reasoning into the next request", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => createSseResponse([
      {
        choices: [{
          delta: {
            content: "Use tool",
            reasoning_content: "plan carefully",
            tool_calls: [{
              index: 0,
              id: "tool-1",
              function: {
                name: "fs.read",
                arguments: "{\"path\":\"README.md\"}",
              },
            }],
          },
        }],
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: buildProfile(),
      replayPolicy: "required",
      messages: [
        {
          role: "assistant",
          content: "Earlier answer",
          reasoning: "keep this chain",
          tool_calls: [{
            id: "prior-tool",
            type: "function",
            function: {
              name: "fs.list",
              arguments: "{\"path\":\".\"}",
            },
          }],
        },
        {
          role: "tool",
          content: "[]",
          tool_call_id: "prior-tool",
        },
      ],
      bodyPatch: {
        reasoning: {
          effort: "medium",
        },
      },
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages[0].reasoning).toBe("keep this chain");
    expect(requestBody.messages[0].tool_calls).toHaveLength(1);
    expect(result.assistantReplay).toEqual({
      mode: "full-assistant",
      degradedReason: null,
      message: {
        role: "assistant",
        content: "Use tool",
        reasoning: "plan carefully",
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "fs.read",
            arguments: "{\"path\":\"README.md\"}",
          },
        }],
      },
    });
  });
});
