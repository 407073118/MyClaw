import React, { useMemo, useState } from "react";
import { Pause, Play, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";

import { useWorkspaceStore } from "../../stores/workspace";
import AwarenessSignalList, { type AwarenessSignalView } from "./AwarenessSignalList";

type RoutineView = {
  id: string;
  name: string;
  purpose: string;
  cadenceMinutes: number;
  status: string;
  consecutiveFailures: number;
  lastRunAt?: string;
  nextRunAt?: string;
  lastSkippedReason?: string;
};

/** 管理值守规则、运行状态和待处理信号。 */
export default function AwarenessRoutineManager() {
  const snapshot = useWorkspaceStore((state) => state.time.awarenessSnapshot) as {
    routines?: RoutineView[];
    activeSignals?: AwarenessSignalView[];
    failedRoutineCount?: number;
    pendingApprovals?: number;
  } | null;
  const createRoutine = useWorkspaceStore((state) => state.createAwarenessRoutine);
  const updateRoutine = useWorkspaceStore((state) => state.updateAwarenessRoutine);
  const deleteRoutine = useWorkspaceStore((state) => state.deleteAwarenessRoutine);
  const pauseRoutine = useWorkspaceStore((state) => state.pauseAwarenessRoutine);
  const resumeRoutine = useWorkspaceStore((state) => state.resumeAwarenessRoutine);
  const runRoutineNow = useWorkspaceStore((state) => state.runAwarenessRoutineNow);

  const routines = snapshot?.routines ?? [];
  const activeSignals = useMemo(
    () => (snapshot?.activeSignals ?? []).filter((signal) => signal.status === "active"),
    [snapshot?.activeSignals],
  );
  const [draft, setDraft] = useState({
    name: "",
    purpose: "",
    cadenceMinutes: 30,
    maxModelCallsPerRoutinePerDay: 10,
    notifyOnDecision: true,
    deliveryChannel: "today_catchup",
    catchUpMode: "once",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", purpose: "", cadenceMinutes: 30 });

  /** 创建个人值守规则，默认接入完整后台信号源。 */
  function handleCreate() {
    if (!draft.name.trim()) return;
    void createRoutine({
      name: draft.name.trim(),
      scope: { kind: "personal" },
      purpose: draft.purpose.trim() || "自动检查日程、任务和后台运行状态。",
      cadenceMinutes: draft.cadenceMinutes,
      budgetPolicy: {
        maxModelCallsPerRoutinePerDay: draft.maxModelCallsPerRoutinePerDay,
      },
      deliveryPolicy: {
        notifyOnDecision: draft.notifyOnDecision,
        deliveryChannel: draft.deliveryChannel,
      },
      catchUpPolicy: {
        mode: draft.catchUpMode,
      },
    });
    setDraft({
      name: "",
      purpose: "",
      cadenceMinutes: 30,
      maxModelCallsPerRoutinePerDay: 10,
      notifyOnDecision: true,
      deliveryChannel: "today_catchup",
      catchUpMode: "once",
    });
  }

  /** 进入行内编辑模式，避免弹窗打断时间规划工作流。 */
  function startEdit(routine: RoutineView) {
    setEditingId(routine.id);
    setEditDraft({
      name: routine.name,
      purpose: routine.purpose,
      cadenceMinutes: routine.cadenceMinutes,
    });
  }

  /** 保存值守规则基础配置。 */
  function saveEdit() {
    if (!editingId) return;
    void updateRoutine(editingId, editDraft);
    setEditingId(null);
  }

  return (
    <div className="awareness-panel">
      <section className="awareness-band">
        <div className="awareness-band__header">
          <div>
            <h3>值守规则</h3>
            <p>{routines.length} 个规则，{activeSignals.length} 个待处理信号</p>
          </div>
          <span className={activeSignals.length > 0 ? "awareness-pill awareness-pill--warn" : "awareness-pill"}>
            {activeSignals.length > 0 ? "需要关注" : "运行正常"}
          </span>
        </div>

        <div className="awareness-create-row">
          <input className="form-input" placeholder="值守名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <input className="form-input" placeholder="值守目的" value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} />
          <input className="form-input" type="number" min={5} max={1440} value={draft.cadenceMinutes} onChange={(event) => setDraft({ ...draft, cadenceMinutes: Number(event.target.value) || 30 })} />
          <button type="button" className="btn-premium" onClick={handleCreate} title="新建值守">
            <Plus size={14} /> 新建
          </button>
        </div>
        <div className="awareness-guardrails" aria-label="值守护栏设置">
          <label>
            <span>单规则每日模型预算</span>
            <input className="form-input" type="number" min={0} max={200} value={draft.maxModelCallsPerRoutinePerDay} onChange={(event) => setDraft({ ...draft, maxModelCallsPerRoutinePerDay: Number(event.target.value) || 0 })} />
          </label>
          <label>
            <span>补跑策略</span>
            <select className="form-input" value={draft.catchUpMode} onChange={(event) => setDraft({ ...draft, catchUpMode: event.target.value })}>
              <option value="once">只补一次</option>
              <option value="skip_missed">跳过错过周期</option>
              <option value="run_all_due">运行所有到期</option>
            </select>
          </label>
          <label>
            <span>投递目标</span>
            <select className="form-input" value={draft.deliveryChannel} onChange={(event) => setDraft({ ...draft, deliveryChannel: event.target.value })}>
              <option value="today_catchup">今日补看</option>
              <option value="dock_badge">入口徽标</option>
              <option value="chat_card">会话卡片</option>
              <option value="silent">静默</option>
            </select>
          </label>
          <label className="awareness-guardrails__check">
            <input type="checkbox" checked={draft.notifyOnDecision} onChange={(event) => setDraft({ ...draft, notifyOnDecision: event.target.checked })} />
            <span>有决策时通知</span>
          </label>
        </div>

        <div className="awareness-routine-list">
          {routines.map((routine) => (
            <div key={routine.id} className="awareness-routine-row">
              {editingId === routine.id ? (
                <>
                  <input className="form-input" value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                  <input className="form-input" value={editDraft.purpose} onChange={(event) => setEditDraft({ ...editDraft, purpose: event.target.value })} />
                  <input className="form-input" type="number" min={5} max={1440} value={editDraft.cadenceMinutes} onChange={(event) => setEditDraft({ ...editDraft, cadenceMinutes: Number(event.target.value) || 30 })} />
                  <button type="button" className="icon-btn" title="保存" onClick={saveEdit}><Save size={14} /></button>
                  <button type="button" className="icon-btn" title="取消" onClick={() => setEditingId(null)}><X size={14} /></button>
                </>
              ) : (
                <>
                  <span className={`awareness-status awareness-status--${routine.status}`} />
                  <div className="awareness-routine-row__body">
                    <strong>{routine.name}</strong>
                    <p>{routine.purpose}</p>
                    <span>{routine.cadenceMinutes} 分钟一次 · {statusLabel(routine.status)}{routine.lastSkippedReason ? ` · ${skipLabel(routine.lastSkippedReason)}` : ""}</span>
                  </div>
                  <button type="button" className="icon-btn" title="立即运行" onClick={() => runRoutineNow(routine.id)}><RotateCcw size={14} /></button>
                  {routine.status === "enabled" ? (
                    <button type="button" className="icon-btn" title="暂停" onClick={() => pauseRoutine(routine.id)}><Pause size={14} /></button>
                  ) : (
                    <button type="button" className="icon-btn" title="恢复" onClick={() => resumeRoutine(routine.id)}><Play size={14} /></button>
                  )}
                  <button type="button" className="icon-btn" title="编辑" onClick={() => startEdit(routine)}><Save size={14} /></button>
                  <button type="button" className="icon-btn" title="删除" onClick={() => deleteRoutine(routine.id)}><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="awareness-band">
        <div className="awareness-band__header">
          <div>
            <h3>待处理信号</h3>
            <p>按来源状态自动合并，重复信号会累计次数。</p>
          </div>
        </div>
        <AwarenessSignalList signals={activeSignals} />
      </section>
      <style>{`
        .awareness-panel { display: flex; flex-direction: column; gap: 14px; }
        .awareness-band { border: 1px solid var(--glass-border); border-radius: 8px; padding: 14px; background: var(--bg-card); }
        .awareness-band__header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; align-items: center; }
        .awareness-band__header h3 { margin: 0; font-size: 15px; color: var(--text-primary); }
        .awareness-band__header p { margin: 3px 0 0; color: var(--text-muted); font-size: 12px; }
        .awareness-pill { border-radius: 999px; padding: 3px 9px; background: rgba(16,163,127,0.16); color: var(--status-green, #10a37f); font-size: 12px; white-space: nowrap; }
        .awareness-pill--warn { background: rgba(245,158,11,0.16); color: var(--status-yellow, #f59e0b); }
        .awareness-create-row { display: grid; grid-template-columns: minmax(120px, 0.8fr) minmax(180px, 1.4fr) 86px auto; gap: 8px; margin-bottom: 12px; }
        .awareness-guardrails { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }
        .awareness-guardrails label { display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); font-size: 11px; }
        .awareness-guardrails__check { justify-content: end; }
        .awareness-guardrails__check input { align-self: flex-start; }
        .awareness-routine-list { display: flex; flex-direction: column; gap: 8px; }
        .awareness-routine-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) repeat(4, auto); gap: 8px; align-items: center; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); }
        .awareness-routine-row__body { min-width: 0; }
        .awareness-routine-row__body strong { display: block; color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
        .awareness-routine-row__body p { margin: 2px 0; color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
        .awareness-routine-row__body span { color: var(--text-muted); font-size: 11px; }
        .awareness-status { width: 8px; height: 8px; border-radius: 999px; background: var(--text-muted); }
        .awareness-status--enabled { background: var(--status-green, #10a37f); }
        .awareness-status--paused { background: var(--text-muted); }
        .awareness-status--failed { background: var(--status-red, #ef4444); }
        @media (max-width: 900px) { .awareness-create-row, .awareness-routine-row { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

/** 转换值守状态标签。 */
function statusLabel(status: string): string {
  return ({ enabled: "运行中", paused: "已暂停", failed: "异常", disabled: "已禁用" } as Record<string, string>)[status] ?? status;
}

/** 转换跳过原因标签。 */
function skipLabel(reason: string): string {
  return ({
    no_signal: "无信号",
    outside_active_hours: "活跃时段外",
    budget_exceeded: "预算已用尽",
    queue_busy: "静默等待",
    no_due_task: "无到期任务",
  } as Record<string, string>)[reason] ?? reason;
}
