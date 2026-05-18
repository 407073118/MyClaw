import type {
  AwarenessDecision,
  AwarenessRoutine,
  AwarenessSignal,
  LongRunRecord,
} from "@shared/contracts";

export type AwarenessDeliveryTarget =
  | "today_catchup"
  | "dock_badge"
  | "chat_card"
  | "system_notification"
  | "silent";

export type AwarenessDelivery = {
  id: string;
  routineId?: string;
  ledgerRecordId?: string;
  target: AwarenessDeliveryTarget;
  status: "delivered" | "suppressed" | "failed";
  title: string;
  body: string;
  createdAt: string;
};

export type AwarenessDecisionDeliveryInput = {
  routine: AwarenessRoutine;
  signals: AwarenessSignal[];
  decision: AwarenessDecision;
  ledgerRecord?: LongRunRecord;
  quietHours?: boolean;
};

export type AwarenessDeliveryServiceDeps = {
  broadcastEvent?: (type: string, payload: unknown) => void;
  appendTodayCatchup?: (delivery: AwarenessDelivery) => Promise<void>;
  createChatCard?: (delivery: AwarenessDelivery) => Promise<void>;
  setDockBadge?: (value: string) => Promise<void>;
  showSystemNotification?: (delivery: AwarenessDelivery) => Promise<void>;
  now?: () => Date;
};

export function createAwarenessDeliveryService(deps: AwarenessDeliveryServiceDeps = {}) {
  const now = deps.now ?? (() => new Date());

  /** 投递一次值守决策，按 routine 的投递策略决定目标和静默时段行为。 */
  async function deliverDecision(input: AwarenessDecisionDeliveryInput): Promise<{ deliveries: AwarenessDelivery[] }> {
    if (!input.decision.notify && !input.routine.deliveryPolicy.notifyOnDecision) {
      console.info("[awareness-delivery] 决策无需投递", { routineId: input.routine.id });
      return { deliveries: [] };
    }

    const target = input.routine.deliveryPolicy.deliveryChannel;
    if (shouldSuppressForQuietHours(input)) {
      return {
        deliveries: [
          createDelivery(input, "silent", "suppressed"),
        ],
      };
    }

    const delivery = createDelivery(input, target, "delivered");
    await deliverToTarget(delivery);
    emitDelivery(delivery);
    return { deliveries: [delivery] };
  }

  /** 投递台账状态变化，供后台任务等待用户或完成时刷新入口徽标。 */
  async function deliverLedgerRecord(
    record: LongRunRecord,
    target: AwarenessDeliveryTarget = record.deliveryTarget ?? "dock_badge",
  ): Promise<AwarenessDelivery> {
    const delivery: AwarenessDelivery = {
      id: `${record.id}:${target}:${now().getTime()}`,
      ledgerRecordId: record.id,
      routineId: record.kind === "awareness_routine" ? record.sourceId : undefined,
      target,
      status: "delivered",
      title: record.sourceTitle ?? "值守任务状态更新",
      body: record.resultSummary ?? record.error ?? record.status,
      createdAt: now().toISOString(),
    };
    await deliverToTarget(delivery);
    emitDelivery(delivery);
    return delivery;
  }

  /** 判断是否需要因为静默时段压制非关键投递。 */
  function shouldSuppressForQuietHours(input: AwarenessDecisionDeliveryInput): boolean {
    if (!input.quietHours) return false;
    if (!input.routine.deliveryPolicy.quietHoursRespected) return false;
    const hasCritical = input.signals.some((signal) => signal.severity === "critical");
    return !(hasCritical && input.routine.deliveryPolicy.criticalOverridesQuietHours);
  }

  /** 创建标准投递载荷，保证主进程和渲染进程看到同一份结构。 */
  function createDelivery(
    input: AwarenessDecisionDeliveryInput,
    target: AwarenessDeliveryTarget,
    status: AwarenessDelivery["status"],
  ): AwarenessDelivery {
    const criticalCount = input.signals.filter((signal) => signal.severity === "critical").length;
    return {
      id: `${input.routine.id}:${target}:${now().getTime()}`,
      routineId: input.routine.id,
      ledgerRecordId: input.ledgerRecord?.id,
      target,
      status,
      title: criticalCount > 0 ? `${criticalCount} 个关键值守信号` : input.routine.name,
      body: input.decision.reason,
      createdAt: now().toISOString(),
    };
  }

  /** 按目标通道执行投递副作用，缺省通道通过事件广播交给渲染层消费。 */
  async function deliverToTarget(delivery: AwarenessDelivery): Promise<void> {
    if (delivery.status !== "delivered") return;
    if (delivery.target === "today_catchup") await deps.appendTodayCatchup?.(delivery);
    if (delivery.target === "chat_card") await deps.createChatCard?.(delivery);
    if (delivery.target === "dock_badge") await deps.setDockBadge?.("1");
    if (delivery.target === "system_notification") await deps.showSystemNotification?.(delivery);
  }

  /** 广播投递事件，让 UI 可以实时刷新值守入口。 */
  function emitDelivery(delivery: AwarenessDelivery): void {
    deps.broadcastEvent?.("awareness.delivery", delivery);
  }

  return { deliverDecision, deliverLedgerRecord };
}

export type AwarenessDeliveryService = ReturnType<typeof createAwarenessDeliveryService>;
