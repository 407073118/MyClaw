import { describe, expect, it, vi } from "vitest";

import type { AwarenessDecision, AwarenessRoutine, AwarenessSignal, LongRunRecord } from "@shared/contracts";
import {
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
} from "@shared/contracts";
import { createAwarenessDeliveryService } from "../src/main/services/awareness-delivery-service";

/** 构造投递测试用值守规则。 */
function createRoutine(overrides: Partial<AwarenessRoutine> = {}): AwarenessRoutine {
  return {
    id: "routine-1",
    name: "个人值守",
    scope: { kind: "personal" },
    purpose: "守护后台任务",
    cadenceMinutes: 30,
    signalSources: ["schedule_job"],
    decisionPolicy: createDefaultDecisionPolicy(),
    actionPolicy: createDefaultActionPolicy(),
    deliveryPolicy: createDefaultDeliveryPolicy(),
    budgetPolicy: createDefaultBudgetPolicy(),
    standingOrderIds: [],
    status: "enabled",
    consecutiveFailures: 0,
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
    ...overrides,
  };
}

/** 构造投递测试用信号。 */
function createSignal(severity: AwarenessSignal["severity"] = "warning"): AwarenessSignal {
  return {
    id: "signal-1",
    fingerprint: "job:failed:job-1",
    sourceKind: "schedule_job",
    sourceId: "job-1",
    scope: { kind: "personal" },
    severity,
    summary: "定时任务失败",
    status: "active",
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
  };
}

/** 构造投递测试用决策。 */
function createDecision(overrides: Partial<AwarenessDecision> = {}): AwarenessDecision {
  return {
    routineId: "routine-1",
    notify: true,
    actions: [],
    requiresApproval: false,
    reason: "需要用户关注",
    confidence: 1,
    modelUsed: false,
    ...overrides,
  };
}

describe("awareness delivery service", () => {
  it("delivers decision cards to today catch-up and broadcasts an event", async () => {
    const broadcastEvent = vi.fn();
    const appendTodayCatchup = vi.fn(async () => undefined);
    const service = createAwarenessDeliveryService({
      broadcastEvent,
      appendTodayCatchup,
      now: () => new Date("2026-05-16T10:00:00.000Z"),
    });

    const result = await service.deliverDecision({
      routine: createRoutine(),
      signals: [createSignal()],
      decision: createDecision(),
    });

    expect(result.deliveries[0]?.target).toBe("today_catchup");
    expect(appendTodayCatchup).toHaveBeenCalledTimes(1);
    expect(broadcastEvent).toHaveBeenCalledWith("awareness.delivery", expect.objectContaining({
      routineId: "routine-1",
      target: "today_catchup",
    }));
  });

  it("suppresses non-critical delivery in quiet hours when policy requires it", async () => {
    const broadcastEvent = vi.fn();
    const service = createAwarenessDeliveryService({
      broadcastEvent,
      now: () => new Date("2026-05-16T23:00:00.000Z"),
    });

    const result = await service.deliverDecision({
      routine: createRoutine(),
      signals: [createSignal("warning")],
      decision: createDecision(),
      quietHours: true,
    });

    expect(result.deliveries[0]?.target).toBe("silent");
    expect(result.deliveries[0]?.status).toBe("suppressed");
    expect(broadcastEvent).not.toHaveBeenCalled();
  });

  it("allows critical delivery to override quiet hours", async () => {
    const broadcastEvent = vi.fn();
    const service = createAwarenessDeliveryService({ broadcastEvent });

    const result = await service.deliverDecision({
      routine: createRoutine(),
      signals: [createSignal("critical")],
      decision: createDecision(),
      quietHours: true,
    });

    expect(result.deliveries[0]?.status).toBe("delivered");
    expect(broadcastEvent).toHaveBeenCalled();
  });

  it("delivers ledger state changes to dock badge without a model decision", async () => {
    const setDockBadge = vi.fn(async () => undefined);
    const service = createAwarenessDeliveryService({ setDockBadge });
    const ledgerRecord: LongRunRecord = {
      id: "ledger-1",
      kind: "awareness_routine",
      sourceId: "routine-1",
      scope: { kind: "personal" },
      status: "waiting_user",
      startedAt: "2026-05-16T10:00:00.000Z",
      deliveryStatus: "pending",
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
    };

    const result = await service.deliverLedgerRecord(ledgerRecord, "dock_badge");

    expect(result.target).toBe("dock_badge");
    expect(setDockBadge).toHaveBeenCalledWith("1");
  });
});
