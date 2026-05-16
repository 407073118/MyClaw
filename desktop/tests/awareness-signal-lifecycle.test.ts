import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { AwarenessSignal } from "@shared/contracts";
import { TimeOrchestrationDatabase } from "../src/main/services/time-orchestration-database";
import { createAwarenessStore } from "../src/main/services/awareness-store";
import { createSignalFromRaw } from "../src/main/services/awareness-signal-collector";
import { reconcileAwarenessSignals } from "../src/main/services/awareness-reconciliation";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

async function createStore(nowIso = "2026-05-16T10:00:00.000Z") {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-awareness-lifecycle-"));
  tempDirs.push(dir);
  const db = await TimeOrchestrationDatabase.create(join(dir, "time.db"));
  const store = createAwarenessStore({
    db,
    getAvailabilityPolicy: async () => null,
    now: () => new Date(nowIso),
  });
  return { db, store };
}

function rawScheduleFailure(jobId: string) {
  return createSignalFromRaw({
    sourceKind: "schedule_job",
    sourceId: jobId,
    scope: { kind: "personal" },
    severity: "warning",
    summary: `定时任务失败: ${jobId}`,
    recommendedAction: "检查任务配置或手动重试",
    fingerprint: `job:failed:${jobId}`,
  });
}

describe("awareness signal lifecycle", () => {
  it("updates occurrence count and lastSeenAt for repeated fingerprints", async () => {
    const { db, store } = await createStore("2026-05-16T10:00:00.000Z");
    try {
      await store.upsertSignal(rawScheduleFailure("job-1"));
      const repeated = {
        ...rawScheduleFailure("job-1"),
        id: "different-id",
        lastSeenAt: "2026-05-16T10:05:00.000Z",
        updatedAt: "2026-05-16T10:05:00.000Z",
      } satisfies AwarenessSignal;

      await store.upsertSignal(repeated);

      const signals = await store.listSignals();
      expect(signals).toHaveLength(1);
      expect(signals[0]?.occurrenceCount).toBe(2);
      expect(signals[0]?.lastSeenAt).toBe("2026-05-16T10:05:00.000Z");
    } finally {
      db.close();
    }
  });

  it("keeps dismissed signals suppressed until cooldown expires", async () => {
    const { db, store } = await createStore("2026-05-16T10:00:00.000Z");
    try {
      const signal = rawScheduleFailure("job-2");
      await store.upsertSignal(signal);
      await store.updateSignalStatus(signal.id, "dismissed", {
        dismissedAt: "2026-05-16T10:00:00.000Z",
        cooldownUntil: "2026-05-16T12:00:00.000Z",
      });

      await store.upsertSignal({ ...rawScheduleFailure("job-2"), id: "new-id" });

      const stored = await store.findSignalByFingerprint("job:failed:job-2");
      expect(stored?.status).toBe("dismissed");
      expect(stored?.occurrenceCount).toBe(1);
    } finally {
      db.close();
    }
  });

  it("automatically resolves failed schedule-job signals after a later successful execution", async () => {
    const { db, store } = await createStore("2026-05-16T10:00:00.000Z");
    try {
      await store.upsertSignal(rawScheduleFailure("job-3"));

      const resolved = await reconcileAwarenessSignals({
        store,
        scheduleJobs: [{ id: "job-3", status: "scheduled" }],
        latestExecutionRunsByScheduleJobId: new Map([
          ["job-3", { id: "run-ok", jobId: "job-3", status: "succeeded", startedAt: "2026-05-16T09:30:00.000Z" }],
        ]),
        now: new Date("2026-05-16T10:00:00.000Z"),
      });

      const stored = await store.findSignalByFingerprint("job:failed:job-3");
      expect(resolved).toBe(1);
      expect(stored?.status).toBe("resolved");
      expect(stored?.resolvedBySourceState).toBe(true);
      expect(stored?.resolvedAt).toBe("2026-05-16T10:00:00.000Z");
    } finally {
      db.close();
    }
  });
});
