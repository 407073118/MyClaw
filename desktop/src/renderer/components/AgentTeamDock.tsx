import React, { useMemo, useState } from "react";
import { CheckCircle2, PanelRightClose, PanelRightOpen, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { AgentTask, SiliconPerson, SiliconPersonStatus } from "@shared/contracts";
import { useWorkspaceStore } from "../stores/workspace";

const STATUS_LABEL: Record<SiliconPersonStatus, string> = {
  idle: "待命",
  running: "执行中",
  needs_approval: "待审批",
  done: "已完成",
  error: "异常",
  canceling: "取消中",
  canceled: "已取消",
};

const TASK_STATUS_LABEL: Record<AgentTask["status"], string> = {
  queued: "排队",
  running: "运行",
  waiting_user: "待我处理",
  succeeded: "完成",
  failed: "异常",
  cancelled: "取消",
};

const TASK_STATUS_PRIORITY: Record<AgentTask["status"], number> = {
  waiting_user: 0,
  failed: 1,
  running: 2,
  queued: 3,
  succeeded: 4,
  cancelled: 5,
};

/** 展示员工头像，点击后进入共享主聊天容器中的员工会话视图。 */
function AgentAvatarButton({
  person,
  compact,
  onClick,
}: {
  person: SiliconPerson;
  compact: boolean;
  onClick: () => void;
}) {
  const initial = (person.name || person.title || "?").charAt(0).toUpperCase();
  const statusLabel = STATUS_LABEL[person.status] ?? person.status;

  return (
    <button
      type="button"
      data-testid={`silicon-rail-avatar-${person.id}`}
      className={["agent-avatar-button", compact ? "agent-avatar-button--compact" : ""].filter(Boolean).join(" ")}
      title={`${person.name} - ${statusLabel}`}
      onClick={onClick}
    >
      <span className="agent-avatar-initial">{initial}</span>
      <span className={`agent-avatar-status agent-avatar-status--${person.status}`} />
      {!compact && (
        <span className="agent-avatar-copy">
          <strong>{person.name}</strong>
          <span>{person.title || statusLabel}</span>
        </span>
      )}
    </button>
  );
}

/** 桌面端右侧 Agent Team Dock，承载 Supervisor + Workers 的任务态势。 */
export default function AgentTeamDock() {
  const navigate = useNavigate();
  const siliconPersons = useWorkspaceStore((state) => state.siliconPersons ?? []);
  const agentTasks = useWorkspaceStore((state) => state.agentTasks ?? []);
  const webPanelOpen = useWorkspaceStore((state) => Boolean(state.webPanel?.isOpen));
  const setActiveSiliconPersonId = useWorkspaceStore((state) => state.setActiveSiliconPersonId);
  const switchSiliconPersonSession = useWorkspaceStore((state) => state.switchSiliconPersonSession);
  const [collapsed, setCollapsed] = useState(true);
  const [panelWidth, setPanelWidth] = useState(292);

  const effectiveCollapsed = collapsed || webPanelOpen;
  const personNameById = useMemo(() => {
    return new Map(siliconPersons.map((person) => [person.id, person.name || person.title || person.id]));
  }, [siliconPersons]);
  const attentionTasks = useMemo(
    () => agentTasks.filter((task) => task.status === "waiting_user" || task.status === "failed"),
    [agentTasks],
  );
  const runningTasks = useMemo(
    () => agentTasks.filter((task) => task.status === "queued" || task.status === "running"),
    [agentTasks],
  );
  const doneTasks = useMemo(
    () => agentTasks.filter((task) => task.status === "succeeded" || task.status === "cancelled"),
    [agentTasks],
  );
  const activeTaskCount = attentionTasks.length + runningTasks.length;
  const visibleTaskQueue = useMemo(() => {
    return [...agentTasks]
      .sort((left, right) => {
        const priorityDelta = TASK_STATUS_PRIORITY[left.status] - TASK_STATUS_PRIORITY[right.status];
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, 8);
  }, [agentTasks]);
  const loadByPerson = useMemo(() => {
    return siliconPersons.map((person) => ({
      person,
      activeCount: runningTasks.filter((task) => task.assigneeIds.includes(person.id)).length,
    }));
  }, [runningTasks, siliconPersons]);

  /** 汇总任务负责人名称，保持任务行在窄面板中仍可快速扫描。 */
  function getTaskAssigneeNames(task: AgentTask): string {
    const names = task.assigneeIds.map((id) => personNameById.get(id) ?? id);
    return names.length > 0 ? names.join(" / ") : "未分配";
  }

  /** 选取任务预览文本，优先暴露需要用户处理的结果和错误。 */
  function getTaskPreview(task: AgentTask): string {
    return task.error ?? task.resultSummary ?? task.instruction;
  }

  /** 点击员工时切回主聊天容器，并把员工设为当前查看对象。 */
  function handleOpenPerson(person: SiliconPerson) {
    console.info("[agent-team-dock] 打开员工会话", {
      siliconPersonId: person.id,
      route: "/",
    });
    setActiveSiliconPersonId(person.id);
    navigate("/");
  }

  /** 点击任务时进入它的员工子会话，优先使用负责人子会话。 */
  function handleOpenTask(task: AgentTask) {
    const assigneeId = task.leadAssigneeId && task.childSessionIds[task.leadAssigneeId]
      ? task.leadAssigneeId
      : task.assigneeIds.find((id) => Boolean(task.childSessionIds[id]));
    if (!assigneeId) {
      console.warn("[agent-team-dock] 任务没有可打开的员工子会话", { taskId: task.id });
      return;
    }
    const sessionId = task.childSessionIds[assigneeId];
    console.info("[agent-team-dock] 打开任务员工子会话", {
      taskId: task.id,
      siliconPersonId: assigneeId,
      sessionId,
    });
    setActiveSiliconPersonId(assigneeId);
    void switchSiliconPersonSession(assigneeId, sessionId).catch((error) => {
      console.error("[agent-team-dock] 切换任务员工子会话失败", {
        taskId: task.id,
        siliconPersonId: assigneeId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    navigate("/");
  }

  /** 拖拽左边缘调整面板宽度，限制在桌面端可读范围内。 */
  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (effectiveCollapsed) return;
    const startX = event.clientX;
    const startWidth = panelWidth;
    console.info("[agent-team-dock] 开始调整宽度", { startWidth });

    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(420, Math.max(260, startWidth - (moveEvent.clientX - startX)));
      setPanelWidth(nextWidth);
    };
    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      console.info("[agent-team-dock] 完成调整宽度", { panelWidth: startWidth });
    };

    document.body.style.cursor = "col-resize";
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp, { once: true });
  }

  return (
    <aside
      data-testid="agent-team-dock"
      className={["agent-team-dock", effectiveCollapsed ? "agent-team-dock--collapsed" : ""].filter(Boolean).join(" ")}
      style={{ width: effectiveCollapsed ? 52 : panelWidth }}
    >
      {!effectiveCollapsed && (
        <div
          className="agent-team-resize"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handleResizePointerDown}
        />
      )}

      <header className="agent-team-header">
        <button
          type="button"
          className="agent-team-toggle"
          aria-label={effectiveCollapsed ? "展开 Agent Team" : "收起 Agent Team"}
          title={effectiveCollapsed ? "展开 Agent Team" : "收起 Agent Team"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {effectiveCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
        </button>
        {!effectiveCollapsed && (
          <div className="agent-team-title">
            <span>Agent Team</span>
            <strong>{activeTaskCount}</strong>
          </div>
        )}
      </header>

      {effectiveCollapsed ? (
        <div className="agent-team-collapsed-list">
          {siliconPersons.slice(0, 7).map((person) => (
            <AgentAvatarButton
              key={person.id}
              person={person}
              compact
              onClick={() => handleOpenPerson(person)}
            />
          ))}
        </div>
      ) : (
        <div className="agent-team-body">
          <section className="agent-team-section agent-team-task-board" data-testid="agent-team-task-board">
            <div className="agent-team-section-title agent-team-task-board-title">
              <span>任务队列</span>
              <strong>{agentTasks.length}</strong>
            </div>
            <div className="agent-team-task-metrics" aria-label="Agent Task 状态概览">
              <span>
                待处理
                <strong data-testid="agent-team-task-count-attention">{attentionTasks.length}</strong>
              </span>
              <span>
                运行
                <strong data-testid="agent-team-task-count-running">{runningTasks.length}</strong>
              </span>
              <span>
                完成
                <strong data-testid="agent-team-task-count-done">{doneTasks.length}</strong>
              </span>
            </div>
            <div className="agent-task-queue-list">
              {visibleTaskQueue.length === 0 ? (
                <span className="agent-team-empty">暂无任务</span>
              ) : (
                <>
                  {visibleTaskQueue.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={`agent-task-queue-row agent-task-queue-row--${task.status}`}
                      data-testid={`agent-team-task-row-${task.id}`}
                      onClick={() => handleOpenTask(task)}
                    >
                      <span className={`agent-task-queue-dot agent-task-queue-dot--${task.status}`} aria-hidden="true" />
                      <span className="agent-task-queue-main">
                        <span className="agent-task-queue-top">
                          <strong>{task.title}</strong>
                          <em data-testid={`agent-team-task-status-${task.id}`}>{TASK_STATUS_LABEL[task.status]}</em>
                        </span>
                        <span className="agent-task-queue-meta" data-testid={`agent-team-task-assignees-${task.id}`}>
                          {getTaskAssigneeNames(task)}
                        </span>
                        <span className="agent-task-queue-preview" data-testid={`agent-team-task-summary-${task.id}`}>
                          {getTaskPreview(task)}
                        </span>
                      </span>
                    </button>
                  ))}
                  {agentTasks.length > visibleTaskQueue.length && (
                    <span className="agent-team-more">还有 {agentTasks.length - visibleTaskQueue.length} 个任务</span>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="agent-team-section agent-team-section--people">
            <div className="agent-team-section-title">
              <Users size={14} />
              <span>员工负载</span>
              <strong>{siliconPersons.length}</strong>
            </div>
            <div className="agent-person-list">
              {loadByPerson.length === 0 ? (
                <span className="agent-team-empty">暂无员工</span>
              ) : loadByPerson.map(({ person, activeCount }) => (
                <button
                  key={person.id}
                  type="button"
                  className="agent-person-row"
                  onClick={() => handleOpenPerson(person)}
                >
                  <span className="agent-person-avatar" aria-hidden="true">
                    {(person.name || person.title || "?").charAt(0).toUpperCase()}
                    <span className={`agent-person-avatar-dot agent-person-avatar-dot--${person.status}`} />
                  </span>
                  <span className="agent-person-main">
                    <strong>{person.name}</strong>
                    <em>{STATUS_LABEL[person.status] ?? person.status}</em>
                  </span>
                  <AwarenessBadge personId={person.id} />
                  <span className="agent-person-load">{activeCount}</span>
                </button>
              ))}
            </div>
          </section>

          <footer className="agent-team-footer">
            <CheckCircle2 size={14} />
            <span>用户是 Leader，员工只在 @ 指定或确认后执行</span>
          </footer>
        </div>
      )}

      <style>{`
        .agent-team-dock {
          position: relative;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          min-width: 52px;
          max-width: 420px;
          height: 100%;
          background: color-mix(in srgb, var(--bg-sidebar) 92%, #0f172a 8%);
          border-left: 1px solid var(--glass-border);
          overflow: hidden;
          z-index: 90;
        }
        .agent-team-resize {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 6px;
          cursor: col-resize;
          z-index: 2;
        }
        .agent-team-resize:hover {
          background: rgba(148,163,184,0.16);
        }
        .agent-team-header {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 48px;
          padding: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .agent-team-toggle {
          width: 36px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: 1px solid var(--glass-border);
          background: rgba(255,255,255,0.035);
          color: var(--text-secondary);
          cursor: pointer;
        }
        .agent-team-toggle:hover {
          color: var(--text-primary);
          border-color: var(--glass-border-hover);
          background: rgba(255,255,255,0.055);
        }
        .agent-team-title {
          min-width: 0;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 700;
        }
        .agent-team-title strong,
        .agent-team-section-title strong,
        .agent-person-load {
          min-width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: rgba(16,163,127,0.13);
          color: var(--accent-cyan);
          font-size: 11px;
        }
        .agent-team-collapsed-list {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 8px 0;
          overflow-y: auto;
        }
        .agent-team-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 0;
          flex: 1;
          padding: 10px;
          overflow-y: auto;
        }
        .agent-team-section {
          display: grid;
          gap: 8px;
          padding: 10px;
          border: 1px solid rgba(148,163,184,0.16);
          border-radius: 8px;
          background: rgba(255,255,255,0.025);
        }
        .agent-team-section-title {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
        }
        .agent-team-section-title span {
          min-width: 0;
          flex: 1;
        }
        .agent-task-queue-list,
        .agent-person-list {
          display: grid;
          gap: 6px;
        }
        .agent-task-queue-row,
        .agent-person-row {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border-radius: 7px;
          border: 1px solid rgba(148,163,184,0.12);
          background: rgba(0,0,0,0.12);
        }
        .agent-team-task-board {
          background: rgba(255,255,255,0.032);
        }
        .agent-team-task-metrics {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }
        .agent-team-task-metrics span {
          min-width: 0;
          display: grid;
          gap: 3px;
          padding: 7px;
          border: 1px solid rgba(148,163,184,0.12);
          border-radius: 7px;
          background: rgba(0,0,0,0.12);
          color: var(--text-muted);
          font-size: 10px;
          line-height: 1.2;
        }
        .agent-team-task-metrics strong {
          color: var(--text-primary);
          font-size: 15px;
          line-height: 1;
        }
        .agent-task-queue-row {
          width: 100%;
          text-align: left;
          color: inherit;
          cursor: pointer;
          font-family: inherit;
        }
        .agent-task-queue-row:hover {
          border-color: rgba(148,163,184,0.28);
          background: rgba(255,255,255,0.04);
        }
        .agent-task-queue-row--waiting_user,
        .agent-task-queue-row--failed {
          border-color: rgba(245,158,11,0.24);
        }
        .agent-task-queue-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--text-muted);
          flex-shrink: 0;
          align-self: flex-start;
          margin-top: 7px;
        }
        .agent-task-queue-dot--queued,
        .agent-task-queue-dot--running {
          background: var(--accent-cyan);
        }
        .agent-task-queue-dot--waiting_user,
        .agent-task-queue-dot--failed {
          background: var(--status-yellow);
        }
        .agent-task-queue-dot--succeeded {
          background: var(--status-green);
        }
        .agent-task-queue-main {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 3px;
        }
        .agent-task-queue-top {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .agent-task-queue-top strong {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
          font-size: 12px;
        }
        .agent-task-queue-top em,
        .agent-person-main em {
          flex-shrink: 0;
          color: var(--text-muted);
          font-size: 11px;
          font-style: normal;
        }
        .agent-task-queue-meta,
        .agent-task-queue-preview {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.3;
        }
        .agent-task-queue-preview {
          color: var(--text-secondary);
        }
        .agent-team-more {
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.4;
        }
        .agent-person-row {
          width: 100%;
          text-align: left;
          color: inherit;
          cursor: pointer;
        }
        .agent-person-row:hover {
          border-color: rgba(148,163,184,0.28);
          background: rgba(255,255,255,0.04);
        }
        .agent-person-main {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 2px;
        }
        .agent-person-avatar {
          position: relative;
          width: 34px;
          height: 34px;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: 1px solid rgba(148,163,184,0.24);
          background: rgba(255,255,255,0.045);
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 800;
        }
        .agent-person-avatar-dot {
          position: absolute;
          right: -1px;
          bottom: -1px;
          width: 9px;
          height: 9px;
          border-radius: 999px;
          border: 2px solid var(--bg-sidebar);
          background: var(--text-muted);
        }
        .agent-person-avatar-dot--running,
        .agent-person-avatar-dot--needs_approval,
        .agent-person-avatar-dot--canceling {
          background: var(--status-yellow);
        }
        .agent-person-avatar-dot--done {
          background: var(--status-green);
        }
        .agent-person-avatar-dot--error {
          background: var(--status-red);
        }
        .agent-person-main strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
          font-size: 12px;
        }
        .agent-avatar-button {
          position: relative;
          min-width: 0;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: none;
          background: transparent;
          color: inherit;
          cursor: pointer;
          padding: 0;
        }
        .agent-avatar-button--compact {
          width: 36px;
          height: 36px;
          justify-content: center;
          flex-shrink: 0;
        }
        .agent-avatar-initial {
          width: 34px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: 1px solid rgba(148,163,184,0.24);
          background: rgba(255,255,255,0.045);
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 800;
        }
        .agent-avatar-status {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 9px;
          height: 9px;
          border-radius: 999px;
          border: 2px solid var(--bg-sidebar);
          background: var(--text-muted);
        }
        .agent-avatar-status--running,
        .agent-avatar-status--needs_approval,
        .agent-avatar-status--canceling {
          background: var(--status-yellow);
        }
        .agent-avatar-status--done {
          background: var(--status-green);
        }
        .agent-avatar-status--error {
          background: var(--status-red);
        }
        .agent-avatar-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .agent-avatar-copy strong,
        .agent-avatar-copy span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .agent-avatar-copy strong {
          color: var(--text-primary);
          font-size: 12px;
        }
        .agent-avatar-copy span {
          color: var(--text-muted);
          font-size: 11px;
        }
        .agent-team-empty {
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.4;
        }
        .agent-team-footer {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-top: auto;
          padding: 9px;
          border-radius: 8px;
          background: rgba(16,163,127,0.08);
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.45;
        }
        .agent-team-footer svg {
          flex-shrink: 0;
          color: var(--accent-cyan);
          margin-top: 1px;
        }
        @media (max-width: 1100px) {
          .agent-team-dock:not(.agent-team-dock--collapsed) {
            position: absolute;
            right: 0;
            top: 30px;
            bottom: 0;
            width: min(320px, 72vw) !important;
            box-shadow: -18px 0 36px rgba(0,0,0,0.28);
          }
        }
      `}</style>
    </aside>
  );
}

/** 硅基员工值守信号数量 badge */
function AwarenessBadge({ personId }: { personId: string }) {
  const snapshot = useWorkspaceStore((s) => s.time.awarenessSnapshot) as {
    activeSignals?: Array<{
      scope: { kind: string; ownerId?: string };
      severity: string;
      status: string;
    }>;
  } | null;

  const count = (snapshot?.activeSignals ?? []).filter(
    (s) => s.status === "active" && s.scope.kind === "silicon_person" && s.scope.ownerId === personId,
  ).length;
  const hasCritical = (snapshot?.activeSignals ?? []).some(
    (s) => s.status === "active" && s.scope.kind === "silicon_person" && s.scope.ownerId === personId && s.severity === "critical",
  );

  if (count === 0) return null;

  return (
    <span className="awareness-badge" title="值守信号" aria-label={`${count} 个值守信号`} style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 16,
      height: 16,
      padding: "0 4px",
      borderRadius: 999,
      background: hasCritical ? "var(--status-red, #ef4444)" : "var(--status-yellow, #f59e0b)",
      color: hasCritical ? "#fff" : "#000",
      fontSize: 10,
      fontWeight: 600,
    }}>
      {count}
    </span>
  );
}
