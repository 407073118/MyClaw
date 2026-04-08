import React from "react";
import type { PlanState } from "@shared/contracts";

type PlanSidePanelProps = {
  planState?: PlanState | null;
  planModeState?: {
    mode?: string;
    approvalStatus?: string;
    planVersion?: number;
    currentTaskTitle?: string;
    currentTaskKind?: string;
    workflowRun?: { status?: string; currentNodeIds?: string[] } | null;
    workstreams?: Array<{
      id: string;
      label: string;
      status: string;
      stepIds: string[];
    }>;
  } | null;
  onApprove?: (() => void | Promise<void>) | null;
  onRevise?: (() => void | Promise<void>) | null;
  onCancel?: (() => void | Promise<void>) | null;
};

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<string, string> = {
  planning: "计划中",
  analysis: "分析中",
  awaiting_approval: "待批准",
  executing: "执行中",
  completed: "已完成",
  blocked: "已阻塞",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "已阻塞",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  blocked: "✕",
};

const KIND_LABELS: Record<string, string> = {
  analysis: "分析",
  tool: "工具",
  verification: "验证",
  user_confirmation: "确认",
};

// ---------------------------------------------------------------------------
// 样式
// ---------------------------------------------------------------------------

const STYLES = `
  .plan-side-panel {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--glass-border);
    background: var(--bg-card);
    height: 100%;
    overflow: hidden;
  }

  /* ---- header ---- */
  .psp-header {
    padding: 16px;
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }
  .psp-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .psp-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }
  .psp-version {
    font-size: 11px;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .psp-mode-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    margin-left: auto;
    background: rgba(45,212,191,0.12);
    color: var(--accent-cyan);
  }
  .psp-mode-pill[data-mode="awaiting_approval"] { background: rgba(245,158,11,0.14); color: #f59e0b; }
  .psp-mode-pill[data-mode="executing"] { background: rgba(59,130,246,0.14); color: #60a5fa; }
  .psp-mode-pill[data-mode="completed"] { background: rgba(34,197,94,0.14); color: #22c55e; }
  .psp-mode-pill[data-mode="blocked"] { background: rgba(239,68,68,0.14); color: var(--status-red); }

  /* ---- progress ---- */
  .psp-progress {
    padding: 12px 16px;
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }
  .psp-progress-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .psp-progress-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .psp-progress-bar {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: rgba(255,255,255,0.08);
    overflow: hidden;
  }
  .psp-progress-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--accent-cyan);
    transition: width 0.3s ease;
  }
  .psp-current-step {
    font-size: 12px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .psp-current-step-label {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 4px;
  }

  /* ---- workstreams ---- */
  .psp-workstreams {
    padding: 10px 16px;
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex-shrink: 0;
  }
  .psp-workstream {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--text-secondary);
    font-size: 11px;
  }
  .psp-workstream strong { color: var(--text-primary); }

  /* ---- task list ---- */
  .psp-tasks {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }
  .psp-task-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .psp-task {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 8px;
    border-radius: var(--radius-md);
    font-size: 13px;
    transition: background 0.15s ease;
  }
  .psp-task[data-active="true"] {
    background: rgba(45,212,191,0.06);
  }
  .psp-task-icon {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    font-size: 12px;
    line-height: 20px;
  }
  .psp-task-icon[data-status="pending"] { color: var(--text-muted); }
  .psp-task-icon[data-status="in_progress"] { color: var(--accent-cyan); }
  .psp-task-icon[data-status="completed"] { color: var(--status-green); }
  .psp-task-icon[data-status="blocked"] { color: var(--status-red); }
  .psp-task-title {
    flex: 1;
    color: var(--text-primary);
    line-height: 20px;
    min-width: 0;
  }
  .psp-task-title[data-status="completed"] {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .psp-task-kind {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
    color: var(--text-muted);
    line-height: 16px;
  }
  .psp-task-status {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 20px;
  }

  /* ---- actions ---- */
  .psp-actions {
    padding: 12px 16px;
    border-top: 1px solid var(--glass-border);
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .psp-btn {
    flex: 1;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
  }
  .psp-btn:hover { background: rgba(255,255,255,0.06); }
  .psp-btn--primary {
    background: rgba(45,212,191,0.15);
    color: var(--accent-cyan);
    border-color: rgba(45,212,191,0.2);
  }
  .psp-btn--primary:hover { background: rgba(45,212,191,0.25); }
  .psp-btn--danger {
    color: var(--status-red);
    border-color: rgba(239,68,68,0.18);
  }
  .psp-btn--danger:hover { background: rgba(239,68,68,0.08); }

  /* ---- workflow status ---- */
  .psp-workflow-status {
    padding: 10px 16px;
    border-bottom: 1px solid var(--glass-border);
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .psp-workflow-status-label {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/** Plan Mode 侧边面板 — 右侧独立面板展示完整计划状态。 */
export function PlanSidePanel({
  planState,
  planModeState,
  onApprove,
  onRevise,
  onCancel,
}: PlanSidePanelProps) {
  if (!planState || planState.tasks.length === 0) return null;

  const mode = planModeState?.mode;
  const modeLabel = mode ? (MODE_LABELS[mode] ?? mode) : null;
  const showApproval = mode === "awaiting_approval";
  const showCancel = mode === "executing" || mode === "awaiting_approval" || mode === "planning";

  const total = planState.tasks.length;
  const completed = planState.tasks.filter((t) => t.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const workflowStatus = (planModeState?.workflowRun as { status?: string } | null | undefined)?.status;

  return (
    <>
      <aside className="plan-side-panel" data-testid="plan-side-panel">
        {/* Header */}
        <div className="psp-header">
          <div className="psp-header-row">
            <h2 className="psp-title">执行计划</h2>
            {typeof planModeState?.planVersion === "number" && (
              <span className="psp-version" data-testid="plan-version-label">v{planModeState.planVersion}</span>
            )}
            {modeLabel && (
              <span className="psp-mode-pill" data-mode={mode} data-testid="plan-mode-pill">
                {modeLabel}
              </span>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="psp-progress">
          <div className="psp-progress-row">
            <span className="psp-progress-label">{completed}/{total} 已完成</span>
            <div className="psp-progress-bar">
              <div className="psp-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          {planModeState?.currentTaskTitle && (
            <div className="psp-current-step" data-testid="plan-current-step">
              <span className="psp-current-step-label">当前:</span>
              {planModeState.currentTaskTitle}
              {planModeState.currentTaskKind ? ` (${planModeState.currentTaskKind})` : ""}
            </div>
          )}
        </div>

        {/* Workflow run status */}
        {workflowStatus && (
          <div className="psp-workflow-status" data-testid="plan-workflow-run-status">
            <span className="psp-workflow-status-label">运行:</span>
            {workflowStatus}
          </div>
        )}

        {/* Workstreams */}
        {!!planModeState?.workstreams?.length && (
          <div className="psp-workstreams">
            {planModeState.workstreams.map((ws) => (
              <span key={ws.id} className="psp-workstream" data-testid={`plan-workstream-${ws.id}`}>
                <strong>{ws.label}</strong>
                <span>{ws.status}</span>
              </span>
            ))}
          </div>
        )}

        {/* Task list */}
        <div className="psp-tasks">
          <ol className="psp-task-list">
            {planState.tasks.map((task) => (
              <li
                key={task.id}
                className="psp-task"
                data-testid={`plan-task-${task.id}`}
                data-active={task.status === "in_progress" ? "true" : undefined}
              >
                <span
                  className="psp-task-icon"
                  data-status={task.status}
                  data-testid={`plan-task-status-${task.id}`}
                >
                  {STATUS_ICONS[task.status] ?? "○"}
                </span>
                <span className="psp-task-title" data-status={task.status}>
                  {task.title}
                </span>
                {(task as { kind?: string }).kind && (
                  <span className="psp-task-kind">
                    {KIND_LABELS[(task as { kind: string }).kind] ?? (task as { kind: string }).kind}
                  </span>
                )}
                {task.status !== "pending" && task.status !== "completed" && (
                  <span className="psp-task-status">{STATUS_LABELS[task.status] ?? task.status}</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* Actions */}
        {(showApproval || showCancel) && (
          <div className="psp-actions">
            {showApproval && onApprove && (
              <button
                type="button"
                className="psp-btn psp-btn--primary"
                data-testid="plan-approve-button"
                onClick={() => { void onApprove(); }}
              >
                批准执行
              </button>
            )}
            {showApproval && onRevise && (
              <button
                type="button"
                className="psp-btn"
                data-testid="plan-revise-button"
                onClick={() => { void onRevise(); }}
              >
                完善
              </button>
            )}
            {showCancel && onCancel && (
              <button
                type="button"
                className="psp-btn psp-btn--danger"
                data-testid="plan-cancel-button"
                onClick={() => { void onCancel(); }}
              >
                取消
              </button>
            )}
          </div>
        )}
      </aside>
      <style>{STYLES}</style>
    </>
  );
}

export default PlanSidePanel;
