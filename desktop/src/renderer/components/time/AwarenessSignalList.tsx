import React from "react";
import { Check, EyeOff } from "lucide-react";

import { useWorkspaceStore } from "../../stores/workspace";

export type AwarenessSignalView = {
  id: string;
  sourceKind: string;
  severity: string;
  title?: string;
  summary: string;
  status: string;
  createdAt: string;
  occurrenceCount?: number;
};

const SOURCE_LABELS: Record<string, string> = {
  agent_task: "员工任务",
  schedule_job: "定时任务",
  workflow_run: "工作流",
  background_task: "后台任务",
  session_stuck: "会话",
  approval_pending: "审批",
  system_health: "系统",
};

/** 展示并处理值守信号，提供确认和冷却忽略操作。 */
export default function AwarenessSignalList({ signals }: { signals: AwarenessSignalView[] }) {
  const dismiss = useWorkspaceStore((state) => state.dismissAwarenessSignal);
  const acknowledge = useWorkspaceStore((state) => state.acknowledgeAwarenessSignal);

  if (signals.length === 0) {
    return <p className="awareness-empty">当前没有待处理信号。</p>;
  }

  return (
    <div className="awareness-signal-list">
      {signals.map((signal) => (
        <div key={signal.id} className="awareness-signal-row">
          <span className={`awareness-severity awareness-severity--${signal.severity}`} />
          <div className="awareness-signal-row__body">
            <div className="awareness-signal-row__meta">
              <span>{SOURCE_LABELS[signal.sourceKind] ?? signal.sourceKind}</span>
              <span>{formatTime(signal.createdAt)}</span>
              {signal.occurrenceCount && signal.occurrenceCount > 1 ? <span>{signal.occurrenceCount} 次</span> : null}
            </div>
            <strong>{signal.title ?? signal.summary}</strong>
            {signal.title ? <p>{signal.summary}</p> : null}
          </div>
          <div className="awareness-signal-row__actions">
            <button type="button" className="icon-btn" title="标记已知晓" onClick={() => acknowledge(signal.id)}>
              <Check size={14} />
            </button>
            <button type="button" className="icon-btn" title="暂时不再提醒" onClick={() => dismiss(signal.id)}>
              <EyeOff size={14} />
            </button>
          </div>
        </div>
      ))}
      <style>{`
        .awareness-empty { margin: 0; color: var(--text-muted); font-size: 13px; }
        .awareness-signal-list { display: flex; flex-direction: column; gap: 8px; }
        .awareness-signal-row {
          display: grid; grid-template-columns: 10px minmax(0, 1fr) auto;
          gap: 10px; align-items: center; padding: 10px 12px;
          border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
          border-radius: 8px; background: var(--bg-card, rgba(255,255,255,0.03));
        }
        .awareness-severity { width: 8px; height: 8px; border-radius: 999px; background: var(--text-muted); }
        .awareness-severity--critical { background: var(--status-red, #ef4444); }
        .awareness-severity--warning { background: var(--status-yellow, #f59e0b); }
        .awareness-severity--info { background: var(--status-green, #10a37f); }
        .awareness-signal-row__body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .awareness-signal-row__body strong {
          color: var(--text-primary); font-size: 13px; font-weight: 600;
          overflow-wrap: anywhere;
        }
        .awareness-signal-row__body p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
        .awareness-signal-row__meta { display: flex; gap: 8px; color: var(--text-muted); font-size: 11px; flex-wrap: wrap; }
        .awareness-signal-row__actions { display: flex; gap: 4px; }
      `}</style>
    </div>
  );
}

/** 格式化值守信号时间，异常输入直接回退原文。 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
