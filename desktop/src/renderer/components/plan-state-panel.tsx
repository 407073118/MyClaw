import React from "react";
import type { PlanState } from "@shared/contracts";

type PlanStatePanelProps = {
  planState?: PlanState | null;
};

const KNOWN_PLAN_TASK_STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "阻塞",
};

const PLAN_STATE_PANEL_STYLES = `
  .plan-state-panel { display: grid; gap: 16px; padding: 18px 20px; border-radius: var(--radius-lg); border: 1px solid var(--glass-border); background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015)); }
  .plan-state-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .plan-state-panel-copy { display: grid; gap: 4px; }
  .plan-state-panel-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .plan-state-panel-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .plan-state-panel-updated-at { font-size: 12px; color: var(--text-muted); word-break: break-all; text-align: right; }
  .plan-state-task-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .plan-state-task { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--radius-md); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); }
  .plan-state-task-status { min-width: 92px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); color: var(--text-primary); font-size: 12px; font-weight: 600; line-height: 1.2; text-align: center; font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
  .plan-state-task-status[data-status="pending"] { color: var(--text-muted); }
  .plan-state-task-status[data-status="in_progress"] { color: var(--accent-cyan); }
  .plan-state-task-status[data-status="completed"] { color: var(--status-green); }
  .plan-state-task-status[data-status="blocked"] { color: var(--status-red); }
  .plan-state-task-copy { display: grid; gap: 4px; min-width: 0; }
  .plan-state-task-copy strong { color: var(--text-primary); font-size: 14px; }
  .plan-state-task-copy p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
  .plan-state-task-blocker { color: var(--status-red); }
`;

/** 仅在渲染层翻译已知状态，未知未来状态保持原始 token 便于兼容调试。 */
function formatPlanTaskStatus(status: string): string {
  return KNOWN_PLAN_TASK_STATUS_LABELS[status] ?? status;
}

/** 以只读调试面板形式展示最小计划状态，避免引入额外的规划交互假设。 */
export function PlanStatePanel({ planState }: PlanStatePanelProps) {
  if (!planState || planState.tasks.length === 0) return null;

  return (
    <>
      <aside className="plan-state-panel" data-testid="plan-state-panel" aria-label="计划状态">
        <div className="plan-state-panel-header">
          <div className="plan-state-panel-copy">
            <span className="plan-state-panel-eyebrow">调试视图</span>
            <h2 className="plan-state-panel-title">计划状态</h2>
          </div>
          <time className="plan-state-panel-updated-at" dateTime={planState.updatedAt}>
            {planState.updatedAt}
          </time>
        </div>

        <ol className="plan-state-task-list">
          {planState.tasks.map((task) => (
            <li key={task.id} className="plan-state-task" data-testid={`plan-task-${task.id}`}>
              <span
                className="plan-state-task-status"
                data-status={task.status}
                data-testid={`plan-task-status-${task.id}`}
              >
                {formatPlanTaskStatus(task.status)}
              </span>
              <div className="plan-state-task-copy">
                <strong>{task.title}</strong>
                {task.detail && <p>{task.detail}</p>}
                {task.blocker && <p className="plan-state-task-blocker">阻塞: {task.blocker}</p>}
              </div>
            </li>
          ))}
        </ol>
      </aside>
      <style>{PLAN_STATE_PANEL_STYLES}</style>
    </>
  );
}

export default PlanStatePanel;
