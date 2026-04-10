import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";

const STATUS_LABEL: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  needs_approval: "待审批",
  done: "已完成",
  error: "异常",
  canceling: "取消中",
  canceled: "已取消",
};

const STATUS_VARIANT: Record<string, string> = {
  idle: "muted",
  running: "accent",
  needs_approval: "yellow",
  done: "green",
  error: "red",
  canceling: "yellow",
  canceled: "muted",
};

function getAvatarColor(name: string): string {
  const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function SiliconPersonEntryPage() {
  const workspace = useWorkspaceStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (workspace.siliconPersons.length > 0) return;
    workspace.loadSiliconPersons().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main data-testid="silicon-person-entry-view" className="page-container" style={{ height: "100%", overflowY: "auto" }}>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Silicon Person</span>
          <h2 className="page-title">硅基员工</h2>
          <p className="page-subtitle">管理你的硅基员工，点击卡片进入工作空间。</p>
        </div>
        <div className="header-actions">
          <button
            className="btn-premium accent"
            data-testid="silicon-person-create-btn"
            onClick={() => navigate("/employees/new")}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            新建硅基员工
          </button>
        </div>
      </header>

      <div className="sp-stats-row">
        <span className="sp-stats-count">{workspace.siliconPersons.length} 位硅基员工</span>
      </div>

      {workspace.siliconPersons.length === 0 ? (
        <div className="sp-empty-state">
          <div className="sp-empty-icon">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="6" width="32" height="36" rx="4" />
              <circle cx="24" cy="20" r="6" />
              <path d="M14 38c0-5.523 4.477-10 10-10s10 4.477 10 10" />
            </svg>
          </div>
          <p>还没有硅基员工</p>
          <p className="sp-empty-hint">点击右上角「新建硅基员工」开始创建</p>
        </div>
      ) : (
        <div className="glass-grid glass-grid--sm">
          {workspace.siliconPersons.map((person) => (
            <Link
              key={person.id}
              to={`/employees/${person.id}`}
              className="glass-card glass-card--accent sp-card-link"
              data-testid={`silicon-person-card-${person.id}`}
            >
              <div className="glass-card__header">
                <div className="sp-card-top">
                  <div
                    className="sp-avatar"
                    style={{ background: getAvatarColor(person.name) }}
                  >
                    <span>{person.name[0]}</span>
                  </div>
                  <div className="sp-card-title-block">
                    <h4>{person.name}</h4>
                    <span className="sp-card-title-sub">{person.title || person.name}</span>
                  </div>
                </div>
                <span className={`sp-status-dot sp-status-dot--${STATUS_VARIANT[person.status] ?? "muted"}`} title={STATUS_LABEL[person.status] ?? person.status} />
              </div>

              <div className="glass-card__body">
                <p className="sp-card-desc">{person.description || "暂无职责描述"}</p>
                <div className="sp-card-meta">
                  <span className={`glass-pill glass-pill--${STATUS_VARIANT[person.status] ?? "muted"}`}>
                    {STATUS_LABEL[person.status] ?? person.status}
                  </span>
                  <span className="glass-pill glass-pill--muted">{person.source === "enterprise" ? "企业" : person.source === "hub" ? "Hub" : "个人"}</span>
                  {person.workflowIds.length > 0 && (
                    <span className="glass-pill glass-pill--muted">{person.workflowIds.length} 个工作流</span>
                  )}
                </div>
              </div>

              <div className="glass-card__footer">
                <span className="sp-foot-sessions">
                  {person.sessions.length} 个会话
                </span>
                {person.hasUnread && (
                  <span className="sp-unread-badge">{person.unreadCount}</span>
                )}
                {person.needsApproval && (
                  <span className="sp-approval-badge">!</span>
                )}
                <span
                  className="sp-open-link"
                  data-testid={`silicon-person-open-${person.id}`}
                >
                  打开工作空间 &rarr;
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <style>{`
        .sp-stats-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: -16px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--glass-border);
        }

        .sp-stats-count {
          color: var(--accent-cyan);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }

        /* ── Empty State ── */
        .sp-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 80px 20px;
          color: var(--text-muted);
          text-align: center;
        }

        .sp-empty-icon {
          opacity: 0.3;
          margin-bottom: 8px;
        }

        .sp-empty-state p {
          margin: 0;
          font-size: 14px;
        }

        .sp-empty-hint {
          font-size: 12px !important;
          color: var(--text-muted);
        }

        /* ── Card Link ── */
        .sp-card-link {
          text-decoration: none;
          color: var(--text-primary);
          cursor: pointer;
          display: flex;
          flex-direction: column;
        }

        /* ── Card Inner ── */
        .sp-card-top {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .sp-avatar {
          width: 44px;
          height: 44px;
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .sp-avatar span {
          font-size: 16px;
          font-weight: 900;
          color: #fff;
        }

        .sp-card-title-block {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }

        .sp-card-title-block h4 {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .sp-card-title-sub {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 600;
        }

        .sp-status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .sp-status-dot--accent {
          background: var(--accent-cyan);
          box-shadow: 0 0 6px var(--accent-cyan);
          animation: sp-pulse 1.5s ease-in-out infinite;
        }
        .sp-status-dot--green { background: var(--status-green); }
        .sp-status-dot--yellow { background: var(--status-yellow); }
        .sp-status-dot--red { background: var(--status-red); }
        .sp-status-dot--muted { background: var(--text-muted); }

        @keyframes sp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .sp-card-desc {
          margin: 0 0 10px;
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.55;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .sp-card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .sp-foot-sessions {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
        }

        .sp-unread-badge {
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 9px;
          background: var(--accent-cyan);
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sp-approval-badge {
          width: 18px;
          height: 18px;
          border-radius: 9px;
          background: var(--status-yellow);
          color: #000;
          font-size: 11px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sp-open-link {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 600;
          transition: color 0.2s;
        }

        .sp-card-link:hover .sp-open-link {
          color: var(--accent-cyan);
        }
      `}</style>
    </main>
  );
}
