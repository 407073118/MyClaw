import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadPersistedState, saveWorkflowRun } from "../src/main/services/state-persistence";

function buildPaths(rootDir: string) {
  return {
    rootDir,
    myClawDir: rootDir,
    skillsDir: join(rootDir, "skills"),
    sessionsDir: join(rootDir, "sessions"),
    modelsDir: join(rootDir, "models"),
    settingsFile: join(rootDir, "settings.json"),
  };
}

describe("workflow run persistence", () => {
  let rootDir: string | null = null;

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  it("saves workflow runs and reloads them from disk", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "myclaw-workflow-run-"));
    const paths = buildPaths(rootDir);
    const workflowRun = {
      id: "run-persisted",
      workflowId: "workflow-1",
      workflowVersion: 2,
      status: "running",
      currentNodeIds: ["step-1"],
      startedAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:05:00.000Z",
    } as const;

    await saveWorkflowRun(paths as never, workflowRun);
    const persisted = loadPersistedState(paths as never);

    expect(persisted.workflowRuns).toEqual([workflowRun]);
  });
});
