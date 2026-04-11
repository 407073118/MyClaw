import { describe, expect, it, vi } from "vitest";

const { executeRequestVariantsMock } = vi.hoisted(() => ({
  executeRequestVariantsMock: vi.fn(async ({ url }: { url: string }) => {
    if (url.endsWith("/responses")) {
      return {
        response: new Response(
          [
            "event: response.created",
            "data: {\"id\":\"resp_123\"}",
            "",
            "event: response.output_text.delta",
            "data: {\"delta\":\"done\"}",
            "",
            "event: response.completed",
            "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":12,\"output_tokens\":4}}",
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
      };
    }

    return {
      response: new Response(
        [
          "event: message_start",
          "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null}}",
          "",
          "event: content_block_start",
          "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
          "",
          "event: content_block_delta",
          "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"done\"}}",
          "",
          "event: message_delta",
          "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":10,\"output_tokens\":3}}",
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
    };
  }),
}));

vi.mock("../../../src/main/services/model-client", () => ({
  callModel: vi.fn(async () => ({
    content: "done",
    toolCalls: [],
    finishReason: "stop",
    transport: {
      requestVariantId: "primary",
      retryCount: 0,
      variantIndex: 0,
      fallbackEvents: [],
    },
  })),
  resolveModelEndpointUrl: vi.fn((profile: { baseUrl: string }) => `${profile.baseUrl}/messages`),
  buildRequestHeaders: vi.fn(() => ({ "x-test": "1" })),
}));

vi.mock("../../../src/main/services/model-transport", () => ({
  executeRequestVariants: executeRequestVariantsMock,
}));

import { createExecutionGateway } from "../../../src/main/services/model-runtime/execution-gateway";
import { SESSION_RUNTIME_VERSION, type ExecutionPlan, type ModelProfile } from "@shared/contracts";

describe("execution gateway", () => {
  it("returns shared outcome metadata for legacy shim input", async () => {
    const gateway = createExecutionGateway();
    const profile: ModelProfile = {
      id: "profile-1",
      name: "Model",
      provider: "openai-compatible",
      providerFlavor: "generic-openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "key",
      model: "gpt-4.1-mini",
    };
    const executionPlan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn",
      fallbackAdapterIds: [],
    };

    const result = await gateway.executeTurn({
      mode: "legacy",
      profile,
      executionPlan,
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      sessionId: "session-1",
    });

    expect(result.plan.providerFamily).toBe("generic-openai-compatible");
    expect(result.outcome.sessionId).toBe("session-1");
    expect(result.actualExecutionPath).toBe("legacy-shim");
    expect(result.requestShape).toMatchObject({
      model: "gpt-4.1-mini",
    });
  });

  it("compiles strict tools and surfaces responses-native request metadata for openai-native legacy input", async () => {
    const gateway = createExecutionGateway({
      rolloutFlags: {
        "openai-native": true,
      },
    });
    const profile: ModelProfile = {
      id: "profile-openai",
      name: "OpenAI",
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
      model: "gpt-4.1",
    };
    const executionPlan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn",
      fallbackAdapterIds: [],
    };

    const result = await gateway.executeTurn({
      mode: "legacy",
      profile,
      executionPlan,
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function",
        function: {
          name: "fs_read",
          description: "Read file contents",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      }],
      sessionId: "session-openai",
    });

    expect(result.plan.protocolTarget).toBe("openai-responses");
    expect(result.toolBundle.compileMode).toBe("openai-strict");
    expect(result.outcome.toolCompileMode).toBe("openai-strict");
    expect(result.requestVariantId).toBe("openai-responses");
    expect(result.actualExecutionPath).toBe("legacy-shim");
    expect(result.requestShape).toMatchObject({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    });
  });

  it("compiles anthropic tools and surfaces messages-native request metadata for anthropic-native legacy input", async () => {
    const gateway = createExecutionGateway({
      rolloutFlags: {
        "anthropic-native": true,
      },
    });
    const profile: ModelProfile = {
      id: "profile-anthropic",
      name: "Claude",
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "key",
      model: "claude-3-7-sonnet",
    };
    const executionPlan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn",
      fallbackAdapterIds: [],
    };

    const result = await gateway.executeTurn({
      mode: "legacy",
      profile,
      executionPlan,
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function",
        function: {
          name: "fs_read",
          description: "Read file contents",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      }],
      sessionId: "session-anthropic",
    });

    expect(result.plan.protocolTarget).toBe("anthropic-messages");
    expect(result.toolBundle.compileMode).toBe("anthropic-detailed-description");
    expect(result.outcome.toolCompileMode).toBe("anthropic-detailed-description");
    expect(result.requestVariantId).toBe("anthropic-messages");
    expect(result.actualExecutionPath).toBe("legacy-shim");
    expect(result.requestShape).toMatchObject({
      model: "claude-3-7-sonnet",
      stream: true,
    });
    expect(result.requestShape.tools).toEqual([
      expect.objectContaining({
        name: "fs_read",
        input_schema: expect.objectContaining({
          type: "object",
          properties: {
            path: { type: "string" },
          },
        }),
      }),
    ]);
  });

  it("uses direct transport for canonical openai-native execution", async () => {
    const gateway = createExecutionGateway({
      rolloutFlags: {
        "openai-native": true,
      },
    });
    const profile: ModelProfile = {
      id: "profile-openai",
      name: "OpenAI",
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
      model: "gpt-4.1",
    };
    const executionPlan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn",
      fallbackAdapterIds: [],
    };

    const result = await gateway.executeTurn({
      mode: "canonical",
      profile,
      executionPlan,
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      sessionId: "session-openai-canonical",
    });

    expect(result.plan.protocolTarget).toBe("openai-responses");
    expect(result.actualExecutionPath).toBe("canonical-driver");
    expect(result.requestVariantId).toBe("openai-responses");
    expect(result.fallbackReason).toBeNull();
    expect(result.fallbackEvents).toEqual([]);
    expect(result.outcome.requestVariantId).toBe("openai-responses");
    expect(result.outcome.fallbackReason).toBeNull();
    expect(result.outcome.fallbackEvents).toEqual([]);
  });

  it("uses direct transport for canonical anthropic-native execution", async () => {
    const gateway = createExecutionGateway({
      rolloutFlags: {
        "anthropic-native": true,
      },
    });
    const profile: ModelProfile = {
      id: "profile-anthropic",
      name: "Claude",
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "key",
      model: "claude-3-7-sonnet",
    };
    const executionPlan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn",
      fallbackAdapterIds: [],
    };

    const result = await gateway.executeTurn({
      mode: "canonical",
      profile,
      executionPlan,
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      sessionId: "session-anthropic-canonical",
    });

    expect(result.plan.protocolTarget).toBe("anthropic-messages");
    expect(result.actualExecutionPath).toBe("canonical-driver");
    expect(result.requestVariantId).toBe("anthropic-messages");
    expect(result.fallbackReason).toBeNull();
    expect(result.fallbackEvents).toEqual([]);
    expect(result.outcome.requestVariantId).toBe("anthropic-messages");
    expect(result.outcome.fallbackReason).toBeNull();
    expect(result.outcome.fallbackEvents).toEqual([]);
  });
});
