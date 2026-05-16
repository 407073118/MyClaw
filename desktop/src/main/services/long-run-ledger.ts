import type {
  AwarenessAuditEvent,
  AwarenessScope,
  LongRunKind,
  LongRunRecord,
  LongRunStatus,
} from "@shared/contracts";
import { randomUUID } from "node:crypto";
import type { TimeOrchestrationDatabase } from "./time-orchestration-database";

function parseLedger(row: Record<string, unknown>): LongRunRecord {
  return JSON.parse(String(row.payload_json)) as LongRunRecord;
}

function parseAuditEvent(row: Record<string, unknown>): AwarenessAuditEvent {
  const payload = row.payload_json ? JSON.parse(String(row.payload_json)) : {};
  return {
    id: String(row.id),
    ledgerRecordId: String(row.ledger_record_id),
    timestamp: String(row.timestamp),
    action: String(row.action),
    actor: String(row.actor) as AwarenessAuditEvent["actor"],
    riskLevel: String(row.risk_level) as AwarenessAuditEvent["riskLevel"],
    approvalStatus: String(row.approval_status) as AwarenessAuditEvent["approvalStatus"],
    detail: String(row.detail),
    standingOrderId: row.standing_order_id ? String(row.standing_order_id) : undefined,
    policyDecisionReason: payload.policyDecisionReason,
  };
}

export function createLongRunLedger(db: TimeOrchestrationDatabase) {
  async function upsertRecord(record: LongRunRecord): Promise<void> {
    db.run(
      `INSERT INTO long_run_ledger (
        id, kind, source_id, scope_kind, owner_id, status,
        started_at, finished_at, last_heartbeat_at, delivery_status,
        payload_json, created_at, updated_at
      ) VALUES (
        @id, @kind, @source_id, @scope_kind, @owner_id, @status,
        @started_at, @finished_at, @last_heartbeat_at, @delivery_status,
        @payload_json, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        finished_at = excluded.finished_at,
        last_heartbeat_at = excluded.last_heartbeat_at,
        delivery_status = excluded.delivery_status,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at`,
      {
        id: record.id,
        kind: record.kind,
        source_id: record.sourceId,
        scope_kind: record.scope.kind,
        owner_id: record.scope.ownerId ?? null,
        status: record.status,
        started_at: record.startedAt,
        finished_at: record.finishedAt ?? null,
        last_heartbeat_at: record.lastHeartbeatAt ?? null,
        delivery_status: record.deliveryStatus,
        payload_json: JSON.stringify(record),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      },
    );
  }

  function createRecord(
    kind: LongRunKind,
    sourceId: string,
    scope: AwarenessScope,
    status: LongRunStatus = "queued",
  ): LongRunRecord {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      kind,
      sourceId,
      scope,
      status,
      startedAt: now,
      deliveryStatus: "not_required",
      createdAt: now,
      updatedAt: now,
    };
  }

  async function finishRecord(
    id: string,
    status: LongRunStatus,
    result?: { summary?: string; error?: string },
  ): Promise<void> {
    const row = db.queryOne("SELECT payload_json FROM long_run_ledger WHERE id = @id", { id });
    if (!row) return;
    const record = parseLedger(row);
    const now = new Date().toISOString();
    const updated: LongRunRecord = {
      ...record,
      status,
      finishedAt: now,
      lastHeartbeatAt: now,
      resultSummary: result?.summary,
      error: result?.error,
      deliveryStatus: "pending",
      updatedAt: now,
    };
    await upsertRecord(updated);
  }

  async function writeAuditEvent(event: Omit<AwarenessAuditEvent, "id">): Promise<void> {
    const id = randomUUID();
    db.run(
      `INSERT INTO awareness_audit_events (
        id, ledger_record_id, timestamp, action, actor,
        risk_level, approval_status, detail, standing_order_id, payload_json
      ) VALUES (
        @id, @ledger_record_id, @timestamp, @action, @actor,
        @risk_level, @approval_status, @detail, @standing_order_id, @payload_json
      )`,
      {
        id,
        ledger_record_id: event.ledgerRecordId,
        timestamp: event.timestamp,
        action: event.action,
        actor: event.actor,
        risk_level: event.riskLevel,
        approval_status: event.approvalStatus,
        detail: event.detail,
        standing_order_id: event.standingOrderId ?? null,
        payload_json: JSON.stringify({ policyDecisionReason: event.policyDecisionReason }),
      },
    );
  }

  async function listRecords(query?: {
    kind?: LongRunKind;
    status?: LongRunStatus;
    limit?: number;
  }): Promise<LongRunRecord[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    if (query?.kind) {
      conditions.push("kind = @kind");
      params.kind = query.kind;
    }
    if (query?.status) {
      conditions.push("status = @status");
      params.status = query.status;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query?.limit ?? 50;
    return db
      .queryAll(
        `SELECT payload_json FROM long_run_ledger ${where} ORDER BY started_at DESC LIMIT @limit`,
        { ...params, limit },
      )
      .map(parseLedger);
  }

  async function getRecord(id: string): Promise<LongRunRecord | null> {
    const row = db.queryOne("SELECT payload_json FROM long_run_ledger WHERE id = @id", { id });
    return row ? parseLedger(row) : null;
  }

  async function listAuditEvents(ledgerRecordId: string): Promise<AwarenessAuditEvent[]> {
    return db
      .queryAll(
        "SELECT * FROM awareness_audit_events WHERE ledger_record_id = @id ORDER BY timestamp ASC",
        { id: ledgerRecordId },
      )
      .map(parseAuditEvent);
  }

  async function markDelivered(id: string): Promise<void> {
    const row = db.queryOne("SELECT payload_json FROM long_run_ledger WHERE id = @id", { id });
    if (!row) return;
    const record = parseLedger(row);
    const updated: LongRunRecord = {
      ...record,
      deliveryStatus: "delivered",
      updatedAt: new Date().toISOString(),
    };
    await upsertRecord(updated);
  }

  return {
    upsertRecord,
    createRecord,
    finishRecord,
    writeAuditEvent,
    listRecords,
    getRecord,
    listAuditEvents,
    markDelivered,
  };
}

export type LongRunLedgerService = ReturnType<typeof createLongRunLedger>;
