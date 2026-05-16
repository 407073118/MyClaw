import { describe, expect, it, vi } from "vitest";

import type { AwarenessAction, AwarenessRoutine, AwarenessSignal } from "@shared/contracts";
import {
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
} from "@shared/contracts";
import { createAwarenessActionExecutor } from "../src/main/services/awareness-action-executor";

/** 构造动作执行测试用值守规则。 */
function createRoutine(): AwarenessRoutine {
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
  };
}

/** 构造动作执行测试信号。 */
function createSignal(): AwarenessSignal {
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
  };
}

/** 构造动作执行测试上下文。 */
function createContext(overrides = {}) {
  return {
    routine: createRoutine(),
    signals: [createSignal()],
    policyDecision: { blocked: false, approvalStatus: "auto_approved" as const, reason: "测试授权" },
    ledgerRecordId: "ledger-1",
    ...overrides,
  };
}

describe("awareness action executor", () => {
  it("does not execute actions blocked by policy", async () => {
    const notifyUser = vi.fn();
    const executor = createAwarenessActionExecutor({ notifyUser });

    const result = await executor.execute(
      { kind: "notify_user", description: "通知用户", riskLevel: "low" },
      createContext({ policyDecision: { blocked: true, approvalStatus: "pending" as const, reason: "需要审批" } }),
    );

    expect(result.status).toBe("pending");
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("dismisses all related signals for dismiss_signal actions", async () => {
    const updateSignalStatus = vi.fn();
    const executor = createAwarenessActionExecutor({
      updateSignalStatus,
      now: () => new Date("2026-05-16T10:00:00.000Z"),
    });

    const result = await executor.execute(
      { kind: "dismiss_signal", description: "忽略重复失败", riskLevel: "low" },
      createContext(),
    );

    expect(result.status).toBe("executed");
    expect(updateSignalStatus).toHaveBeenCalledWith("signal-1", "dismissed", expect.objectContaining({
      dismissedAt: "2026-05-16T10:00:00.000Z",
    }));
  });

  it("dispatches schedule-job execution through the provided executor", async () => {
    const executeScheduleJob = vi.fn(async () => undefined);
    const executor = createAwarenessActionExecutor({ executeScheduleJob });
    const action: AwarenessAction = {
      kind: "execute_schedule_job",
      description: "重跑失败任务",
      riskLevel: "medium",
      payload: { jobId: "job-1" },
    };

    const result = await executor.execute(action, createContext());

    expect(result.status).toBe("executed");
    expect(executeScheduleJob).toHaveBeenCalledWith("job-1");
  });

  it("returns blocked when an approved action has no available executor", async () => {
    const executor = createAwarenessActionExecutor();

    const result = await executor.execute(
      { kind: "trigger_workflow", description: "触发流程", riskLevel: "medium", payload: { workflowId: "wf-1" } },
      createContext(),
    );

    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("缺少执行器");
  });
});
