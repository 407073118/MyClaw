import type {
  AwarenessActionKind,
  AwarenessRoutine,
  AwarenessRoutineCreateInput,
  AwarenessRoutineStatus,
  AwarenessRoutineUpdateInput,
  AwarenessScope,
  AwarenessScopeKind,
  AwarenessSignal,
  AwarenessSignalSourceKind,
  AwarenessSignalStatus,
  AwarenessTickReceipt,
} from "@shared/contracts";
import {
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
  isInQuietHours,
} from "@shared/contracts";
import { randomUUID } from "node:crypto";
import type { TimeOrchestrationDatabase } from "./time-orchestration-database";

function parseRoutine(row: Record<string, unknown>): AwarenessRoutine {
  return JSON.parse(String(row.payload_json)) as AwarenessRoutine;
}

function parseSignal(row: Record<string, unknown>): AwarenessSignal {
  return JSON.parse(String(row.payload_json)) as AwarenessSignal;
}

export type AwarenessStoreDeps = {
  db: TimeOrchestrationDatabase;
  getAvailabilityPolicy: () => Promise<unknown>;
  now?: () => Date;
};

export function createAwarenessStore(deps: AwarenessStoreDeps) {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());

  // ─── Routine CRUD ───

  async function listRoutines(scope?: AwarenessScope): Promise<AwarenessRoutine[]> {
    if (scope) {
      return db
        .queryAll(
          "SELECT payload_json FROM awareness_routines WHERE scope_kind = @scope_kind AND (owner_id = @owner_id OR @owner_id IS NULL) ORDER BY updated_at DESC",
          { scope_kind: scope.kind, owner_id: scope.ownerId ?? null },
        )
        .map(parseRoutine);
    }
    return db
      .queryAll("SELECT payload_json FROM awareness_routines ORDER BY updated_at DESC")
      .map(parseRoutine);
  }

  async function getRoutine(id: string): Promise<AwarenessRoutine | null> {
    const row = db.queryOne("SELECT payload_json FROM awareness_routines WHERE id = @id", { id });
    return row ? parseRoutine(row) : null;
  }

  async function createRoutine(input: AwarenessRoutineCreateInput): Promise<AwarenessRoutine> {
    const nowIso = now().toISOString();
    const cadence = input.cadenceMinutes ?? (input.scope.kind === "silicon_person" ? 60 : 30);
    const routine: AwarenessRoutine = {
      id: randomUUID(),
      name: input.name,
      scope: input.scope,
      purpose: input.purpose,
      cadenceMinutes: cadence,
      activeHours: input.activeHours,
      signalSources: input.signalSources ?? [
        "agent_task",
        "schedule_job",
        "workflow_run",
        "background_task",
        "session_stuck",
        "approval_pending",
      ],
      decisionPolicy: { ...createDefaultDecisionPolicy(), ...input.decisionPolicy },
      actionPolicy: { ...createDefaultActionPolicy(), ...input.actionPolicy },
      deliveryPolicy: { ...createDefaultDeliveryPolicy(), ...input.deliveryPolicy },
      budgetPolicy: { ...createDefaultBudgetPolicy(), ...input.budgetPolicy },
      standingOrderIds: input.standingOrderIds ?? [],
      status: "enabled",
      consecutiveFailures: 0,
      nextRunAt: new Date(now().getTime() + cadence * 60_000).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    db.run(
      `INSERT INTO awareness_routines (
        id, scope_kind, owner_id, name, status, cadence_minutes, payload_json, created_at, updated_at
      ) VALUES (
        @id, @scope_kind, @owner_id, @name, @status, @cadence_minutes, @payload_json, @created_at, @updated_at
      )`,
      {
        id: routine.id,
        scope_kind: routine.scope.kind,
        owner_id: routine.scope.ownerId ?? null,
        name: routine.name,
        status: routine.status,
        cadence_minutes: routine.cadenceMinutes,
        payload_json: JSON.stringify(routine),
        created_at: nowIso,
        updated_at: nowIso,
      },
    );
    return routine;
  }

  async function updateRoutine(id: string, input: AwarenessRoutineUpdateInput): Promise<AwarenessRoutine | null> {
    const row = db.queryOne("SELECT payload_json FROM awareness_routines WHERE id = @id", { id });
    if (!row) return null;
    const existing = parseRoutine(row);
    const nowIso = now().toISOString();
    const updated: AwarenessRoutine = {
      ...existing,
      name: input.name ?? existing.name,
      purpose: input.purpose ?? existing.purpose,
      cadenceMinutes: input.cadenceMinutes ?? existing.cadenceMinutes,
      activeHours: input.activeHours ?? existing.activeHours,
      signalSources: input.signalSources ?? existing.signalSources,
      decisionPolicy: input.decisionPolicy ? { ...existing.decisionPolicy, ...input.decisionPolicy } : existing.decisionPolicy,
      actionPolicy: input.actionPolicy ? { ...existing.actionPolicy, ...input.actionPolicy } : existing.actionPolicy,
      deliveryPolicy: input.deliveryPolicy ? { ...existing.deliveryPolicy, ...input.deliveryPolicy } : existing.deliveryPolicy,
      budgetPolicy: input.budgetPolicy ? { ...existing.budgetPolicy, ...input.budgetPolicy } : existing.budgetPolicy,
      standingOrderIds: input.standingOrderIds ?? existing.standingOrderIds,
      status: input.status ?? existing.status,
      updatedAt: nowIso,
    };
    db.run(
      `UPDATE awareness_routines SET name = @name, status = @status, cadence_minutes = @cadence_minutes, payload_json = @payload_json, updated_at = @updated_at WHERE id = @id`,
      {
        id,
        name: updated.name,
        status: updated.status,
        cadence_minutes: updated.cadenceMinutes,
        payload_json: JSON.stringify(updated),
        updated_at: nowIso,
      },
    );
    return updated;
  }

  async function deleteRoutine(id: string): Promise<void> {
    db.run("DELETE FROM awareness_routines WHERE id = @id", { id });
  }

  async function updateRoutineAfterTick(
    id: string,
    succeeded: boolean,
    receipt: AwarenessTickReceipt,
  ): Promise<AwarenessRoutine | null> {
    const routine = await getRoutine(id);
    if (!routine) return null;
    const nowIso = now().toISOString();
    const consecutiveFailures = succeeded ? 0 : routine.consecutiveFailures + 1;
    let status: AwarenessRoutineStatus = succeeded ? "enabled" : routine.status;
    if (consecutiveFailures >= 3) {
      status = "failed";
    }
    const updated: AwarenessRoutine = {
      ...routine,
      status,
      consecutiveFailures,
      lastRunAt: nowIso,
      nextRunAt: new Date(now().getTime() + routine.cadenceMinutes * 60_000).toISOString(),
      lastReceipt: receipt,
      updatedAt: nowIso,
    };
    db.run(
      `UPDATE awareness_routines SET status = @status, payload_json = @payload_json, updated_at = @updated_at WHERE id = @id`,
      {
        id,
        status: updated.status,
        payload_json: JSON.stringify(updated),
        updated_at: nowIso,
      },
    );
    return updated;
  }

  // ─── Signal CRUD ───

  async function listSignals(status?: AwarenessSignalStatus): Promise<AwarenessSignal[]> {
    if (status) {
      return db
        .queryAll(
          "SELECT payload_json FROM awareness_signals WHERE status = @status ORDER BY created_at DESC",
          { status },
        )
        .map(parseSignal);
    }
    return db
      .queryAll("SELECT payload_json FROM awareness_signals ORDER BY created_at DESC")
      .map(parseSignal);
  }

  async function upsertSignal(signal: AwarenessSignal): Promise<void> {
    db.run(
      `INSERT INTO awareness_signals (
        id, fingerprint, source_kind, source_id, scope_kind, owner_id,
        severity, status, cooldown_until, payload_json, created_at, updated_at
      ) VALUES (
        @id, @fingerprint, @source_kind, @source_id, @scope_kind, @owner_id,
        @severity, @status, @cooldown_until, @payload_json, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        cooldown_until = excluded.cooldown_until,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at`,
      {
        id: signal.id,
        fingerprint: signal.fingerprint,
        source_kind: signal.sourceKind,
        source_id: signal.sourceId,
        scope_kind: signal.scope.kind,
        owner_id: signal.scope.ownerId ?? null,
        severity: signal.severity,
        status: signal.status,
        cooldown_until: signal.cooldownUntil ?? null,
        payload_json: JSON.stringify(signal),
        created_at: signal.createdAt,
        updated_at: signal.updatedAt,
      },
    );
  }

  async function findSignalByFingerprint(fingerprint: string): Promise<AwarenessSignal | null> {
    const row = db.queryOne(
      "SELECT payload_json FROM awareness_signals WHERE fingerprint = @fingerprint ORDER BY created_at DESC LIMIT 1",
      { fingerprint },
    );
    return row ? parseSignal(row) : null;
  }

  async function updateSignalStatus(
    id: string,
    status: AwarenessSignalStatus,
    extra?: { cooldownUntil?: string; resolvedAt?: string; dismissedAt?: string },
  ): Promise<void> {
    const row = db.queryOne("SELECT payload_json FROM awareness_signals WHERE id = @id", { id });
    if (!row) return;
    const existing = parseSignal(row);
    const nowIso = now().toISOString();
    const updated: AwarenessSignal = {
      ...existing,
      status,
      cooldownUntil: extra?.cooldownUntil,
      resolvedAt: extra?.resolvedAt,
      dismissedAt: extra?.dismissedAt,
      updatedAt: nowIso,
    };
    db.run(
      `UPDATE awareness_signals SET status = @status, cooldown_until = @cooldown_until, payload_json = @payload_json, updated_at = @updated_at WHERE id = @id`,
      {
        id,
        status: updated.status,
        cooldown_until: updated.cooldownUntil ?? null,
        payload_json: JSON.stringify(updated),
        updated_at: nowIso,
      },
    );
  }

  async function cleanupStaleSignals(): Promise<number> {
    const nowIso = now().toISOString();
    const resolved = db.queryAll(
      "SELECT id, payload_json FROM awareness_signals WHERE status = 'active'",
    );
    let cleaned = 0;
    for (const row of resolved) {
      const signal = parseSignal(row);
      if (signal.cooldownUntil && new Date(signal.cooldownUntil) < now()) {
        await updateSignalStatus(signal.id, "suppressed");
        cleaned++;
      }
    }
    return cleaned;
  }

  // ─── Due Routines ───

  async function listDueRoutines(at: Date): Promise<AwarenessRoutine[]> {
    return db
      .queryAll(
        `SELECT payload_json FROM awareness_routines
         WHERE status = 'enabled' AND next_run_at IS NOT NULL AND next_run_at <= @now
         ORDER BY next_run_at ASC`,
        { now: at.toISOString() },
      )
      .map(parseRoutine);
  }

  return {
    listRoutines,
    getRoutine,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    updateRoutineAfterTick,
    listSignals,
    upsertSignal,
    findSignalByFingerprint,
    updateSignalStatus,
    cleanupStaleSignals,
    listDueRoutines,
  };
}

export type AwarenessStore = ReturnType<typeof createAwarenessStore>;
