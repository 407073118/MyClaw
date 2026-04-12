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
});
