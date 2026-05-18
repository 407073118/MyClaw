import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { TimeOrchestrationDatabase } from "../src/main/services/time-orchestration-database";
import { createAwarenessStore } from "../src/main/services/awareness-store";
import { createAwarenessRuntime } from "../src/main/services/awareness-runtime";
import { createAwarenessDecisionEngine } from "../src/main/services/awareness-decision-engine";
import { createStandingOrderService } from "../src/main/services/standing-order-service";
import { createLongRunLedger } from "../src/main/services/long-run-ledger";
import type { RawSignal } from "../src/main/services/awareness-signal-collector";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

/** 创建端到端值守运行时夹具。 */
async function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-awareness-e2e-"));
  tempDirs.push(dir);
  const db = await TimeOrchestrationDatabase.create(join(dir, "time.db"));
  const now = () => new Date("2026-05-16T10:00:00.000Z");
  const store = createAwarenessStore({ db, getAvailabilityPolicy: async () => null, now });
  const ledger = createLongRunLedger(db);
  const standingOrderService = createStandingOrderService(db);
  const broadcasts: Array<{ type: string; payload: unknown }> = [];
  const rawSignals: RawSignal[] = [
    {
      sourceKind: "schedule_job",
      sourceId: "job-1",
      scope: { kind: "personal" },
      severity: "warning",
      summary: "定时任务失败",
      recommendedAction: "检查任务配置",
      fingerprint: "job:failed:job-1",
    },
  ];
  const decisionEngine = createAwarenessDecisionEngine({
    callModel: async () => JSON.stringify({
      notify: true,
      actions: [{ kind: "log_only", description: "记录失败任务", riskLevel: "low" }],
      requiresApproval: false,
      reason: "发现失败任务，需要进入今日补看",
      confidence: 0.9,
    }),
    getModelCallsToday: () => 0,
    incrementModelCalls: () => undefined,
    getGlobalModelCallsToday: () => 0,
    incrementGlobalModelCalls: () => undefined,
  });
  const runtime = createAwarenessRuntime({
    store,
    signalCollector: { collect: () => rawSignals },
    decisionEngine,
    standingOrderService,
    ledger,
    getAvailabilityPolicy: async () => ({
      timezone: "Asia/Shanghai",
      workingHours: [],
      quietHours: { enabled: false, start: "22:00", end: "08:00" },
      notificationWindows: [],
      focusBlocks: [],
    }),
    broadcastEvent: (type, payload) => broadcasts.push({ type, payload }),
    now,
  });
  return { db, store, ledger, runtime, broadcasts };
}

describe("awareness end-to-end flow", () => {
  it("collects a signal, decides, writes ledger, delivers, and advances the routine", async () => {
    const { db, store, ledger, runtime, broadcasts } = await createHarness();
    try {
      const routine = await store.createRoutine({
        name: "个人值守",
        scope: { kind: "personal" },
        purpose: "守护定时任务",
        cadenceMinutes: 30,
        deliveryPolicy: { notifyOnDecision: true, deliveryChannel: "today_catchup" },
      });

      await runtime.runRoutineNow(routine.id);

      const signals = await store.listSignals("active");
      const records = await ledger.listRecords({ kind: "awareness_routine" });
      const updatedRoutine = await store.getRoutine(routine.id);

      expect(signals).toHaveLength(1);
      expect(signals[0]?.summary).toBe("定时任务失败");
      expect(records[0]?.sourceTitle).toBe("个人值守");
      expect(records[0]?.deliveryStatus).toBe("pending");
      expect(updatedRoutine?.lastReceipt?.signalsNew).toBe(1);
      expect(updatedRoutine?.nextRunAt).toBe("2026-05-16T10:30:00.000Z");
      expect(broadcasts.some((event) => event.type === "awareness.delivery")).toBe(true);
      expect(broadcasts.some((event) => event.type === "awareness.changed")).toBe(true);
    } finally {
      db.close();
    }
  });
});
