import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../src/main/services/model-client", () => ({
  callModel: vi.fn(async () => ({ content: "hello", toolCalls: [], finishReason: "stop", transport: { requestVariantId: "primary", retryCount: 0, variantIndex: 0, fallbackEvents: [] } })),
}));

import { createExecutionGateway } from "../../../src/main/services/model-runtime/execution-gateway";
import { makeLegacyExecutionPlan, makeProfile } from "../contracts/test-helpers";

describe("session turn e2e", () => {
  it("runs intent -> turn plan -> gateway -> persistence", async () => {
    const myClawDir = mkdtempSync(join(tmpdir(), "myclaw-session-e2e-"));
    const gateway = createExecutionGateway({ paths: { myClawDir } as any });
    const result = await gateway.executeTurn({ mode: "legacy", profile: makeProfile({ providerFlavor: "openai" }), plan: makeLegacyExecutionPlan(), messages: [{ role: "user", content: "hello" }], tools: [], sessionId: "session-e2e" });
    expect(result.outcome.sessionId).toBe("session-e2e");
    expect(result.plan.providerFamily).toBe("openai-native");
  });
});
