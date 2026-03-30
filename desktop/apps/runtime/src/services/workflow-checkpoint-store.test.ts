import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkflowCheckpointStore } from "./workflow-checkpoint-store";

describe("workflow checkpoint store", () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-workflow-checkpoints-"));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates runs and stores checkpoints deterministically", () => {
    const store = new WorkflowCheckpointStore({
      now: () => "2026-03-24T00:00:00.000Z",
      storageDir: tempDir,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const run = store.createRun({
      definitionId: "graph-demo",
      initialState: { value: 1 },
    });

    const checkpoint1 = store.createCheckpoint(run.id, {
      nodeId: "node-start",
      status: "node-complete",
      state: { value: 1 },
      attempts: {},
    });
    const checkpoint2 = store.createCheckpoint(run.id, {
      nodeId: "node-end",
      status: "node-complete",
      state: { value: 2 },
      attempts: {},
    });

    expect(run.id).toBeTruthy();
    expect(checkpoint1.id).not.toBe(checkpoint2.id);
    expect(store.listCheckpoints(run.id)).toHaveLength(2);
    expect(store.getLatestCheckpoint(run.id)?.nodeId).toBe("node-end");
  });

  it("persists run and checkpoints to disk when storageDir is provided", async () => {
    const store = new WorkflowCheckpointStore({
      now: () => "2026-03-24T00:00:00.000Z",
      storageDir: tempDir,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const run = store.createRun({
      definitionId: "graph-demo",
      initialState: { value: 1 },
    });

    const checkpoint = store.createCheckpoint(run.id, {
      nodeId: "node-start",
      status: "node-complete",
      state: { value: 1 },
      attempts: {},
    });

    const runJsonPath = join(tempDir!, run.id, "run.json");
    const checkpointJsonPath = join(tempDir!, run.id, "checkpoints", `${checkpoint.id}.json`);

    const persistedRun = JSON.parse(await readFile(runJsonPath, "utf8")) as { id: string; definitionId: string };
    const persistedCheckpoint = JSON.parse(await readFile(checkpointJsonPath, "utf8")) as {
      id: string;
      runId: string;
      nodeId: string;
      status: string;
    };

    expect(persistedRun.id).toBe(run.id);
    expect(persistedRun.definitionId).toBe("graph-demo");
    expect(persistedCheckpoint.id).toBe(checkpoint.id);
    expect(persistedCheckpoint.runId).toBe(run.id);
    expect(persistedCheckpoint.nodeId).toBe("node-start");
    expect(persistedCheckpoint.status).toBe("node-complete");
  });
});
