import { describe, expect, it, vi } from "vitest";

import type { AwarenessSignal } from "@shared/contracts";
import {
  createDefaultBudgetPolicy,
  createDefaultDecisionPolicy,
} from "@shared/contracts";
import { createAwarenessDecisionEngine } from "../src/main/services/awareness-decision-engine";

/** 构造决策测试信号，避免每个用例重复协议字段。 */
function createSignal(overrides: Partial<AwarenessSignal> = {}): AwarenessSignal {
  return {
    id: "signal-1",
    fingerprint: "job:failed:job-1",
    sourceKind: "schedule_job",
    sourceId: "job-1",
    scope: { kind: "personal" },
    severity: "warning",
    summary: "定时任务失败",
    status: "active",
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("awareness decision engine", () => {
  it("uses the model when policy needs semantic action suggestions and budget allows it", async () => {
    const callModel = vi.fn(async () => JSON.stringify({
      notify: true,
      actions: [{ kind: "notify_user", description: "通知用户", riskLevel: "low" }],
      requiresApproval: false,
      reason: "模型判断需要通知",
      confidence: 0.8,
    }));
    const incrementModelCalls = vi.fn();
    const engine = createAwarenessDecisionEngine({
      callModel,
      getModelCallsToday: () => 0,
      getGlobalModelCallsToday: () => 0,
      incrementModelCalls,
      incrementGlobalModelCalls: vi.fn(),
    });

    const decision = await engine.decide(
      [createSignal()],
      createDefaultDecisionPolicy(),
      "routine-1",
      "守护定时任务",
      createDefaultBudgetPolicy(),
    );

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(incrementModelCalls).toHaveBeenCalledWith("routine-1");
    expect(decision.modelUsed).toBe(true);
    expect(decision.reason).toBe("模型判断需要通知");
  });

  it("falls back to rule decision when routine daily budget is exhausted", async () => {
    const callModel = vi.fn();
    const engine = createAwarenessDecisionEngine({
      callModel,
      getModelCallsToday: () => 10,
      getGlobalModelCallsToday: () => 0,
      incrementModelCalls: vi.fn(),
      incrementGlobalModelCalls: vi.fn(),
    });

    const decision = await engine.decide(
      [createSignal()],
      createDefaultDecisionPolicy(),
      "routine-1",
      "守护定时任务",
      { ...createDefaultBudgetPolicy(), maxModelCallsPerRoutinePerDay: 10 },
    );

    expect(callModel).not.toHaveBeenCalled();
    expect(decision.modelUsed).toBe(false);
    expect(decision.skipReason).toBe("budget_exceeded");
  });

  it("falls back to rules when the model returns invalid JSON", async () => {
    const engine = createAwarenessDecisionEngine({
      callModel: vi.fn(async () => "not json"),
      getModelCallsToday: () => 0,
      getGlobalModelCallsToday: () => 0,
      incrementModelCalls: vi.fn(),
      incrementGlobalModelCalls: vi.fn(),
    });

    const decision = await engine.decide(
      [createSignal({ severity: "critical" }), createSignal({ id: "signal-2", fingerprint: "task:stuck:task-1", sourceKind: "agent_task" })],
      createDefaultDecisionPolicy(),
      "routine-1",
      "守护定时任务",
      createDefaultBudgetPolicy(),
    );

    expect(decision.modelUsed).toBe(false);
    expect(decision.actions[0]?.kind).toBe("notify_user");
    expect(decision.reason).toContain("规则决策");
  });

  it("does not use model for info-only single-source signals", async () => {
    const callModel = vi.fn();
    const engine = createAwarenessDecisionEngine({
      callModel,
      getModelCallsToday: () => 0,
      getGlobalModelCallsToday: () => 0,
      incrementModelCalls: vi.fn(),
      incrementGlobalModelCalls: vi.fn(),
    });

    const decision = await engine.decide(
      [createSignal({ severity: "info" })],
      createDefaultDecisionPolicy(),
      "routine-1",
      "守护定时任务",
      createDefaultBudgetPolicy(),
    );

    expect(callModel).not.toHaveBeenCalled();
    expect(decision.modelUsed).toBe(false);
  });
});
