import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { derivePaths } from "../../../src/main/services/directory-service";
import { saveSession, saveWorkflowRun, loadPersistedState } from "../../../src/main/services/state-persistence";
import { saveTurnOutcome, readTurnOutcome } from "../../../src/main/services/model-runtime/turn-outcome-store";

describe("session/workflow outcome roundtrip", () => {
  it("persists shared outcome references for sessions and workflows", async () => {
    const paths = derivePaths(mkdtempSync(join(tmpdir(), "myclaw-roundtrip-")));
    await saveTurnOutcome(paths as any, { id: "turn-1", providerFamily: "generic-openai-compatible", vendorFamily: "generic-openai-compatible", protocolTarget: "openai-chat-compatible", modelProfileId: "profile-1", experienceProfileId: "balanced", promptPolicyId: "prompt", taskPolicyId: "task", toolPolicyId: "tool", contextPolicyId: "context", reliabilityPolicyId: "reliability", retryCount: 0, toolCompileMode: "relaxed", replayMode: "none", startedAt: "2026-04-10T00:00:00.000Z", finishedAt: "2026-04-10T00:00:01.000Z", success: true, latencyMs: 1000, responseId: "resp_123" } as any);
    await saveSession(paths, { id: "session-1", title: "Session", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z", messages: [], lastTurnOutcomeId: "turn-1" } as any);
    await saveWorkflowRun(paths, { id: "run-1", workflowId: "wf-1", workflowVersion: 1, status: "running", currentNodeIds: [], startedAt: "2026-04-10T00:00:00.000Z", updatedAt: "2026-04-10T00:00:01.000Z", lastTurnOutcomeId: "turn-1" } as any);

    const persisted = loadPersistedState(paths);
    expect((persisted.sessions[0] as any).lastTurnOutcomeId).toBe("turn-1");
    expect((persisted.workflowRuns[0] as any).lastTurnOutcomeId).toBe("turn-1");
    expect(await readTurnOutcome(paths as any, "turn-1")).toMatchObject({ id: "turn-1", responseId: "resp_123" });
  });
});
