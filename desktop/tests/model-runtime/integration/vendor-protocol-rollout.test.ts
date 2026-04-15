import { describe, expect, it, vi } from "vitest";

const { executeRequestVariantsMock } = vi.hoisted(() => ({
  executeRequestVariantsMock: vi.fn(async ({ url }: { url: string }) => {
    if (url.endsWith("/responses")) {
      return {
        response: new Response(
          [
            "event: response.created",
            "data: {\"id\":\"resp_vendor_123\"}",
            "",
            "event: response.output_text.delta",
            "data: {\"delta\":\"vendor-done\"}",
            "",
            "event: response.completed",
            "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":2}}",
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
          "event: response.created",
          "data: {\"id\":\"resp_vendor_fallback\"}",
          "",
          "event: response.output_text.delta",
          "data: {\"delta\":\"fallback-done\"}",
          "",
          "event: response.completed",
          "data: {\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":2}}",
          "",
        ].join("\n"),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
      variant: { id: "openai-chat-compatible", body: {} },
      variantIndex: 0,
      attempt: 0,
      retryCount: 0,
      fallbackEvents: [],
    };
  }),
}));

vi.mock("../../../src/main/services/model-client", () => ({
  callModel: vi.fn(async () => ({
    content: "fallback-done",
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
import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("vendor protocol rollout", () => {
  it("allows vendor+protocol rollout to enable qwen responses even when the provider family gate stays off", async () => {
    const profile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
    });
    const plan = buildTurnExecutionPlan({
      profile,
      legacyExecutionPlan: makeLegacyExecutionPlan(),
      requestedProtocolTarget: "openai-responses",
    });
    const gateway = createExecutionGateway({
      rolloutFlags: {
        "qwen-dashscope": false,
      },
      vendorProtocolFlags: {
        "qwen:openai-responses": true,
      },
    });

    const result = await gateway.executeTurn({
      mode: "canonical",
      profile,
      executionPlan: plan,
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      sessionId: "session-qwen-protocol-gate",
    });

    expect(result.plan.vendorFamily).toBe("qwen");
    expect(result.plan.protocolTarget).toBe("openai-responses");
    expect(result.actualExecutionPath).toBe("canonical-driver");
    expect(result.requestVariantId).toBe("openai-responses");
    expect(result.outcome.actualExecutionPath).toBe("canonical-driver");
    expect(result.outcome.telemetry?.actualExecutionPath).toBe("canonical-driver");
  });

  it("keeps Qwen responses request shaping on vendor-native semantics during protocol rollout", async () => {
    const profile = makeProfile({
      providerFlavor: "qwen",
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
    const plan = buildTurnExecutionPlan({
      profile,
      legacyExecutionPlan: makeLegacyExecutionPlan(),
      requestedProtocolTarget: "openai-responses",
    });
    const gateway = createExecutionGateway({
      vendorProtocolFlags: {
        "qwen:openai-responses": true,
      },
    });

    const result = await gateway.executeTurn({
      mode: "canonical",
      profile,
      previousResponseId: "resp_qwen_prev",
      executionPlan: plan,
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      sessionId: "session-qwen-protocol-shape",
    });

    expect(result.plan.providerFamily).toBe("qwen-native");
    expect(result.plan.protocolTarget).toBe("openai-responses");
    expect(result.requestShape).toMatchObject({
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
    expect(result.requestShape).not.toHaveProperty("reasoning");
    expect(result.requestShape).not.toHaveProperty("background");
  });
});
