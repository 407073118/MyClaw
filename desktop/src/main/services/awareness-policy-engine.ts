import type {
  ApprovalGate,
  AwarenessAction,
  AwarenessActionKind,
  AwarenessAuditEvent,
  AwarenessRoutine,
  AwarenessSignalSourceKind,
  StandingOrder,
} from "@shared/contracts";

export type AwarenessPolicyDecision = {
  blocked: boolean;
  approvalStatus: AwarenessAuditEvent["approvalStatus"];
  standingOrderId?: string;
  reason: string;
};

export type AwarenessPolicyEngineDeps = {
  now?: () => Date;
};

export function createAwarenessPolicyEngine(deps: AwarenessPolicyEngineDeps = {}) {
  const now = deps.now ?? (() => new Date());

  /** 评估单个值守动作是否可执行、待审批或必须拒绝。 */
  function evaluateAction(
    action: AwarenessAction,
    routine: AwarenessRoutine,
    orders: StandingOrder[],
    signalSource?: AwarenessSignalSourceKind,
  ): AwarenessPolicyDecision {
    if (routine.actionPolicy.alwaysDeny.includes(action.kind)) {
      console.info("[awareness-policy] 动作命中 alwaysDeny，直接拒绝", {
        routineId: routine.id,
        action: action.kind,
      });
      return { blocked: true, approvalStatus: "rejected", reason: "action in alwaysDeny list" };
    }

    if (routine.actionPolicy.autoAllow.includes(action.kind)) {
      console.info("[awareness-policy] 动作命中 autoAllow，自动通过", {
        routineId: routine.id,
        action: action.kind,
      });
      return { blocked: false, approvalStatus: "auto_approved", reason: "action in autoAllow list" };
    }

    if (!routine.actionPolicy.requireApproval.includes(action.kind)) {
      return { blocked: false, approvalStatus: "not_required", reason: "no policy restriction" };
    }

    const order = findAuthorizingOrder(orders, action.kind, signalSource);
    if (!order) {
      console.info("[awareness-policy] 缺少可用 Standing Order，拒绝需审批动作", {
        routineId: routine.id,
        action: action.kind,
        signalSource,
      });
      return { blocked: true, approvalStatus: "rejected", reason: "no standing order authorizes this action" };
    }

    return evaluateGate(action, order);
  }

  /** 找到同时满足动作、信号来源、状态和过期时间约束的 Standing Order。 */
  function findAuthorizingOrder(
    orders: StandingOrder[],
    actionKind: AwarenessActionKind,
    signalSource?: AwarenessSignalSourceKind,
  ): StandingOrder | null {
    for (const order of orders) {
      if (order.status !== "active") continue;
      if (order.expiresAt && new Date(order.expiresAt) < now()) continue;
      if (!order.allowedActions.includes(actionKind)) continue;
      if (signalSource && order.allowedSignals.length > 0 && !order.allowedSignals.includes(signalSource)) continue;
      return order;
    }
    return null;
  }

  /** 根据 Standing Order 的审批门槛和动作风险返回最终策略结果。 */
  function evaluateGate(action: AwarenessAction, order: StandingOrder): AwarenessPolicyDecision {
    const pending = (reason: string): AwarenessPolicyDecision => ({
      blocked: true,
      approvalStatus: "pending",
      standingOrderId: order.id,
      reason,
    });
    const approved = (reason: string): AwarenessPolicyDecision => ({
      blocked: false,
      approvalStatus: "auto_approved",
      standingOrderId: order.id,
      reason,
    });

    const gate: ApprovalGate = order.approvalGate;
    if (gate === "always") return pending("standing order requires approval");
    if (gate === "risk_based" && action.riskLevel === "high") return pending("high risk action requires approval");
    if (gate === "never_for_low_risk" && action.riskLevel !== "low") return pending("medium or high risk action requires approval");
    return approved("authorized by standing order");
  }

  return { evaluateAction, findAuthorizingOrder };
}

export type AwarenessPolicyEngine = ReturnType<typeof createAwarenessPolicyEngine>;
