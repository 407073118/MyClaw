import { describe, expect, it, vi } from "vitest";

const { executeRequestVariantsMock } = vi.hoisted(() => {
  return {
    executeRequestVariantsMock: vi.fn(async () => ({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_123\"}",
          "",
          "event: response.output_text.delta",
          "data: {\"delta\":\"hello\"}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":12,\"output_tokens\":4,\"reasoning_tokens\":3,\"input_tokens_details\":{\"cached_tokens\":5}}}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    })),
  };
});

vi.mock("../../../src/main/services/model-client", () => ({
  buildRequestHeaders: vi.fn(() => ({
    "content-type": "application/json",
    authorization: "Bearer key",
  })),
  callModel: vi.fn(async () => ({
    content: "ok",
    toolCalls: [],
    finishReason: "stop",
    transport: {
      requestVariantId: "primary",
      retryCount: 0,
      variantIndex: 0,
      fallbackEvents: [],
    },
  })),
}));

vi.mock("../../../src/main/services/model-transport", () => ({
  executeRequestVariants: executeRequestVariantsMock,
}));

import {
  buildOpenAiResponsesRequestBody,
  openAiResponsesDriver,
} from "../../../src/main/services/model-runtime/protocols/openai-responses-driver";
import { ToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";
import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("openai responses driver", () => {
  it("builds responses-native input blocks", () => {
    const request = buildOpenAiResponsesRequestBody("gpt-4.1", [
      { role: "user", content: "hello" },
    ], []);

    expect(request).toEqual({
      model: "gpt-4.1",
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
      tools: [],
      stream: true,
    });
  });

  it("uses direct responses transport for canonical execution", async () => {
    const profile = makeProfile({
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(executeRequestVariantsMock).toHaveBeenCalled();
    expect(result.requestVariantId).toBe("openai-responses");
    expect(result.fallbackReason).toBeNull();
    expect(result.fallbackEvents).toEqual([]);
    expect(result.content).toBe("hello");
    expect(result.responseId).toBe("resp_123");
    expect(result.usage).toMatchObject({
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
      reasoningTokens: 3,
      cachedInputTokens: 5,
    });
  });

  it("parses reasoning and tool calls from structured responses events", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_456\"}",
          "",
          "event: response.reasoning_summary_text.delta",
          "data: {\"delta\":\"step one\"}",
          "",
          "event: response.content_part.delta",
          "data: {\"delta\":\"done\"}",
          "",
          "event: response.output_item.added",
          "data: {\"type\":\"function_call\",\"name\":\"search\",\"call_id\":\"call_1\",\"arguments\":\"\"}",
          "",
          "event: response.function_call_arguments.delta",
          "data: {\"call_id\":\"call_1\",\"delta\":\"{\\\"q\\\":\\\"docs\\\"}\"}",
          "",
          "event: response.output_item.done",
          "data: {\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\\\"docs\\\"}\"}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":6,\"output_tokens\":2}}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "volcengine-ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-code",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([{
        id: "search",
        type: "function",
        name: "search",
        description: "Search docs",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      }], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.content).toBe("done");
    expect(result.reasoning).toBe("step one");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "search",
        argumentsJson: "{\"q\":\"docs\"}",
        input: { q: "docs" },
      },
    ]);
    expect(result.responseId).toBe("resp_456");
  });

  it("falls back to item_id when responses tool events omit call_id", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_789\"}",
          "",
          "event: response.output_item.added",
          "data: {\"type\":\"function_call\",\"item_id\":\"item_1\",\"name\":\"search\",\"arguments\":\"\"}",
          "",
          "event: response.function_call_arguments.delta",
          "data: {\"item_id\":\"item_1\",\"delta\":\"{\\\"q\\\":\\\"item route\\\"}\"}",
          "",
          "event: response.output_item.done",
          "data: {\"type\":\"function_call\",\"item_id\":\"item_1\",\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\\\"item route\\\"}\"}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([{
        id: "search",
        type: "function",
        name: "search",
        description: "Search docs",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      }], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "item_1",
        name: "search",
        argumentsJson: "{\"q\":\"item route\"}",
        input: { q: "item route" },
      },
    ]);
    expect(result.responseId).toBe("resp_789");
  });

  it("parses reasoning when responses only emit reasoning_summary_part.done", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_reasoning_done\"}",
          "",
          "event: response.reasoning_summary_part.done",
          "data: {\"type\":\"reasoning_summary_text\",\"text\":\"step from done\"}",
          "",
          "event: response.output_text.delta",
          "data: {\"delta\":\"answer\"}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.reasoning).toBe("step from done");
    expect(result.content).toBe("answer");
    expect(result.finishReason).toBe("stop");
  });

  it("parses content when responses only emit content_part.done", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_content_done\"}",
          "",
          "event: response.content_part.done",
          "data: {\"type\":\"output_text\",\"text\":\"done-only answer\"}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "volcengine-ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-code",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.content).toBe("done-only answer");
    expect(result.finishReason).toBe("stop");
    expect(result.responseId).toBe("resp_content_done");
  });

  it("uses profile.defaultReasoningEffort when the execution plan does not specify one", () => {
    const profile = makeProfile({
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
      defaultReasoningEffort: "xhigh",
    });

    const request = openAiResponsesDriver.buildRequestBody?.({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    } as never);

    expect(request).toMatchObject({
      reasoning: {
        effort: "xhigh",
      },
    });
  });

  it("adds previous_response_id when server-state continuation is enabled", () => {
    const profile = makeProfile({
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
      responsesApiConfig: {
        useServerState: true,
      },
    });

    const request = openAiResponsesDriver.buildRequestBody?.({
      profile,
      previousResponseId: "resp_prev_123",
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    } as never);

    expect(request).toMatchObject({
      previous_response_id: "resp_prev_123",
    });
  });

  it("captures native web search traces and citations from responses output items", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_native_search\"}",
          "",
          "event: response.content_part.done",
          "data: {\"type\":\"output_text\",\"text\":\"OpenAI released updates.\"}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"web_search_call\",\"id\":\"ws_1\",\"status\":\"completed\",\"action\":{\"type\":\"search\",\"queries\":[\"OpenAI latest updates\"]}}}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"message\",\"id\":\"msg_1\",\"status\":\"completed\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"OpenAI released updates.\",\"annotations\":[{\"type\":\"url_citation\",\"start_index\":0,\"end_index\":23,\"url\":\"https://example.com/news\",\"title\":\"Latest News\"}]}]}}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":3}}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([{
        id: "fs_read",
        type: "function",
        name: "fs_read",
        description: "Read file",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.content).toBe("OpenAI released updates.");
    expect(result.responseId).toBe("resp_native_search");
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "web_search_call",
        capabilityId: "search",
        vendor: "openai",
        payload: expect.objectContaining({
          traceId: "ws_1",
          action: "search",
          queries: ["OpenAI latest updates"],
        }),
      }),
    ]);
    expect(result.citations).toEqual([
      expect.objectContaining({
        url: "https://example.com/news",
        title: "Latest News",
        domain: "example.com",
        sourceType: "vendor-web-search",
        traceRef: "ws_1",
        startIndex: 0,
        endIndex: 23,
        snippet: "OpenAI released updates",
      }),
    ]);
  });

  it("captures native file search traces and file citations from responses output items", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_native_file_search\"}",
          "",
          "event: response.content_part.done",
          "data: {\"type\":\"output_text\",\"text\":\"The handbook requires manager approval for purchases over $5,000.\"}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"file_search_call\",\"id\":\"fs_1\",\"status\":\"completed\",\"queries\":[\"manager approval purchase limit\"],\"results\":null}}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"message\",\"id\":\"msg_fs_1\",\"status\":\"completed\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"The handbook requires manager approval for purchases over $5,000.\",\"annotations\":[{\"type\":\"file_citation\",\"index\":55,\"file_id\":\"file_123\",\"filename\":\"employee-handbook.pdf\"}]}]}}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":12,\"output_tokens\":9}}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      vendorFamily: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
      responsesApiConfig: {
        fileSearch: {
          vectorStoreIds: ["vs_knowledge_1"],
          maxNumResults: 8,
        },
      },
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.responseId).toBe("resp_native_file_search");
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "file_search_call",
        capabilityId: "knowledge-retrieval",
        vendor: "openai",
        payload: expect.objectContaining({
          traceId: "fs_1",
          queries: ["manager approval purchase limit"],
          status: "completed",
        }),
      }),
    ]);
    expect(result.citations).toEqual([
      expect.objectContaining({
        sourceType: "file-search",
        fileId: "file_123",
        filename: "employee-handbook.pdf",
        url: null,
        title: "employee-handbook.pdf",
      }),
    ]);
  });

  it("returns a background task handle when a native research response is queued asynchronously", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({
          id: "resp_background_1",
          status: "queued",
          background: true,
          created_at: 1741476542,
          output: [],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      model: "o3-deep-research",
      responsesApiConfig: {
        backgroundMode: "auto",
      },
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
      sessionId: "session-1",
    });

    expect(result.finishReason).toBe("background");
    expect(result.responseId).toBe("resp_background_1");
    expect(result.backgroundTask).toEqual(
      expect.objectContaining({
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "queued",
        pollAfterMs: 2000,
      }),
    );
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "background_response_started",
        capabilityId: "research-task",
        payload: expect.objectContaining({
          responseId: "resp_background_1",
          status: "queued",
          reason: "deep_research_model",
        }),
      }),
    ]);
  });

  it("materializes terminal background responses back into assistant content and citations", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({
          id: "resp_background_done_1",
          status: "completed",
          output: [
            {
              id: "ws_1",
              type: "web_search_call",
              status: "completed",
              action: {
                type: "search",
                queries: ["latest openai background mode docs"],
              },
            },
            {
              id: "msg_1",
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Background answer",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://openai.com/index/introducing-gpt-5-2-codex/",
                      title: "Introducing GPT-5.2-Codex",
                      start_index: 0,
                      end_index: 10,
                    },
                  ],
                },
              ],
            },
          ],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      model: "o3-deep-research",
      responsesApiConfig: {
        backgroundMode: "always",
      },
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
      sessionId: "session-1",
    });

    expect(result.finishReason).toBe("stop");
    expect(result.content).toBe("Background answer");
    expect(result.backgroundTask).toBeNull();
    expect(result.citations).toEqual([
      expect.objectContaining({
        url: "https://openai.com/index/introducing-gpt-5-2-codex/",
        title: "Introducing GPT-5.2-Codex",
        snippet: "Background",
      }),
    ]);
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "web_search_call",
        capabilityId: "search",
      }),
    ]);
  });

  it("captures native computer calls and batched actions from responses output items", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_computer_1\"}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"computer_call\",\"id\":\"cc_1\",\"call_id\":\"cc_1\",\"status\":\"completed\",\"actions\":[{\"type\":\"screenshot\"},{\"type\":\"click\",\"x\":640,\"y\":220},{\"type\":\"type\",\"text\":\"OpenAI\"}]}}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-responses", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
    });

    const result = await openAiResponsesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "openai-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.finishReason).toBe("computer_calls");
    expect(result.computerCalls).toEqual([
      expect.objectContaining({
        id: "cc_1",
        status: "completed",
        actions: [
          { type: "screenshot" },
          { type: "click", x: 640, y: 220 },
          { type: "type", text: "OpenAI" },
        ],
      }),
    ]);
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "computer_call",
        capabilityId: "computer",
        payload: expect.objectContaining({
          callId: "cc_1",
          actionCount: 3,
        }),
      }),
    ]);
  });

  it("builds Qwen-native responses requests with official fields instead of generic OpenAI reasoning patches", () => {
    const profile = makeProfile({
      providerFlavor: "qwen",
      providerFamily: "qwen-native",
      protocolTarget: "openai-responses",
      vendorFamily: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
      defaultReasoningEffort: "high",
      responsesApiConfig: {
        useServerState: true,
        backgroundMode: "always",
        fileSearch: {
          vectorStoreIds: ["vs_qwen_1"],
        },
      },
    });

    const request = openAiResponsesDriver.buildRequestBody?.({
      profile,
      previousResponseId: "resp_qwen_prev",
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content: {
        systemSections: [],
        userSections: [],
        taskState: null,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        toolCalls: [],
        toolResults: [],
        approvalEvents: [],
        replayHints: { preserveReasoning: true, preserveToolLedger: true, preserveCachePrefix: true },
      },
      toolBundle: new ToolMiddleware().compile([], "qwen-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
      sessionId: "session-qwen",
    } as never);

    expect(request).toMatchObject({
      enable_thinking: true,
      thinking_budget: 8192,
      previous_response_id: "resp_qwen_prev",
      tools: [
        { type: "web_search" },
        { type: "web_extractor" },
        { type: "code_interpreter" },
        { type: "file_search", vector_store_ids: ["vs_qwen_1"] },
      ],
    });
    expect(request).not.toHaveProperty("reasoning");
    expect(request).not.toHaveProperty("background");
  });
});
