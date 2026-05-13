import { describe, expect, it, vi } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import { probeBrMiniMaxRuntime } from "../src/main/services/br-minimax-runtime";

describe("probeBrMiniMaxRuntime", () => {
  it("marks reasoning_split as supported when the primary probe succeeds", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: "pong",
            reasoning_details: [{ type: "text", text: "thinking" }],
          },
        }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ));

    const result = await probeBrMiniMaxRuntime(
      createBrMiniMaxProfile({
        id: "br-minimax-profile",
        apiKey: "br-test-key",
      }),
      fetchMock,
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics.reasoningSplitSupported).toBe(true);
    expect(result.diagnostics.thinkingPath).toBe("reasoning_split");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to reasoning_content when the primary probe is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: "unknown field reasoning_split" } }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: "pong",
              reasoning_content: "thinking",
            },
          }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));

    const result = await probeBrMiniMaxRuntime(
      createBrMiniMaxProfile({
        id: "br-minimax-profile",
        apiKey: "br-test-key",
      }),
      fetchMock,
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics.reasoningSplitSupported).toBe(false);
    expect(result.diagnostics.thinkingPath).toBe("reasoning_content");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the selected BR MiniMax model when probing runtime support", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: "pong",
            reasoning_details: [{ type: "text", text: "thinking" }],
          },
        }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ));

    await probeBrMiniMaxRuntime(
      {
        ...createBrMiniMaxProfile({
          id: "br-minimax-profile",
          apiKey: "br-test-key",
        }),
        model: "minimax-m2-7",
      },
      fetchMock,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe("minimax-m2-7");
  });
});
