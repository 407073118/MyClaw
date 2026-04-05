import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import { callModel } from "../src/main/services/model-client";

/** 构造最小 SSE 响应，复用现有 transport 的流式解析路径。 */
function buildSseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("phase1 model client transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses adapter-owned fallback variants when the primary MiniMax request is rejected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unknown field reasoning_split", { status: 400 }))
      .mockResolvedValueOnce(buildSseResponse([
        'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
        "data: [DONE]",
        "",
      ].join("\n")));
    vi.stubGlobal("fetch", fetchMock);

    const profile = createBrMiniMaxProfile({
      id: "br-profile",
      apiKey: "br-test-key",
    });

    const result = await callModel({
      profile,
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "br-minimax",
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(result.content).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const primaryBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;

    expect(primaryBody).toHaveProperty("reasoning_split", true);
    expect(fallbackBody).not.toHaveProperty("reasoning_split");
  });
});
