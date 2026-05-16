import type {
  AwarenessAction,
  AwarenessAuditEvent,
  AwarenessDecision,
  AwarenessDecisionSkipReason,
  AwarenessRoutine,
  AwarenessSignal,
  AwarenessSignalSourceKind,
  AwarenessSnapshot,
  AwarenessTickReceipt,
  AvailabilityPolicy,
  StandingOrder,
} from "@shared/contracts";
import { isInQuietHours } from "@shared/contracts";
import type { AwarenessStore } from "./awareness-store";
import { createSignalFromRaw, type RawSignal } from "./awareness-signal-collector";
import type { StandingOrderService } from "./standing-order-service";
import type { LongRunLedgerService } from "./long-run-ledger";

export type AwarenessRuntimeDeps = {
  store: AwarenessStore;
  signalCollector: { collect: () => RawSignal[] };
  decisionEngine: ReturnType<typeof import("./awareness-decision-engine").createAwarenessDecisionEngine>;
  standingOrderService: StandingOrderService;
  ledger: LongRunLedgerService;
  getAvailabilityPolicy: () => Promise<AvailabilityPolicy | null>;
  broadcastEvent: (type: string, payload: unknown) => void;
  now?: () => Date;
};

export function createAwarenessRuntime(deps: AwarenessRuntimeDeps) {
  const now = deps.now ?? (() => new Date());

  /** 今日每 routine 的模型调用计数（日切自动重置） */
  const modelCallCounts = new Map<string, number>();
  let countDate = "";

  async function tick(): Promise<void> {
    const currentTime = now();
    const dueRoutines = await deps.store.listDueRoutines(currentTime);

    if (dueRoutines.length === 0) {
      await deps.store.cleanupStaleSignals();
      return;
    }

    const policy = await deps.getAvailabilityPolicy();

    for (const routine of dueRoutines) {
      if (routine.status !== "enabled") continue;
      await executeRoutineTick(routine, policy, currentTime);
    }

    await deps.store.cleanupStaleSignals();
  }

  async function executeRoutineTick(
    routine: AwarenessRoutine,
    policy: AvailabilityPolicy | null,
    currentTime: Date,
  ): Promise<void> {
    const tickStart = Date.now();

    try {
      if (!isRoutineActiveAt(routine, currentTime)) {
        await skipRoutineTick(routine, currentTime, tickStart, "outside_active_hours", "当前时间不在值守活跃时段内");
        return;
      }

      if (shouldSkipMissedRoutine(routine, currentTime)) {
        await skipRoutineTick(routine, currentTime, tickStart, "no_due_task", "值守策略要求跳过错过的历史周期");
        return;
      }

      const rawSignals = deps.signalCollector.collect();
      const filteredSignals = rawSignals.filter(
        (s: { sourceKind: AwarenessSignalSourceKind }) => !routine.signalSources.length || routine.signalSources.includes(s.sourceKind),
      );

      const newSignals = await deduplicateAndStoreSignals(filteredSignals);

      if (newSignals.length === 0) {
        const receipt: AwarenessTickReceipt = {
          tickedAt: currentTime.toISOString(),
          signalsCollected: filteredSignals.length,
          signalsNew: 0,
          modelCalled: false,
          decisionsMade: 0,
          actionsExecuted: 0,
          actionsBlocked: 0,
          durationMs: Date.now() - tickStart,
        };
        await deps.store.updateRoutineAfterTick(routine.id, true, receipt, {
          lastSkippedReason: "no_signal",
          lastDecisionSummary: "本轮没有发现需要处理的值守信号",
        });
        return;
      }

      const quietHours = isInQuietHours(policy, currentTime);
      const actionableSignals = quietHours
        ? newSignals.filter((s) => s.severity === "critical")
        : newSignals;

      if (actionableSignals.length === 0) {
        const receipt: AwarenessTickReceipt = {
          tickedAt: currentTime.toISOString(),
          signalsCollected: filteredSignals.length,
          signalsNew: newSignals.length,
          modelCalled: false,
          decisionsMade: 0,
          actionsExecuted: 0,
          actionsBlocked: 0,
          durationMs: Date.now() - tickStart,
        };
        await deps.store.updateRoutineAfterTick(routine.id, true, receipt, {
          lastSkippedReason: "queue_busy",
          lastDecisionSummary: "静默时段内没有需要升级的关键值守信号",
        });
        return;
      }

      const decision = await deps.decisionEngine.decide(
        actionableSignals,
        routine.decisionPolicy,
        routine.id,
        routine.purpose,
      );

      const ledgerRecord = deps.ledger.createRecord("awareness_routine", routine.id, routine.scope, "running");
      await deps.ledger.upsertRecord(ledgerRecord);

      const { actionsExecuted, actionsBlocked } = await executeActions(
        decision.actions,
        routine,
        actionableSignals,
        ledgerRecord.id,
      );

      if (decision.notify && routine.deliveryPolicy.notifyOnDecision) {
        await deps.ledger.finishRecord(ledgerRecord.id, "succeeded", {
          summary: decision.reason,
        });
      } else {
        await deps.ledger.finishRecord(ledgerRecord.id, "succeeded", {
          summary: decision.reason,
        });
      }

      const receipt: AwarenessTickReceipt = {
        tickedAt: currentTime.toISOString(),
        signalsCollected: filteredSignals.length,
        signalsNew: newSignals.length,
        modelCalled: decision.confidence < 1.0,
        decisionsMade: 1,
        actionsExecuted,
        actionsBlocked,
        durationMs: Date.now() - tickStart,
      };
      await deps.store.updateRoutineAfterTick(routine.id, true, receipt, {
        lastDecisionSummary: decision.reason,
      });

      deps.broadcastEvent("awareness.changed", { routineId: routine.id });
    } catch (error) {
      const receipt: AwarenessTickReceipt = {
        tickedAt: currentTime.toISOString(),
        signalsCollected: 0,
        signalsNew: 0,
        modelCalled: false,
        decisionsMade: 0,
        actionsExecuted: 0,
        actionsBlocked: 0,
        durationMs: Date.now() - tickStart,
      };
      await deps.store.updateRoutineAfterTick(routine.id, false, receipt);
      console.error("[awareness] routine tick 失败", {
        routineId: routine.id,
        error: error instanceof Error ? error.message : String(error),
      });

      const updated = await deps.store.getRoutine(routine.id);
      if (updated?.status === "failed") {
        deps.broadcastEvent("awareness.changed", {
          routineId: routine.id,
          reason: "consecutive_failures",
        });
      }
    }
  }

  /** 记录被策略跳过的值守 tick，确保下次运行时间仍然推进。 */
  async function skipRoutineTick(
    routine: AwarenessRoutine,
    currentTime: Date,
    tickStart: number,
    reason: AwarenessDecisionSkipReason,
    summary: string,
  ): Promise<void> {
    console.info("[awareness-runtime] 跳过值守运行", {
      routineId: routine.id,
      reason,
      currentTime: currentTime.toISOString(),
    });
    const receipt: AwarenessTickReceipt = {
      tickedAt: currentTime.toISOString(),
      signalsCollected: 0,
      signalsNew: 0,
      modelCalled: false,
      decisionsMade: 0,
      actionsExecuted: 0,
      actionsBlocked: 0,
      durationMs: Date.now() - tickStart,
    };
    await deps.store.updateRoutineAfterTick(routine.id, true, receipt, {
      lastSkippedReason: reason,
      lastDecisionSummary: summary,
    });
  }

  /** 判断当前时间是否落在值守规则声明的活跃时段内。 */
  function isRoutineActiveAt(routine: AwarenessRoutine, currentTime: Date): boolean {
    if (!routine.activeHours || routine.activeHours.length === 0) return true;
    const jsWeekday = currentTime.getDay();
    const weekday = jsWeekday === 0 ? 7 : jsWeekday;
    const minutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    return routine.activeHours.some((window) => {
      if (window.weekday !== weekday) return false;
      const start = parseClockMinutes(window.start);
      const end = parseClockMinutes(window.end);
      if (start <= end) return minutes >= start && minutes < end;
      return minutes >= start || minutes < end;
    });
  }

  /** 解析 HH:mm 时钟字符串，非法值按 0 点处理并写入日志。 */
  function parseClockMinutes(value: string): number {
    const [hourText, minuteText] = value.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      console.warn("[awareness-runtime] 值守活跃时段格式异常，按 00:00 处理", { value });
      return 0;
    }
    return hour * 60 + minute;
  }

  /** 根据补跑策略判断是否跳过已经错过太久的值守周期。 */
  function shouldSkipMissedRoutine(routine: AwarenessRoutine, currentTime: Date): boolean {
    if (routine.catchUpPolicy?.mode !== "skip_missed" || !routine.nextRunAt) return false;
    const dueAt = new Date(routine.nextRunAt).getTime();
    const cadenceMs = routine.cadenceMinutes * 60_000;
    const missedRuns = Math.floor(Math.max(0, currentTime.getTime() - dueAt) / cadenceMs);
    const limit = routine.catchUpPolicy.maxMissedRuns;
    const shouldSkip = missedRuns > limit;
    if (shouldSkip) {
      console.info("[awareness-runtime] 跳过错过过久的值守周期", {
        routineId: routine.id,
        missedRuns,
        limit,
      });
    }
    return shouldSkip;
  }

  async function deduplicateAndStoreSignals(
    rawSignals: Array<{
      sourceKind: AwarenessSignalSourceKind;
      sourceId: string;
      scope: { kind: string; ownerId?: string };
      severity: "info" | "warning" | "critical";
      summary: string;
      recommendedAction?: string;
      fingerprint: string;
    }>,
  ): Promise<AwarenessSignal[]> {
    const newSignals: AwarenessSignal[] = [];
    for (const raw of rawSignals) {
      const existing = await deps.store.findSignalByFingerprint(raw.fingerprint);
      if (existing) {
        if (existing.status === "active" && existing.cooldownUntil && new Date(existing.cooldownUntil) > now()) {
          continue;
        }
        if (existing.status === "dismissed" || existing.status === "resolved") {
          continue;
        }
        if (existing.status === "suppressed") {
          await deps.store.updateSignalStatus(existing.id, "active", {
            cooldownUntil: new Date(now().getTime() + 2 * 60 * 60 * 1000).toISOString(),
          });
          newSignals.push({ ...existing, status: "active" });
          continue;
        }
        continue;
      }
      const signal = createSignalFromRaw(raw as Parameters<typeof createSignalFromRaw>[0]);
      await deps.store.upsertSignal(signal);
      newSignals.push(signal);
    }
    return newSignals;
  }

  async function executeActions(
    actions: AwarenessAction[],
    routine: AwarenessRoutine,
    signals: AwarenessSignal[],
    ledgerRecordId: string,
  ): Promise<{ actionsExecuted: number; actionsBlocked: number }> {
    let actionsExecuted = 0;
    let actionsBlocked = 0;

    const orders = await deps.standingOrderService.list(routine.scope);

    for (const action of actions) {
      const policyCheck = checkActionPolicy(action, routine, orders);
      await deps.ledger.writeAuditEvent({
        ledgerRecordId,
        timestamp: now().toISOString(),
        action: action.kind,
        actor: "system",
        riskLevel: action.riskLevel,
        approvalStatus: policyCheck.approvalStatus as AwarenessAuditEvent["approvalStatus"],
        detail: action.description,
        standingOrderId: policyCheck.standingOrderId,
        policyDecisionReason: policyCheck.reason,
      });

      if (policyCheck.blocked) {
        actionsBlocked++;
        continue;
      }

      actionsExecuted++;
    }

    return { actionsExecuted, actionsBlocked };
  }

  function checkActionPolicy(
    action: AwarenessAction,
    routine: AwarenessRoutine,
    orders: StandingOrder[],
  ): { blocked: boolean; approvalStatus: string; standingOrderId?: string; reason: string } {
    if (routine.actionPolicy.alwaysDeny.includes(action.kind)) {
      return { blocked: true, approvalStatus: "rejected", reason: "action in alwaysDeny list" };
    }

    if (routine.actionPolicy.autoAllow.includes(action.kind)) {
      return { blocked: false, approvalStatus: "auto_approved", reason: "action in autoAllow list" };
    }

    if (routine.actionPolicy.requireApproval.includes(action.kind)) {
      const auth = deps.standingOrderService.isActionAuthorized(
        orders,
        action.kind,
      );
      if (!auth.authorized) {
        return { blocked: true, approvalStatus: "rejected", reason: "no standing order authorizes this action" };
      }

      if (auth.gate === "always") {
        return { blocked: true, approvalStatus: "pending", reason: "standing order requires approval", standingOrderId: auth.orderId };
      }

      if (auth.gate === "risk_based" && action.riskLevel === "high") {
        return { blocked: true, approvalStatus: "pending", reason: "high risk action requires approval", standingOrderId: auth.orderId };
      }

      return { blocked: false, approvalStatus: "auto_approved", standingOrderId: auth.orderId, reason: "authorized by standing order" };
    }

    return { blocked: false, approvalStatus: "not_required", reason: "no policy restriction" };
  }

  async function getSnapshot(): Promise<AwarenessSnapshot> {
    const [routines, activeSignals, standingOrders, recentLedger] = await Promise.all([
      deps.store.listRoutines(),
      deps.store.listSignals("active"),
      deps.standingOrderService.list(),
      deps.ledger.listRecords({ limit: 20 }),
    ]);
    return {
      routines,
      activeSignals,
      standingOrders,
      recentLedgerEntries: recentLedger,
      pendingApprovals: recentLedger.filter((r) => r.status === "waiting_user").length,
      failedRoutineCount: routines.filter((r) => r.status === "failed").length,
    };
  }

  async function runRoutineNow(routineId: string): Promise<void> {
    const routine = await deps.store.getRoutine(routineId);
    if (!routine) throw new Error("routine not found");
    const policy = await deps.getAvailabilityPolicy();
    await executeRoutineTick(routine, policy, now());
  }

  async function previewRoutine(routineId: string): Promise<{
    signalsFound: number;
    wouldCallModel: boolean;
    potentialActions: Array<{ kind: string; riskLevel: string }>;
    estimatedCost: "free" | "low" | "normal";
  }> {
    const routine = await deps.store.getRoutine(routineId);
    if (!routine) throw new Error("routine not found");

    const rawSignals = deps.signalCollector.collect();
    const filtered = rawSignals.filter(
      (s) => !routine.signalSources.length || routine.signalSources.includes(s.sourceKind),
    );

    const needsModel = routine.decisionPolicy.useModelForCrossSource && filtered.length > 1
      || routine.decisionPolicy.useModelForActionSuggestion && filtered.some((s) => s.severity !== "info");

    return {
      signalsFound: filtered.length,
      wouldCallModel: needsModel,
      potentialActions: filtered.map((s) => ({
        kind: s.severity === "critical" ? "notify_user" : "log_only",
        riskLevel: s.severity === "critical" ? "medium" : "low",
      })),
      estimatedCost: needsModel ? "normal" : "free",
    };
  }

  function getModelCallsToday(routineId: string): number {
    const today = now().toISOString().slice(0, 10);
    if (countDate !== today) {
      modelCallCounts.clear();
      countDate = today;
    }
    return modelCallCounts.get(routineId) ?? 0;
  }

  function incrementModelCalls(routineId: string): void {
    // 确保 countDate 已初始化
    getModelCallsToday(routineId);
    modelCallCounts.set(routineId, (modelCallCounts.get(routineId) ?? 0) + 1);
  }

  return {
    tick,
    getSnapshot,
    runRoutineNow,
    previewRoutine,
    getModelCallsToday,
    incrementModelCalls,
  };
}

export type AwarenessRuntimeService = ReturnType<typeof createAwarenessRuntime>;
