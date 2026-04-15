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

vi.mock("../../../src/main/services/model-runtime/rollout-gates", async () => {
  const actual = await vi.importActual<typeof import("../../../src/main/services/model-runtime/rollout-gates")>("../../../src/main/services/model-runtime/rollout-gates");
  return {
    ...actual,
    resolveEffectiveExecutionRolloutGate: vi.fn((input: {
      providerFamily: string;
      providerFlags?: Record<string, boolean>;
      vendorProtocolFlags?: Record<string, boolean>;
      vendorFamily?: string | null;
      protocolTarget: string;
    }) => {
      const providerEnabled = input.providerFlags?.[input.providerFamily] === true;
      const vendorKey = input.vendorFamily ? `${input.vendorFamily}:${input.protocolTarget}` : null;
      const vendorEnabled = vendorKey ? input.vendorProtocolFlags?.[vendorKey] === true : false;
      return {
        enabled: providerEnabled || vendorEnabled,
        rolloutOrder: 0,
        reason: providerEnabled || vendorEnabled ? "runtime-flag-override" : "test-rollout-gate-bypass",
      };
    }),
  };
});

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
      responsesApiConfig: {
        useServerState: true,
      },
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
    expect(result.capabilityRoutes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "vendor-native",
    });
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
      responsesApiConfig: {
        useServerState: true,
      },
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
      previousResponseId: "resp_prev_123",
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
    expect(result.requestShape).toMatchObject({
      previous_response_id: "resp_prev_123",
    });
    expect(result.outcome.responseId).toBe("resp_123");
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

  it("surfaces native web search tools, citations, and traces for canonical openai execution", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_native_search_gateway\"}",
          "",
          "event: response.content_part.done",
          "data: {\"type\":\"output_text\",\"text\":\"OpenAI released updates.\"}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"web_search_call\",\"id\":\"ws_gateway\",\"status\":\"completed\",\"action\":{\"type\":\"search\",\"queries\":[\"OpenAI latest updates\"]}}}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"message\",\"id\":\"msg_gateway\",\"status\":\"completed\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"OpenAI released updates.\",\"annotations\":[{\"type\":\"url_citation\",\"start_index\":0,\"end_index\":23,\"url\":\"https://example.com/news\",\"title\":\"Latest News\"}]}]}}",
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
    });

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
      model: "gpt-5.4",
      responsesApiConfig: {
        useServerState: true,
      },
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
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Local web search fallback",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        },
        {
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
        },
      ],
      sessionId: "session-openai-native-search",
    });

    expect(result.requestShape.tools).toEqual(expect.arrayContaining([
      { type: "web_search" },
      {
        type: "function",
        name: "fs_read",
        description: "Read file contents",
        parameters: expect.objectContaining({
          type: "object",
        }),
      },
    ]));
    expect(result.toolBundle.registry.map((tool) => tool.name)).toEqual(["fs_read"]);
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "web_search_call",
        capabilityId: "search",
        payload: expect.objectContaining({
          traceId: "ws_gateway",
          action: "search",
        }),
      }),
    ]);
    expect(result.citations).toEqual([
      expect.objectContaining({
        url: "https://example.com/news",
        title: "Latest News",
        traceRef: "ws_gateway",
        sourceType: "vendor-web-search",
      }),
    ]);
    expect(result.outcome.capabilityEvents).toEqual(result.capabilityEvents);
    expect(result.outcome.citations).toEqual(result.citations);
  });

  it("persists native background research handles for canonical openai execution", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({
          id: "resp_background_gateway",
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
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
      model: "o3-deep-research",
      responsesApiConfig: {
        useServerState: true,
        backgroundMode: "auto",
      },
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
      sessionId: "session-openai-background",
    });

    expect(result.requestShape).toMatchObject({
      background: true,
      stream: false,
    });
    expect(result.finishReason).toBe("background");
    expect(result.backgroundTask).toEqual(
      expect.objectContaining({
        id: "resp_background_gateway",
        providerResponseId: "resp_background_gateway",
        status: "queued",
      }),
    );
    expect(result.outcome.backgroundTask).toEqual(result.backgroundTask);
    expect(result.outcome.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "background_response_started",
        capabilityId: "research-task",
      }),
    ]);
  });

  it("surfaces native computer calls for canonical openai execution", async () => {
    executeRequestVariantsMock.mockResolvedValueOnce({
      response: new Response(
        [
          "event: response.created",
          "data: {\"id\":\"resp_native_computer_gateway\"}",
          "",
          "event: response.output_item.done",
          "data: {\"item\":{\"type\":\"computer_call\",\"id\":\"cc_gateway\",\"call_id\":\"cc_gateway\",\"status\":\"completed\",\"actions\":[{\"type\":\"screenshot\"},{\"type\":\"click\",\"x\":420,\"y\":220}]}}",
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
      model: "gpt-5.4",
      responsesApiConfig: {
        useServerState: true,
      },
      discoveredCapabilities: {
        source: "observed-response",
        supportsTools: true,
        supportsNativeComputer: true,
      },
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
      messages: [{ role: "user", content: "open the page and click login" }],
      tools: [],
      sessionId: "session-openai-native-computer",
    });

    expect(result.requestShape.tools).toEqual(expect.arrayContaining([
      { type: "computer" },
    ]));
    expect(result.computerCalls).toEqual([
      expect.objectContaining({
        id: "cc_gateway",
        actions: [
          { type: "screenshot" },
          { type: "click", x: 420, y: 220 },
        ],
      }),
    ]);
    expect(result.outcome.computerCalls).toEqual([
      expect.objectContaining({
        id: "cc_gateway",
      }),
    ]);
    expect(result.capabilityEvents).toEqual([
      expect.objectContaining({
        type: "computer_call",
        capabilityId: "computer",
        payload: expect.objectContaining({
          callId: "cc_gateway",
          actionCount: 2,
        }),
      }),
    ]);
  });

  it("runs native computer batches through the injected harness and continues the response loop", async () => {
    const callCountBefore = executeRequestVariantsMock.mock.calls.length;
    executeRequestVariantsMock
      .mockResolvedValueOnce({
        response: new Response(
          [
            "event: response.created",
            "data: {\"id\":\"resp_native_computer_loop_1\"}",
            "",
            "event: response.output_item.done",
            "data: {\"item\":{\"type\":\"computer_call\",\"id\":\"cc_loop_1\",\"call_id\":\"cc_loop_1\",\"status\":\"completed\",\"actions\":[{\"type\":\"click\",\"x\":420,\"y\":220}]}}",
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
      })
      .mockResolvedValueOnce({
        response: new Response(
          [
            "event: response.created",
            "data: {\"id\":\"resp_native_computer_loop_2\"}",
            "",
            "event: response.content_part.done",
            "data: {\"type\":\"output_text\",\"text\":\"completed after click\"}",
            "",
            "event: response.output_item.done",
            "data: {\"item\":{\"type\":\"message\",\"id\":\"msg_loop_done\",\"status\":\"completed\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"completed after click\",\"annotations\":[]}]}}",
            "",
            "event: response.completed",
            "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":18,\"output_tokens\":7}}",
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

    const computerHarness = {
      executeCalls: vi.fn(async () => ({
        responseInputItems: [
          {
            type: "computer_call_output",
            call_id: "cc_loop_1",
            output: {
              type: "input_image",
              image_url: "data:image/jpeg;base64,abc123",
              detail: "original",
            },
          },
        ],
        capabilityEvents: [
          {
            type: "computer_action_executed",
            capabilityId: "computer",
            createdAt: "2026-04-14T02:00:00.000Z",
            payload: {
              callId: "cc_loop_1",
              actionType: "click",
              actionIndex: 0,
            },
          },
        ],
      })),
    };

    const gateway = createExecutionGateway({
      rolloutFlags: {
        "openai-native": true,
      },
      computerHarness,
    } as any);
    const profile: ModelProfile = {
      id: "profile-openai",
      name: "OpenAI",
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
      model: "gpt-5.4",
      responsesApiConfig: {
        useServerState: true,
      },
      discoveredCapabilities: {
        source: "observed-response",
        supportsTools: true,
        supportsNativeComputer: true,
      },
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
      messages: [{ role: "user", content: "click login and continue" }],
      tools: [],
      sessionId: "session-openai-native-computer-loop",
    });

    expect(computerHarness.executeCalls).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-openai-native-computer-loop",
      responseId: "resp_native_computer_loop_1",
      computerCalls: [
        expect.objectContaining({
          id: "cc_loop_1",
        }),
      ],
    }));
    expect(executeRequestVariantsMock.mock.calls.length - callCountBefore).toBe(2);
    expect(executeRequestVariantsMock.mock.calls[callCountBefore + 1]?.[0]?.requestVariants?.[0]?.body).toMatchObject({
      previous_response_id: "resp_native_computer_loop_1",
      input: [
        {
          type: "computer_call_output",
          call_id: "cc_loop_1",
          output: {
            type: "input_image",
            image_url: "data:image/jpeg;base64,abc123",
            detail: "original",
          },
        },
      ],
    });
    expect(result.content).toBe("completed after click");
    expect(result.capabilityEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "computer_call",
        capabilityId: "computer",
      }),
      expect.objectContaining({
        type: "computer_action_executed",
        capabilityId: "computer",
      }),
    ]));
    expect(result.outcome.computerCalls).toEqual([
      expect.objectContaining({
        id: "cc_loop_1",
      }),
    ]);
  });

  it("surfaces qwen-native responses capability routes through the execution gateway", async () => {
    const gateway = createExecutionGateway();
    const profile: ModelProfile = {
      id: "profile-qwen",
      name: "Qwen",
      provider: "openai-compatible",
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "key",
      model: "qwen-max",
      providerFamily: "qwen-native",
      protocolTarget: "openai-responses",
      discoveredCapabilities: {
        source: "observed-response",
        supportsTools: true,
        supportsNativeWebSearch: true,
        supportsNativeWebExtractor: true,
        supportsNativeCodeInterpreter: true,
        supportsNativeFileSearch: true,
        supportsContinuation: true,
      },
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
      sessionId: "session-qwen-routes",
    });

    expect(result.plan.providerFamily).toBe("qwen-native");
    expect(result.plan.protocolTarget).toBe("openai-responses");
    expect(result.capabilityRoutes.find((route) => route.capabilityId === "page-read")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "web_extractor",
    });
    expect(result.capabilityRoutes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "vendor-native",
      nativeToolName: "code_interpreter",
    });
  });

  it("keeps moonshot-native anthropic capability routes on the agent-oriented path through the execution gateway", async () => {
    const gateway = createExecutionGateway();
    const profile: ModelProfile = {
      id: "profile-kimi",
      name: "Kimi",
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKey: "key",
      model: "kimi-k2.5",
      providerFamily: "moonshot-native",
      protocolTarget: "anthropic-messages",
      discoveredCapabilities: {
        source: "observed-response",
        supportsTools: true,
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
        requiresReasoningReplay: true,
      },
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
      sessionId: "session-kimi-routes",
    });

    expect(result.plan.providerFamily).toBe("moonshot-native");
    expect(result.plan.protocolTarget).toBe("anthropic-messages");
    expect(result.capabilityRoutes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
    });
    expect(result.capabilityRoutes.find((route) => route.capabilityId === "computer")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
    });
  });

  it("keeps local web tools available for moonshot-native chat-compatible turns until formula tools are loaded", async () => {
    const gateway = createExecutionGateway();
    const profile: ModelProfile = {
      id: "profile-kimi-compatible",
      name: "Kimi Compatible",
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKey: "key",
      model: "kimi-k2.5",
      providerFamily: "moonshot-native",
      protocolTarget: "openai-chat-compatible",
      discoveredCapabilities: {
        source: "observed-response",
        supportsTools: true,
        supportsNativeWebSearch: true,
        supportsNativeCodeInterpreter: true,
        requiresReasoningReplay: true,
      },
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
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Local web search fallback",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "http_fetch",
            description: "Fetch content from a URL",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_open",
            description: "Open the browser to a URL",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
            },
          },
        },
        {
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
        },
      ],
      sessionId: "session-kimi-compatible-tools",
    });

    expect(result.plan.providerFamily).toBe("moonshot-native");
    expect(result.plan.protocolTarget).toBe("openai-chat-compatible");
    expect(result.capabilityRoutes.find((route) => route.capabilityId === "search")).toMatchObject({
      routeType: "managed-local",
      nativeToolName: null,
    });
    expect(result.toolBundle.registry.map((tool) => tool.name)).toEqual([
      "web_search",
      "http_fetch",
      "browser_open",
      "fs_read",
    ]);
  });
});
