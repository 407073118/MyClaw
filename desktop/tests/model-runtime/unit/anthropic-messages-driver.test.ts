import { describe, expect, it, vi } from "vitest";

const { executeRequestVariantsMock } = vi.hoisted(() => {
  return {
    executeRequestVariantsMock: vi.fn(async () => ({
      response: new Response(
        [
          "event: message_start",
          "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
          "",
          "event: content_block_delta",
          "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}",
          "",
          "event: message_delta",
          "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":8,\"output_tokens\":3}}",
          "",
          "event: message_stop",
          "data: {\"type\":\"message_stop\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "anthropic-messages", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    })),
  };
});

vi.mock("../../../src/main/services/model-client", () => ({
  buildRequestHeaders: vi.fn(() => ({ "x-api-key": "key" })),
  resolveModelEndpointUrl: vi.fn((profile: { baseUrl: string }) => `${profile.baseUrl}/messages`),
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
  anthropicMessagesDriver,
  buildAnthropicMessagesRequestBody,
} from "../../../src/main/services/model-runtime/protocols/anthropic-messages-driver";
import type { CanonicalTurnContent } from "@shared/contracts";
import { ToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";
import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

const content: CanonicalTurnContent = {
  systemSections: [{ id: "system", layer: "identity", title: "System", content: "Be helpful" }],
  userSections: [],
  taskState: null,
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  toolCalls: [],
  toolResults: [],
  approvalEvents: [],
  replayHints: { preserveReasoning: false, preserveToolLedger: false, preserveCachePrefix: false },
};

describe("anthropic messages driver", () => {
  it("builds anthropic-native system/messages blocks", () => {
    const request = buildAnthropicMessagesRequestBody({
      profile: {
        id: "profile-1",
        name: "Claude",
        provider: "anthropic",
        providerFlavor: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "key",
        model: "claude-3-7-sonnet",
      },
      plan: {
        legacyExecutionPlan: {},
      },
      content,
      toolBundle: { target: "anthropic-native", compileMode: "anthropic-detailed-description", tools: [] },
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    } as never);
    const messages = request.messages as Array<{ role: string }>;

    expect(request.model).toBe("claude-3-7-sonnet");
    expect(request.stream).toBe(true);
    expect(request.system).toContain("Be helpful");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user" });
  });

  it("maps reasoning effort into Anthropic thinking config", () => {
    const request = buildAnthropicMessagesRequestBody({
      profile: {
        id: "profile-1",
        name: "Claude",
        provider: "anthropic",
        providerFlavor: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "key",
        model: "claude-3-7-sonnet",
      },
      plan: {
        legacyExecutionPlan: {
          reasoningEffort: "high",
        },
      },
      content,
      toolBundle: { target: "anthropic-native", compileMode: "anthropic-detailed-description", tools: [] },
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    } as never);

    expect(request).toMatchObject({
      thinking: {
        type: "enabled",
        budget_tokens: 32768,
      },
    });
  });

  it("falls back to profile.defaultReasoningEffort when the execution plan leaves reasoning effort empty", () => {
    const request = buildAnthropicMessagesRequestBody({
      profile: {
        id: "profile-1",
        name: "Claude",
        provider: "anthropic",
        providerFlavor: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "key",
        model: "claude-3-7-sonnet",
        defaultReasoningEffort: "medium",
      },
      plan: {
        legacyExecutionPlan: {},
      },
      content,
      toolBundle: { target: "anthropic-native", compileMode: "anthropic-detailed-description", tools: [] },
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    } as never);

    expect(request).toMatchObject({
      thinking: {
        type: "enabled",
        budget_tokens: 16384,
      },
    });
  });

  it("uses direct messages transport for canonical execution", async () => {
    const profile = makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
    });

    const result = await anthropicMessagesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content,
      toolBundle: new ToolMiddleware().compile([], "anthropic-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(executeRequestVariantsMock).toHaveBeenCalled();
    expect(result.requestVariantId).toBe("anthropic-messages");
    expect(result.fallbackReason).toBeNull();
    expect(result.fallbackEvents).toEqual([]);
    expect(result.content).toBe("hello");
  });

  it("parses thinking deltas and tool_use blocks from messages events", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: message_start",
          "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_234\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"search\",\"input\":{}}}",
          "",
          "event: content_block_delta",
          "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\\\"kimi\\\"}\"}}",
          "",
          "event: content_block_delta",
          "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"step one\"}}",
          "",
          "event: content_block_delta",
          "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"text_delta\",\"text\":\"done\"}}",
          "",
          "event: message_delta",
          "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}",
          "",
          "event: message_stop",
          "data: {\"type\":\"message_stop\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "anthropic-messages", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
    });

    const result = await anthropicMessagesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content,
      toolBundle: new ToolMiddleware().compile([{
        id: "search",
        type: "function",
        name: "search",
        description: "Search docs",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      }], "anthropic-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.content).toBe("done");
    expect(result.reasoning).toBe("step one");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "tool_1",
        name: "search",
        argumentsJson: "{\"q\":\"kimi\"}",
        input: { q: "kimi" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 9,
      completionTokens: 4,
      totalTokens: 13,
    });
  });

  it("parses initial text and thinking blocks emitted directly in content_block_start", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: message_start",
          "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_345\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"step start\"}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"hello from start\"}}",
          "",
          "event: message_delta",
          "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":4,\"output_tokens\":2}}",
          "",
          "event: message_stop",
          "data: {\"type\":\"message_stop\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "anthropic-messages", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      provider: "openai-compatible",
      providerFlavor: "minimax-anthropic",
      baseUrl: "https://api.minimax.chat/v1",
      model: "minimax-text-01",
    });

    const result = await anthropicMessagesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content,
      toolBundle: new ToolMiddleware().compile([], "anthropic-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.reasoning).toBe("step start");
    expect(result.content).toBe("hello from start");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toMatchObject({
      promptTokens: 4,
      completionTokens: 2,
      totalTokens: 6,
    });
  });

  it("parses mixed blocks finalized through content_block_stop", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: message_start",
          "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_456\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}",
          "",
          "event: content_block_stop",
          "data: {\"type\":\"content_block_stop\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"step from stop\"}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_stop\",\"name\":\"search\",\"input\":{}}}",
          "",
          "event: content_block_stop",
          "data: {\"type\":\"content_block_stop\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_stop\",\"name\":\"search\",\"input\":{\"q\":\"minimax\"}}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
          "",
          "event: content_block_stop",
          "data: {\"type\":\"content_block_stop\",\"index\":2,\"content_block\":{\"type\":\"text\",\"text\":\"done from stop\"}}",
          "",
          "event: message_delta",
          "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":5}}",
          "",
          "event: message_stop",
          "data: {\"type\":\"message_stop\"}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "anthropic-messages", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    });

    const profile = makeProfile({
      provider: "openai-compatible",
      providerFlavor: "minimax-anthropic",
      baseUrl: "https://api.minimax.chat/v1",
      model: "minimax-text-01",
    });

    const result = await anthropicMessagesDriver.execute({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
      }),
      content,
      toolBundle: new ToolMiddleware().compile([{
        id: "search",
        type: "function",
        name: "search",
        description: "Search docs",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      }], "anthropic-native"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.reasoning).toBe("step from stop");
    expect(result.content).toBe("done from stop");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      {
        id: "tool_stop",
        name: "search",
        argumentsJson: "{\"q\":\"minimax\"}",
        input: { q: "minimax" },
      },
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 11,
      completionTokens: 5,
      totalTokens: 16,
    });
  });
});
