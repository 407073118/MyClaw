import type { RuntimeContext } from "../services/runtime-context";
import { createAwarenessPolicyEngine } from "../services/awareness-policy-engine";

export function registerAwarenessHandlers(ctx: RuntimeContext): void {
  const { ipcMain } = require("electron") as { ipcMain: Electron.IpcMain };
  const runtime = ctx.services.awarenessRuntime;
  const store = ctx.services.awarenessStore;
  const standingOrders = ctx.services.standingOrderService;
  const ledger = ctx.services.longRunLedger;

  if (!runtime || !store || !standingOrders || !ledger) {
    console.warn("[awareness-ipc] 部分服务未初始化，跳过 IPC 注册");
    return;
  }

  // ─── Routine ───

  ipcMain.handle("awareness:list-routines", async (_event, scope?: { kind: string; ownerId?: string }) => {
    const routines = await store.listRoutines(scope as any);
    return { items: routines };
  });

  ipcMain.handle("awareness:create-routine", async (_event, input: Record<string, unknown>) => {
    const routine = await store.createRoutine(input as any);
    broadcastAwarenessChanged(ctx);
    return { item: routine };
  });

  ipcMain.handle("awareness:update-routine", async (_event, id: string, input: Record<string, unknown>) => {
    const routine = await store.updateRoutine(id, input as any);
    broadcastAwarenessChanged(ctx);
    return { item: routine };
  });

  ipcMain.handle("awareness:pause-routine", async (_event, id: string) => {
    const routine = await store.updateRoutine(id, { status: "paused" });
    broadcastAwarenessChanged(ctx);
    return { item: routine };
  });

  ipcMain.handle("awareness:resume-routine", async (_event, id: string) => {
    const routine = await store.updateRoutine(id, { status: "enabled" });
    broadcastAwarenessChanged(ctx);
    return { item: routine };
  });

  ipcMain.handle("awareness:delete-routine", async (_event, id: string) => {
    await store.deleteRoutine(id);
    broadcastAwarenessChanged(ctx);
    return { ok: true };
  });

  ipcMain.handle("awareness:run-routine-now", async (_event, id: string) => {
    await runtime.runRoutineNow(id);
    return { ok: true };
  });

  ipcMain.handle("awareness:preview-routine", async (_event, id: string) => {
    const preview = await runtime.previewRoutine(id);
    return preview;
  });

  // ─── Signal ───

  ipcMain.handle("awareness:list-signals", async (_event, status?: string) => {
    const signals = await store.listSignals(status as any);
    return { items: signals };
  });

  ipcMain.handle("awareness:get-snapshot", async () => {
    const snapshot = await runtime.getSnapshot();
    return snapshot;
  });

  ipcMain.handle("awareness:dismiss-signal", async (_event, id: string) => {
    await store.updateSignalStatus(id, "dismissed", {
      dismissedAt: new Date().toISOString(),
      cooldownUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    broadcastAwarenessChanged(ctx);
    return { ok: true };
  });

  ipcMain.handle("awareness:acknowledge-signal", async (_event, id: string) => {
    await store.updateSignalStatus(id, "acknowledged");
    broadcastAwarenessChanged(ctx);
    return { ok: true };
  });

  // ─── Standing Orders ───

  ipcMain.handle("standing-order:list", async (_event, scope?: { kind: string; ownerId?: string }) => {
    const orders = await standingOrders.list(scope as any);
    return { items: orders };
  });

  ipcMain.handle("standing-order:evaluate-action", async (_event, input: Record<string, unknown>) => {
    const routineId = String(input.routineId ?? "");
    const routine = await store.getRoutine(routineId);
    if (!routine) return { ok: false, error: "routine not found" };
    const orders = await standingOrders.list(routine.scope);
    const policyEngine = createAwarenessPolicyEngine();
    const decision = policyEngine.evaluateAction(
      input.action as any,
      routine,
      orders,
      input.signalSource as any,
    );
    return { ok: true, decision };
  });

  ipcMain.handle("standing-order:create", async (_event, input: Record<string, unknown>) => {
    const order = await standingOrders.create(input as any);
    broadcastAwarenessChanged(ctx);
    return { item: order };
  });

  ipcMain.handle("standing-order:update", async (_event, id: string, input: Record<string, unknown>) => {
    const order = await standingOrders.update(id, input as any);
    broadcastAwarenessChanged(ctx);
    return { item: order };
  });

  ipcMain.handle("standing-order:delete", async (_event, id: string) => {
    await standingOrders.remove(id);
    broadcastAwarenessChanged(ctx);
    return { ok: true };
  });

  // ─── Long Run Ledger ───

  ipcMain.handle("long-run:list", async (_event, query?: { kind?: string; status?: string; limit?: number }) => {
    const records = await ledger.listRecords(query as any);
    return { items: records };
  });

  ipcMain.handle("long-run:detail", async (_event, id: string) => {
    const record = await ledger.getRecord(id);
    const auditEvents = record ? await ledger.listAuditEvents(id) : [];
    return { record, auditEvents };
  });

  ipcMain.handle("long-run:cancel", async (_event, id: string) => {
    await ledger.finishRecord(id, "cancelled", { summary: "用户取消" });
    return { ok: true };
  });

  ipcMain.handle("long-run:retry", async (_event, id: string) => {
    const record = await ledger.getRecord(id);
    if (!record) return { ok: false };
    if (record.kind === "awareness_routine") {
      await runtime.runRoutineNow(record.sourceId);
    }
    return { ok: true };
  });
}

function broadcastAwarenessChanged(ctx: RuntimeContext): void {
  const { BrowserWindow } = require("electron") as { BrowserWindow: typeof Electron.BrowserWindow };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("session:stream", {
      id: `awareness-${Date.now()}`,
      type: "awareness.changed",
      createdAt: new Date().toISOString(),
      payload: {},
    });
  }
}
