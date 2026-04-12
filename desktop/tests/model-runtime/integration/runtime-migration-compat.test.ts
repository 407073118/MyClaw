import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import { derivePaths } from "../../../src/main/services/directory-service";
import { loadPersistedState, saveSession, saveWorkflowRun } from "../../../src/main/services/state-persistence";

describe("runtime migration compatibility", () => {
  it("hydrates legacy sessions and workflow runs without new fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-persist-"));
    const paths = derivePaths(root);
    mkdirSync(paths.sessionsDir, { recursive: true });
    mkdirSync(join(paths.sessionsDir, "session-1"), { recursive: true });
    writeFileSync(join(paths.sessionsDir, "session-1", "session.json"), JSON.stringify({ id: "session-1", title: "Legacy", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z" }));
    writeFileSync(join(paths.sessionsDir, "session-1", "messages.json"), JSON.stringify([]));
    mkdirSync(join(paths.myClawDir, "workflow-runs"), { recursive: true });
    writeFileSync(join(paths.myClawDir, "workflow-runs", "run-1.json"), JSON.stringify({ id: "run-1", workflowId: "wf-1", workflowVersion: 1, status: "running", currentNodeIds: [], startedAt: "2026-04-10T00:00:00.000Z", updatedAt: "2026-04-10T00:00:01.000Z" }));

    const persisted = loadPersistedState(paths);
    expect(persisted.sessions[0]?.id).toBe("session-1");
    expect(persisted.workflowRuns[0]?.id).toBe("run-1");
  });

  it("round-trips new turn execution plan fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-persist-"));
    const paths = derivePaths(root);
    const session = { id: "session-2", title: "Modern", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z", messages: [], turnExecutionPlan: { providerFamily: "openai-native", protocolTarget: "openai-responses" } };
    await saveSession(paths, session as any);
    await saveWorkflowRun(paths, { id: "run-2", workflowId: "wf-1", workflowVersion: 1, status: "running", currentNodeIds: [], startedAt: "2026-04-10T00:00:00.000Z", updatedAt: "2026-04-10T00:00:01.000Z", lastTurnOutcomeId: "turn-1" } as any);

    const persisted = loadPersistedState(paths);
    expect((persisted.sessions[0] as any).turnExecutionPlan.providerFamily).toBe("openai-native");
    expect((persisted.workflowRuns[0] as any).lastTurnOutcomeId).toBe("turn-1");
  });
});
