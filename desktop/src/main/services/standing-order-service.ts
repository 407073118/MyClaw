import type {
  AwarenessActionKind,
  AwarenessScope,
  AwarenessSignalSourceKind,
  ApprovalGate,
  StandingOrder,
  StandingOrderCreateInput,
  StandingOrderUpdateInput,
} from "@shared/contracts";
import {
  createDefaultEscalationPolicy,
} from "@shared/contracts";
import { randomUUID } from "node:crypto";
import type { TimeOrchestrationDatabase } from "./time-orchestration-database";

function parseStandingOrder(row: Record<string, unknown>): StandingOrder {
  return JSON.parse(String(row.payload_json)) as StandingOrder;
}

export function createStandingOrderService(db: TimeOrchestrationDatabase) {
  async function list(scope?: AwarenessScope): Promise<StandingOrder[]> {
    if (scope) {
      return db
        .queryAll(
          "SELECT payload_json FROM standing_orders WHERE scope_kind = @scope_kind AND (owner_id = @owner_id OR @owner_id IS NULL) AND status = 'active' ORDER BY updated_at DESC",
          { scope_kind: scope.kind, owner_id: scope.ownerId ?? null },
        )
        .map(parseStandingOrder);
    }
    return db
      .queryAll("SELECT payload_json FROM standing_orders WHERE status = 'active' ORDER BY updated_at DESC")
      .map(parseStandingOrder);
  }

  async function create(input: StandingOrderCreateInput): Promise<StandingOrder> {
    const now = new Date().toISOString();
    const order: StandingOrder = {
      id: randomUUID(),
      scope: input.scope,
      name: input.name,
      intent: input.intent,
      allowedSignals: input.allowedSignals ?? [],
      allowedActions: input.allowedActions ?? [],
      approvalGate: input.approvalGate ?? "risk_based",
      escalationPolicy: {
        ...createDefaultEscalationPolicy(),
        ...input.escalationPolicy,
      },
      expiresAt: input.expiresAt,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    db.run(
      `INSERT INTO standing_orders (id, scope_kind, owner_id, name, status, payload_json, created_at, updated_at)
       VALUES (@id, @scope_kind, @owner_id, @name, @status, @payload_json, @created_at, @updated_at)`,
      {
        id: order.id,
        scope_kind: order.scope.kind,
        owner_id: order.scope.ownerId ?? null,
        name: order.name,
        status: order.status,
        payload_json: JSON.stringify(order),
        created_at: now,
        updated_at: now,
      },
    );
    return order;
  }

  async function update(id: string, input: StandingOrderUpdateInput): Promise<StandingOrder | null> {
    const row = db.queryOne("SELECT payload_json FROM standing_orders WHERE id = @id", { id });
    if (!row) return null;
    const existing = parseStandingOrder(row);
    const now = new Date().toISOString();
    const updated: StandingOrder = {
      ...existing,
      name: input.name ?? existing.name,
      intent: input.intent ?? existing.intent,
      allowedSignals: input.allowedSignals ?? existing.allowedSignals,
      allowedActions: input.allowedActions ?? existing.allowedActions,
      approvalGate: input.approvalGate ?? existing.approvalGate,
      escalationPolicy: input.escalationPolicy
        ? { ...existing.escalationPolicy, ...input.escalationPolicy }
        : existing.escalationPolicy,
      expiresAt: input.expiresAt ?? existing.expiresAt,
      status: input.status ?? existing.status,
      updatedAt: now,
    };
    db.run(
      `UPDATE standing_orders SET name = @name, status = @status, payload_json = @payload_json, updated_at = @updated_at WHERE id = @id`,
      {
        id,
        name: updated.name,
        status: updated.status,
        payload_json: JSON.stringify(updated),
        updated_at: now,
      },
    );
    return updated;
  }

  async function remove(id: string): Promise<void> {
    db.run("DELETE FROM standing_orders WHERE id = @id", { id });
  }

  async function get(id: string): Promise<StandingOrder | null> {
    const row = db.queryOne("SELECT payload_json FROM standing_orders WHERE id = @id", { id });
    return row ? parseStandingOrder(row) : null;
  }

  /** 检查某个动作是否被某 Standing Order 授权 */
  function isActionAuthorized(
    orders: StandingOrder[],
    actionKind: AwarenessActionKind,
    signalSource?: AwarenessSignalSourceKind,
  ): { authorized: boolean; orderId?: string; gate: ApprovalGate } {
    for (const order of orders) {
      if (order.status !== "active") continue;
      if (order.expiresAt && new Date(order.expiresAt) < new Date()) continue;
      if (order.allowedActions.includes(actionKind)) {
        if (signalSource && order.allowedSignals.length > 0 && !order.allowedSignals.includes(signalSource)) {
          continue;
        }
        return { authorized: true, orderId: order.id, gate: order.approvalGate };
      }
    }
    return { authorized: false, gate: "always" };
  }

  return { list, create, update, remove, get, isActionAuthorized };
}

export type StandingOrderService = ReturnType<typeof createStandingOrderService>;
