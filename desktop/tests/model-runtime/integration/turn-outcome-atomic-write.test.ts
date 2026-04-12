import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveTurnOutcomeDir, saveTurnOutcome } from "../../../src/main/services/model-runtime/turn-outcome-store";

describe("turn outcome atomic write", () => {
  it("writes JSON outcomes atomically into the turn outcome directory", async () => {
    const myClawDir = mkdtempSync(join(tmpdir(), "myclaw-outcome-write-"));
    await saveTurnOutcome({ myClawDir } as any, { id: "turn-1", providerFamily: "generic-openai-compatible", protocolTarget: "openai-chat-compatible", modelProfileId: "profile-1", experienceProfileId: "balanced", promptPolicyId: "prompt", taskPolicyId: "task", toolPolicyId: "tool", contextPolicyId: "context", reliabilityPolicyId: "reliability", retryCount: 0, toolCompileMode: "relaxed", replayMode: "none", startedAt: "2026-04-10T00:00:00.000Z", finishedAt: "2026-04-10T00:00:01.000Z", success: true, latencyMs: 1000 } as any);
    expect(existsSync(join(resolveTurnOutcomeDir({ myClawDir } as any), "turn-1.json"))).toBe(true);
  });
});
