import React, { useMemo, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, PanelRightClose, PanelRightOpen, Users } from "lucide-react";
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
  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(292);

  const effectiveCollapsed = collapsed || webPanelOpen;
  const runningTasks = useMemo(
    () => agentTasks.filter((task) => task.status === "queued" || task.status === "running"),
    [agentTasks],
  );
  const waitingTasks = useMemo(
    () => agentTasks.filter((task) => task.status === "waiting_user" || task.status === "failed"),
    [agentTasks],
  );
  const loadByPerson = useMemo(() => {
    return siliconPersons.map((person) => ({
      person,
      activeCount: runningTasks.filter((task) => task.assigneeIds.includes(person.id)).length,
    }));
  }, [runningTasks, siliconPersons]);

  /** 点击员工时切回主聊天容器，并把员工设为当前查看对象。 */
  function handleOpenPerson(person: SiliconPerson) {
    console.info("[agent-team-dock] 打开员工会话", {
      siliconPersonId: person.id,
      route: "/",
    });
    setActiveSiliconPersonId(person.id);
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
            <strong>{runningTasks.length}</strong>
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
          <section className="agent-team-section">
            <div className="agent-team-section-title">
              <AlertCircle size={14} />
              <span>待我处理</span>
              <strong>{waitingTasks.length}</strong>
            </div>
            <div className="agent-task-mini-list">
              {waitingTasks.length === 0 ? (
                <span className="agent-team-empty">暂无阻塞</span>
              ) : waitingTasks.slice(0, 3).map((task) => (
                <div key={task.id} className="agent-task-mini">
                  <span>{task.title}</span>
                  <em>{TASK_STATUS_LABEL[task.status]}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="agent-team-section">
            <div className="agent-team-section-title">
              <Activity size={14} />
              <span>运行中</span>
              <strong>{runningTasks.length}</strong>
            </div>
            <div className="agent-task-mini-list">
              {runningTasks.length === 0 ? (
                <span className="agent-team-empty">当前空闲</span>
              ) : runningTasks.slice(0, 4).map((task) => (
                <div key={task.id} className="agent-task-mini">
                  <span>{task.title}</span>
                  <em>{TASK_STATUS_LABEL[task.status]}</em>
                </div>
              ))}
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
        .agent-task-mini-list,
        .agent-person-list {
          display: grid;
          gap: 6px;
        }
        .agent-task-mini,
        .agent-person-row {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 8px;
          border-radius: 7px;
          border: 1px solid rgba(148,163,184,0.12);
          background: rgba(0,0,0,0.12);
        }
        .agent-task-mini span {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
          font-size: 12px;
        }
        .agent-task-mini em,
        .agent-person-main em {
          flex-shrink: 0;
          color: var(--text-muted);
          font-size: 11px;
          font-style: normal;
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
