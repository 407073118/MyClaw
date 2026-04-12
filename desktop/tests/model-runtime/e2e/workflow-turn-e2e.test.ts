import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/services/model-client", () => ({
  callModel: vi.fn(async () => ({ content: "workflow", toolCalls: [], finishReason: "stop", transport: { requestVariantId: "primary", retryCount: 0, variantIndex: 0, fallbackEvents: [] } })),
}));

import { createExecutionGateway } from "../../../src/main/services/model-runtime/execution-gateway";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("workflow turn e2e", () => {
  it("writes unified workflow outcomes", async () => {
    const gateway = createExecutionGateway();
    const result = await gateway.executeTurn({ mode: "legacy", profile: makeProfile(), plan: makeLegacyExecutionPlan(), messages: [{ role: "user", content: "hello" }], tools: [], workflowRunId: "run-e2e" });
    expect(result.outcome.workflowRunId).toBe("run-e2e");
  });
});
