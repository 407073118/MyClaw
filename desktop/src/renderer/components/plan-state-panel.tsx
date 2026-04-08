import React, { useEffect, useRef, useState } from "react";
import type { Task } from "@shared/contracts";

type PlanStatePanelProps = {
  tasks?: Task[];
};

const TASK_V2_STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

const TASK_V2_STYLES = `
  .task-v2-bar { flex-shrink: 0; padding: 0 24px 4px; }
  .task-v2-bar-inner { max-width: 800px; margin: 0 auto; border: 1px solid var(--glass-border); border-radius: var(--radius-lg); background: var(--bg-card); overflow: hidden; }

  .task-v2-summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; list-style: none; user-select: none; }
  .task-v2-summary::-webkit-details-marker { display: none; }
  .task-v2-summary::marker { display: none; content: ""; }

  .task-v2-chevron { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-muted); transition: transform 0.2s ease; }
  .task-v2-details[open] .task-v2-chevron { transform: rotate(180deg); }

  .task-v2-progress-label { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
  .task-v2-progress-bar { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; min-width: 60px; }
  .task-v2-progress-fill { height: 100%; border-radius: 2px; background: var(--accent-cyan); transition: width 0.3s ease; }

  .task-v2-body { padding: 0 14px 12px; max-height: 240px; overflow-y: auto; }
  .task-v2-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .task-v2-task { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: var(--radius-md); font-size: 13px; }
  .task-v2-task-icon { flex-shrink: 0; width: 18px; text-align: center; font-size: 12px; line-height: 20px; }
  .task-v2-task-icon[data-status="pending"] { color: var(--text-muted); }
  .task-v2-task-icon[data-status="in_progress"] { color: var(--accent-cyan); }
  .task-v2-task-icon[data-status="completed"] { color: var(--status-green); }
  .task-v2-task-title { color: var(--text-primary); line-height: 20px; }
  .task-v2-task-title[data-status="completed"] { color: var(--text-muted); text-decoration: line-through; }
  .task-v2-task-status { flex-shrink: 0; margin-left: auto; font-size: 11px; color: var(--text-muted); }
`;

/** Task V2 进度面板 — 紧贴输入框上方的紧凑可折叠栏（仅用于普通对话的任务追踪）。 */
export function PlanStatePanel({ tasks }: PlanStatePanelProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const prevCountRef = useRef(tasks?.length ?? 0);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  const items = tasks ?? [];
  const total = items.length;
  const completed = items.filter((t) => t.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const activeTask = items.find((t) => t.status === "in_progress");

  // 自动展开：任务数量增加时
  useEffect(() => {
    if (items.length > prevCountRef.current && detailsRef.current) {
      detailsRef.current.open = true;
      setAutoCollapsed(false);
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  // 自动折叠：全部完成后 5s
  useEffect(() => {
    if (total > 0 && completed === total && !autoCollapsed) {
      const timer = setTimeout(() => {
        if (detailsRef.current) {
          detailsRef.current.open = false;
        }
        setAutoCollapsed(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [total, completed, autoCollapsed]);

  if (total === 0) return null;

  return (
    <>
      <div className="task-v2-bar">
        <details ref={detailsRef} className="task-v2-bar-inner task-v2-details" data-testid="task-v2-panel" open>
          <summary className="task-v2-summary">
            <svg className="task-v2-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>

            <span className="task-v2-progress-label">
              {completed}/{total} 已完成
            </span>

            <div className="task-v2-progress-bar">
              <div className="task-v2-progress-fill" style={{ width: `${pct}%` }} />
            </div>

            {activeTask && (
              <span style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                {activeTask.activeForm ?? activeTask.subject}
              </span>
            )}
          </summary>

          <div className="task-v2-body">
            <ol className="task-v2-list">
              {items.map((task) => (
                <li key={task.id} className="task-v2-task" data-testid={`task-v2-${task.id}`}>
                  <span className="task-v2-task-icon" data-status={task.status}>
                    {TASK_V2_STATUS_ICONS[task.status] ?? "○"}
                  </span>
                  <span className="task-v2-task-title" data-status={task.status}>
                    {task.subject}
                  </span>
                  {task.status === "in_progress" && (
                    <span className="task-v2-task-status">进行中</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>
      <style>{TASK_V2_STYLES}</style>
    </>
  );
}

export default PlanStatePanel;
