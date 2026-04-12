import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/services/model-client", () => ({
  callModel: vi.fn(async () => ({ content: "ok", toolCalls: [], finishReason: "stop", transport: { requestVariantId: "primary", retryCount: 0, variantIndex: 0, fallbackEvents: [] } })),
}));

import { executeOpenAiChatCompatibleTurn } from "../../../src/main/services/model-runtime/protocols/openai-chat-compatible-driver";
import { ToolMiddleware } from "../../../src/main/services/model-runtime/tool-middleware";
import { buildTurnExecutionPlan } from "../../../src/main/services/model-runtime/turn-execution-plan-resolver";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("openai chat compatible driver", () => {
  it("bridges canonical content into callModel", async () => {
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
});
