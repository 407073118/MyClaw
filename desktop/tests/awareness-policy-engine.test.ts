import { describe, expect, it } from "vitest";

import type { AwarenessAction, AwarenessRoutine, StandingOrder } from "@shared/contracts";
import {
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
} from "@shared/contracts";
import { createAwarenessPolicyEngine } from "../src/main/services/awareness-policy-engine";

/** 构造策略测试用值守规则。 */
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

/** 构造策略测试动作。 */
function createAction(overrides: Partial<AwarenessAction> = {}): AwarenessAction {
  return {
    kind: "notify_user",
    description: "通知用户",
    riskLevel: "low",
    ...overrides,
  };
}

/** 构造策略测试用 Standing Order。 */
function createOrder(overrides: Partial<StandingOrder> = {}): StandingOrder {
  return {
    id: "order-1",
    scope: { kind: "personal" },
    name: "允许通知",
    intent: "允许低风险通知",
    allowedSignals: ["schedule_job"],
    allowedActions: ["notify_user"],
    approvalGate: "risk_based",
    escalationPolicy: {
      escalateAfterConsecutiveFailures: 3,
      criticalRoutinePausedMustNotify: true,
      escalationChannel: "chat_card",
    },
    status: "active",
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("awareness policy engine", () => {
  it("blocks actions listed in alwaysDeny before standing order checks", () => {
    const engine = createAwarenessPolicyEngine({ now: () => new Date("2026-05-16T10:00:00.000Z") });
    const decision = engine.evaluateAction(
      createAction({ kind: "trigger_workflow" }),
      createRoutine({ actionPolicy: { ...createDefaultActionPolicy(), alwaysDeny: ["trigger_workflow"] } }),
      [createOrder({ allowedActions: ["trigger_workflow"] })],
    );

    expect(decision.blocked).toBe(true);
    expect(decision.approvalStatus).toBe("rejected");
    expect(decision.reason).toContain("alwaysDeny");
  });

  it("auto-approves low-risk actions authorized by a risk-based standing order", () => {
    const engine = createAwarenessPolicyEngine({ now: () => new Date("2026-05-16T10:00:00.000Z") });
    const decision = engine.evaluateAction(
      createAction({ riskLevel: "low" }),
      createRoutine(),
      [createOrder()],
      "schedule_job",
    );

    expect(decision.blocked).toBe(false);
    expect(decision.approvalStatus).toBe("auto_approved");
    expect(decision.standingOrderId).toBe("order-1");
  });

  it("requires user approval for high-risk actions under risk-based standing order", () => {
    const engine = createAwarenessPolicyEngine({ now: () => new Date("2026-05-16T10:00:00.000Z") });
    const decision = engine.evaluateAction(
      createAction({ kind: "execute_schedule_job", riskLevel: "high" }),
      createRoutine(),
      [createOrder({ allowedActions: ["execute_schedule_job"] })],
      "schedule_job",
    );

    expect(decision.blocked).toBe(true);
    expect(decision.approvalStatus).toBe("pending");
  });

  it("rejects required actions when standing order is expired or signal source mismatches", () => {
    const engine = createAwarenessPolicyEngine({ now: () => new Date("2026-05-16T10:00:00.000Z") });
    const decision = engine.evaluateAction(
      createAction(),
      createRoutine(),
      [createOrder({ expiresAt: "2026-05-15T10:00:00.000Z" })],
      "schedule_job",
    );

    expect(decision.blocked).toBe(true);
    expect(decision.approvalStatus).toBe("rejected");
  });
});
