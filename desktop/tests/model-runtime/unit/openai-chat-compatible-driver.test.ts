import { describe, expect, it, vi } from "vitest";

const { callModelMock } = vi.hoisted(() => ({
  callModelMock: vi.fn(async () => ({
    content: "ok",
    toolCalls: [],
    finishReason: "stop",
    transport: { requestVariantId: "primary", retryCount: 0, variantIndex: 0, fallbackEvents: [] },
  })),
}));

vi.mock("../../../src/main/services/model-client", () => ({
  callModel: callModelMock,
}));

import { executeOpenAiChatCompatibleTurn } from "../../../src/main/services/model-runtime/protocols/openai-chat-compatible-driver";
import { ToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";
import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("openai chat compatible driver", () => {
  it("bridges canonical content into callModel", async () => {
    callModelMock.mockClear();

    const result = await executeOpenAiChatCompatibleTurn({
      profile: makeProfile(),
      plan: buildTurnExecutionPlan({ profile: makeProfile(), legacyExecutionPlan: makeLegacyExecutionPlan() }),
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
      toolBundle: new ToolMiddleware().compile([], "generic-openai-compatible"),
      rolloutGate: { enabled: true, rolloutOrder: 1, reason: "test" },
    });

    expect(result.content).toBe("ok");
    expect(result.requestVariantId).toBe("primary");
  });

  it("bridges Qwen vendor-native capability routes into compatible request fields", async () => {
    callModelMock.mockClear();

    const profile = makeProfile({
      providerFlavor: "qwen",
      providerFamily: "qwen-native",
      vendorFamily: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
    });

    await executeOpenAiChatCompatibleTurn({
      profile,
      plan: buildTurnExecutionPlan({
        profile,
        legacyExecutionPlan: makeLegacyExecutionPlan(),
        requestedProtocolTarget: "openai-chat-compatible",
        capability: {
          supportsTools: true,
          supportsNativeWebSearch: true,
          supportsNativeCodeInterpreter: true,
        },
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
    });

    expect(callModelMock).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        requestBody: expect.objectContaining({
          enable_search: true,
          enable_code_interpreter: true,
        }),
      }),
    }));
  });
});
