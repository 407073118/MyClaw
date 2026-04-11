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
});
