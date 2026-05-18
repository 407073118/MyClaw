import { describe, expect, it, vi } from "vitest";

import type {
  AwarenessRoutine,
  AwarenessSignal,
  AwarenessTickReceipt,
  AvailabilityPolicy,
  LongRunRecord,
  RawSignal,
} from "@shared/contracts";
import {
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultCatchUpPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
  createDefaultQuietHoursPolicy,
} from "@shared/contracts";
import { createAwarenessRuntime } from "../src/main/services/awareness-runtime";

/** 构造测试用值守规则，确保调度语义测试只关注运行时行为。 */
function createRoutine(overrides: Partial<AwarenessRoutine> = {}): AwarenessRoutine {
  const now = "2026-05-16T10:00:00.000Z";
  return {
    id: "routine-1",
    name: "个人值守",
    scope: { kind: "personal" },
    purpose: "检查日程和后台任务",
    cadenceMinutes: 30,
    activeHours: [{ weekday: 6, start: "00:00", end: "23:59" }],
    signalSources: ["schedule_job", "agent_task"],
    decisionPolicy: createDefaultDecisionPolicy(),
    actionPolicy: createDefaultActionPolicy(),
    deliveryPolicy: createDefaultDeliveryPolicy(),
    budgetPolicy: createDefaultBudgetPolicy(),
    quietHoursPolicy: createDefaultQuietHoursPolicy(),
    catchUpPolicy: createDefaultCatchUpPolicy(),
    standingOrderIds: [],
    status: "enabled",
    consecutiveFailures: 0,
    nextRunAt: "2026-05-16T09:30:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 构造运行时测试夹具，集中记录调度副作用。 */
function createRuntimeHarness(options: {
  nowIso?: string;
  routines?: AwarenessRoutine[];
  rawSignals?: RawSignal[];
  collectorThrows?: boolean;
}) {
  const nowIso = options.nowIso ?? "2026-05-16T10:00:00.000Z";
  const routines = [...(options.routines ?? [createRoutine()])];
  const storedSignals: AwarenessSignal[] = [];
  const receipts: AwarenessTickReceipt[] = [];
  const updatedRoutines: AwarenessRoutine[] = [];
  const modelDecide = vi.fn(async () => ({
    routineId: "routine-1",
    notify: false,
    actions: [],
    requiresApproval: false,
    reason: "测试决策",
    confidence: 1,
    modelUsed: false,
  }));

  const runtime = createAwarenessRuntime({
    store: {
      listDueRoutines: async () => routines,
      cleanupStaleSignals: async () => 0,
      findSignalByFingerprint: async (fingerprint: string) =>
        storedSignals.find((signal) => signal.fingerprint === fingerprint) ?? null,
      upsertSignal: async (signal: AwarenessSignal) => {
        storedSignals.push(signal);
      },
      updateRoutineAfterTick: async (id: string, succeeded: boolean, receipt: AwarenessTickReceipt, patch = {}) => {
        const routine = routines.find((item) => item.id === id);
        if (!routine) return null;
        const updated = {
          ...routine,
          ...patch,
          consecutiveFailures: succeeded ? 0 : routine.consecutiveFailures + 1,
          status: !succeeded && routine.consecutiveFailures + 1 >= 3 ? "failed" as const : routine.status,
          lastRunAt: nowIso,
          nextRunAt: new Date(new Date(nowIso).getTime() + routine.cadenceMinutes * 60_000).toISOString(),
          lastReceipt: receipt,
          updatedAt: nowIso,
        };
        receipts.push(receipt);
        updatedRoutines.push(updated);
        return updated;
      },
      getRoutine: async (id: string) => routines.find((routine) => routine.id === id) ?? null,
      listRoutines: async () => routines,
      listSignals: async () => storedSignals,
    } as never,
    signalCollector: {
      collect: () => {
        if (options.collectorThrows) throw new Error("collector failed");
        return options.rawSignals ?? [];
      },
    },
    decisionEngine: { decide: modelDecide } as never,
    standingOrderService: { list: async () => [] } as never,
    ledger: {
      createRecord: () => ({
        id: "ledger-1",
        kind: "awareness_routine",
        sourceId: "routine-1",
        scope: { kind: "personal" },
        status: "running",
        startedAt: nowIso,
        deliveryStatus: "not_required",
        createdAt: nowIso,
        updatedAt: nowIso,
      } satisfies LongRunRecord),
      upsertRecord: async () => undefined,
      finishRecord: async () => undefined,
      writeAuditEvent: async () => undefined,
      listRecords: async () => [],
    } as never,
    getAvailabilityPolicy: async () => ({
      timezone: "Asia/Shanghai",
      workingHours: [],
      quietHours: { enabled: false, start: "22:00", end: "08:00" },
      notificationWindows: [],
      focusBlocks: [],
    } satisfies AvailabilityPolicy),
    broadcastEvent: vi.fn(),
    now: () => new Date(nowIso),
  });

  return { runtime, modelDecide, receipts, updatedRoutines };
}

describe("awareness runtime scheduler", () => {
  it("skips routines outside active hours without collecting signals or calling model", async () => {
    const harness = createRuntimeHarness({
      nowIso: "2026-05-16T20:00:00.000Z",
      routines: [createRoutine({ activeHours: [{ weekday: 6, start: "09:00", end: "18:00" }] })],
      rawSignals: [
        {
          sourceKind: "schedule_job",
          sourceId: "job-1",
          scope: { kind: "personal" },
          severity: "critical",
          summary: "任务失败",
          fingerprint: "job:failed:job-1",
        },
      ],
    });

    await harness.runtime.tick();

    expect(harness.modelDecide).not.toHaveBeenCalled();
    expect(harness.updatedRoutines[0]?.lastSkippedReason).toBe("outside_active_hours");
    expect(harness.receipts[0]?.signalsCollected).toBe(0);
    expect(harness.receipts[0]?.modelCalled).toBe(false);
  });

  it("does not call the decision engine when no signal is collected", async () => {
    const harness = createRuntimeHarness({ rawSignals: [] });

    await harness.runtime.tick();

    expect(harness.modelDecide).not.toHaveBeenCalled();
    expect(harness.updatedRoutines[0]?.lastSkippedReason).toBe("no_signal");
  });

  it("runs a missed routine once and advances nextRunAt from the current tick time", async () => {
    const harness = createRuntimeHarness({
      nowIso: "2026-05-16T12:00:00.000Z",
      routines: [createRoutine({ nextRunAt: "2026-05-15T08:00:00.000Z" })],
      rawSignals: [],
    });

    await harness.runtime.tick();

    expect(harness.updatedRoutines).toHaveLength(1);
    expect(harness.updatedRoutines[0]?.nextRunAt).toBe("2026-05-16T12:30:00.000Z");
  });

  it("marks a routine failed after three consecutive scheduler failures", async () => {
    const harness = createRuntimeHarness({
      routines: [createRoutine({ consecutiveFailures: 2 })],
      collectorThrows: true,
    });

    await harness.runtime.tick();

    expect(harness.updatedRoutines[0]?.status).toBe("failed");
  });

  it("manual run ignores nextRunAt but still respects active-hour policy", async () => {
    const harness = createRuntimeHarness({
      nowIso: "2026-05-16T20:00:00.000Z",
      routines: [
        createRoutine({
          nextRunAt: "2026-05-17T09:00:00.000Z",
          activeHours: [{ weekday: 6, start: "09:00", end: "18:00" }],
        }),
      ],
    });

    await harness.runtime.runRoutineNow("routine-1");

    expect(harness.updatedRoutines[0]?.lastSkippedReason).toBe("outside_active_hours");
  });
});
