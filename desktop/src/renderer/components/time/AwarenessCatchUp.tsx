import React, { useMemo } from "react";

import { useWorkspaceStore } from "../../stores/workspace";

type CatchUpSignal = {
  id: string;
  sourceKind: string;
  severity: string;
  summary: string;
  status: string;
  createdAt: string;
};

const EMPTY_DELIVERIES: Array<{ id: string; title: string; body: string; createdAt: string }> = [];

/** 在时间中心侧栏展示最新值守补看事项。 */
export default function AwarenessCatchUp() {
  const snapshot = useWorkspaceStore((state) => state.time?.awarenessSnapshot) as { activeSignals?: CatchUpSignal[] } | null;
  const deliveries = useWorkspaceStore((state) => state.time?.awarenessDeliveries ?? EMPTY_DELIVERIES);
  const activeSignals = useMemo(
    () => (snapshot?.activeSignals ?? []).filter((signal) => signal.status === "active").slice(0, 5),
    [snapshot?.activeSignals],
  );
  const recentDeliveries = deliveries.slice(0, 3);

  if (activeSignals.length === 0 && recentDeliveries.length === 0) return null;

  return (
    <aside className="awareness-catchup">
      <div className="awareness-catchup__header">
        <strong>值守补看</strong>
        <span>{activeSignals.length + recentDeliveries.length}</span>
      </div>
      <div className="awareness-catchup__list">
        {activeSignals.map((signal) => (
          <div key={signal.id} className="awareness-catchup__item">
            <span className={`awareness-catchup__dot awareness-catchup__dot--${signal.severity}`} />
            <div>
              <b>{sourceLabel(signal.sourceKind)}</b>
              <p>{signal.summary}</p>
            </div>
            <time>{timeAgo(signal.createdAt)}</time>
          </div>
        ))}
        {recentDeliveries.map((delivery) => (
          <div key={String(delivery.id)} className="awareness-catchup__item">
            <span className="awareness-catchup__dot" />
            <div>
              <b>{String(delivery.title ?? "值守通知")}</b>
              <p>{String(delivery.body ?? "")}</p>
            </div>
            <time>{timeAgo(String(delivery.createdAt ?? new Date().toISOString()))}</time>
          </div>
        ))}
      </div>
      <style>{`
        .awareness-catchup { border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-card); margin-bottom: 12px; overflow: hidden; }
        .awareness-catchup__header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--glass-border); }
        .awareness-catchup__header strong { color: var(--text-primary); font-size: 13px; }
        .awareness-catchup__header span { min-width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--accent-cyan); color: #fff; font-size: 11px; }
        .awareness-catchup__list { display: flex; flex-direction: column; }
        .awareness-catchup__item { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .awareness-catchup__item:last-child { border-bottom: 0; }
        .awareness-catchup__item b { display: block; color: var(--text-secondary); font-size: 11px; font-weight: 600; }
        .awareness-catchup__item p { margin: 2px 0 0; color: var(--text-primary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .awareness-catchup__item time { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
        .awareness-catchup__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent-cyan); }
        .awareness-catchup__dot--critical { background: var(--status-red, #ef4444); }
        .awareness-catchup__dot--warning { background: var(--status-yellow, #f59e0b); }
        .awareness-catchup__dot--info { background: var(--status-green, #10a37f); }
      `}</style>
    </aside>
  );
}

/** 转换来源标签。 */
function sourceLabel(kind: string): string {
  return ({
    agent_task: "员工任务",
    schedule_job: "定时任务",
    workflow_run: "工作流",
    background_task: "后台任务",
    session_stuck: "会话",
    approval_pending: "审批",
    system_health: "系统",
  } as Record<string, string>)[kind] ?? kind;
}

/** 计算相对时间文案。 */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  return `${Math.floor(diff / 3_600_000)} 小时前`;
}
