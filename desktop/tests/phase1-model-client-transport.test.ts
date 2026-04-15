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

  it("uses Qwen-native thinking fields and strips them from the compatibility fallback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unknown field enable_thinking", { status: 400 }))
      .mockResolvedValueOnce(buildSseResponse([
        'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
        "data: [DONE]",
        "",
      ].join("\n")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "qwen-profile",
        name: "Qwen",
        provider: "openai-compatible",
        providerFlavor: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "qwen-test-key",
        model: "qwen-max",
        requestBody: {
          enable_search: true,
          search_options: {
            forced: true,
          },
          enable_code_interpreter: true,
        },
      },
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function",
        function: {
          name: "lookup_weather",
          description: "Lookup weather",
          parameters: { type: "object", properties: {} },
        },
      }],
      executionPlan: {
        adapterId: "qwen",
        replayPolicy: "assistant-turn-with-reasoning",
        reasoningEffort: "xhigh",
      },
    });

    expect(result.content).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const primaryBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;

    expect(primaryBody).toMatchObject({
      enable_thinking: true,
      thinking_budget: 16384,
      enable_search: true,
      search_options: {
        forced: true,
      },
      enable_code_interpreter: true,
    });
    expect(primaryBody).not.toHaveProperty("reasoning");
    expect(primaryBody).not.toHaveProperty("tool_choice");
    expect(fallbackBody).toHaveProperty("tool_choice", "auto");
    expect(fallbackBody).not.toHaveProperty("enable_thinking");
    expect(fallbackBody).not.toHaveProperty("thinking_budget");
    expect(fallbackBody).not.toHaveProperty("enable_search");
    expect(fallbackBody).not.toHaveProperty("search_options");
    expect(fallbackBody).not.toHaveProperty("enable_code_interpreter");
  });

  it("normalizes non-SSE OpenAI-compatible JSON responses through the adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "done",
            reasoning_content: "step one",
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: {
                  name: "search",
                  arguments: "{\"q\":\"weather\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "kimi-profile",
        name: "Kimi",
        provider: "openai-compatible",
        providerFlavor: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "kimi-test-key",
        model: "kimi-k2-0905-preview",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "kimi",
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(result.content).toBe("done");
    expect(result.reasoning).toBe("step one");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "tool-1",
        name: "search",
        argumentsJson: "{\"q\":\"weather\"}",
        input: { q: "weather" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });
  });

  it("normalizes legacy single function_call JSON responses through the adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [
        {
          message: {
            function_call: {
              name: "search",
              arguments: "{\"q\":\"legacy\"}",
            },
          },
          finish_reason: "function_call",
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "legacy-function-call-profile",
        name: "Legacy Compatible",
        provider: "openai-compatible",
        providerFlavor: "generic-openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "legacy-test-key",
        model: "legacy-model",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "openai-compatible",
        replayPolicy: "content-only",
      },
    });

    expect(result.content).toBe("");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "toolcall-legacy-function",
        name: "search",
        argumentsJson: "{\"q\":\"legacy\"}",
        input: { q: "legacy" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });

  it("normalizes Kimi responses when reasoning_content is returned as structured parts", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: [{ type: "text", text: "done" }],
            reasoning_content: [
              { type: "text", text: "step " },
              { type: "text", text: "one" },
            ],
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 6,
        completion_tokens: 2,
        total_tokens: 8,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "kimi-structured-profile",
        name: "Kimi Structured",
        provider: "openai-compatible",
        providerFlavor: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "kimi-test-key",
        model: "kimi-k2-0905-preview",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "kimi",
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(result.content).toBe("done");
    expect(result.reasoning).toBe("step one");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toMatchObject({
      promptTokens: 6,
      completionTokens: 2,
      totalTokens: 8,
    });
  });

  it("normalizes non-SSE anthropic JSON responses through the anthropic adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      content: [
        { type: "thinking", thinking: "step one" },
        { type: "text", text: "done" },
        { type: "tool_use", id: "tool-2", name: "search", input: { q: "docs" } },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 8,
        output_tokens: 3,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "claude-profile",
        name: "Claude",
        provider: "anthropic",
        providerFlavor: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "anthropic-test-key",
        model: "claude-3-7-sonnet",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "anthropic-native",
        replayPolicy: "assistant-turn",
      },
    });

    expect(result.content).toBe("done");
    expect(result.reasoning).toBe("step one");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "tool-2",
        name: "search",
        argumentsJson: "{\"q\":\"docs\"}",
        input: { q: "docs" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 8,
      completionTokens: 3,
      totalTokens: 11,
    });
  });

  it("extracts think tags from non-SSE public minimax responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "<think>step one\nstep two</think>\n\nfinal answer",
            tool_calls: [
              {
                id: "tool-3",
                type: "function",
                function: {
                  name: "search",
                  arguments: "{\"q\":\"minimax\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 5,
        total_tokens: 14,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "minimax-public-profile",
        name: "MiniMax Public",
        provider: "openai-compatible",
        providerFlavor: "minimax-anthropic",
        baseUrl: "https://api.minimax.chat/v1",
        apiKey: "minimax-test-key",
        model: "minimax-text-01",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "minimax",
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(result.content).toBe("final answer");
    expect(result.reasoning).toBe("step one\nstep two");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "tool-3",
        name: "search",
        argumentsJson: "{\"q\":\"minimax\"}",
        input: { q: "minimax" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 9,
      completionTokens: 5,
      totalTokens: 14,
    });
  });

  it("extracts multiple leading think tags from non-SSE public minimax responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "<think>step one</think>\n<think>step two</think>\n\nfinal answer",
          },
          finish_reason: "stop",
        },
      ],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "minimax-public-multi-think-profile",
        name: "MiniMax Public Multi Think",
        provider: "openai-compatible",
        providerFlavor: "minimax-anthropic",
        baseUrl: "https://api.minimax.chat/v1",
        apiKey: "minimax-test-key",
        model: "minimax-text-01",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "minimax",
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(result.content).toBe("final answer");
    expect(result.reasoning).toBe("step one\nstep two");
    expect(result.finishReason).toBe("stop");
  });

  it("normalizes Ark responses-style JSON output arrays", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "reasoning", text: "step ark" },
            { type: "output_text", text: "done" },
          ],
        },
        {
          type: "function_call",
          call_id: "tool-4",
          name: "search",
          arguments: "{\"q\":\"ark\"}",
        },
      ],
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        total_tokens: 10,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      profile: {
        id: "ark-profile",
        name: "Ark",
        provider: "openai-compatible",
        providerFlavor: "volcengine-ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "ark-test-key",
        model: "doubao-seed-code",
      },
      messages: [{ role: "user", content: "hello" }],
      executionPlan: {
        adapterId: "volcengine-ark",
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(result.content).toBe("done");
    expect(result.reasoning).toBe("step ark");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "tool-4",
        name: "search",
        argumentsJson: "{\"q\":\"ark\"}",
        input: { q: "ark" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    });
  });
});
