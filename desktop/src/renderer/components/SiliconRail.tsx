import React from "react";
import { useNavigate } from "react-router-dom";
import type { SiliconPerson, SiliconPersonStatus } from "@shared/contracts";
import { useWorkspaceStore } from "../stores/workspace";

// ---------------------------------------------------------------------------
// 状态灯颜色映射
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<SiliconPersonStatus, string> = {
  idle: "var(--text-muted)",
  running: "var(--accent-cyan)",
  needs_approval: "var(--status-yellow)",
  done: "var(--status-green)",
  error: "var(--status-red)",
  canceling: "var(--status-yellow)",
  canceled: "var(--text-muted)",
};

const STATUS_LABEL: Record<SiliconPersonStatus, string> = {
  idle: "待命",
  running: "执行中",
  needs_approval: "待审批",
  done: "已完成",
  error: "异常",
  canceling: "取消中",
  canceled: "已取消",
};

// ---------------------------------------------------------------------------
// 单个头像条目
// ---------------------------------------------------------------------------

function SiliconRailAvatar({
  person,
  onClick,
}: {
  person: SiliconPerson;
  onClick: () => void;
}) {
  const initial = (person.name || person.title || "?").charAt(0).toUpperCase();
  const statusColor = STATUS_COLOR[person.status] ?? "var(--text-muted)";
  const statusLabel = STATUS_LABEL[person.status] ?? person.status;

  // 单点视觉提示优先级：needsApproval > done + hasUnread > running > 静态。
  let attentionVariant: "yellow" | "green" | null = null;
  if (person.needsApproval) {
    attentionVariant = "yellow";
  } else if (person.status === "done" && person.hasUnread) {
    attentionVariant = "green";
  }

  const dotClassName = [
    "status-dot",
    person.status === "running" && !attentionVariant ? "is-running" : null,
    attentionVariant ? `status-dot--attention status-dot--attention-${attentionVariant}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  let titleText = `${person.name} — ${statusLabel}`;
  if (person.needsApproval) {
    titleText = `${person.name} — 待审批`;
  } else if (person.status === "done" && person.hasUnread) {
    titleText = `${person.name} — 已完成，待查看（${person.unreadCount} 条更新）`;
  }

  return (
    <button
      data-testid={`silicon-rail-avatar-${person.id}`}
      className="silicon-rail-avatar"
      onClick={onClick}
      title={titleText}
      type="button"
    >
      <div className="avatar-circle">
        <span className="avatar-initial">{initial}</span>
        <span
          className={dotClassName}
          style={{ background: statusColor }}
        />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Silicon Rail 主组件
// ---------------------------------------------------------------------------

/** 右侧竖向头像栏，展示硅基员工状态。点击后切换到共享主聊天容器中的目标对象。 */
export default function SiliconRail() {
  const navigate = useNavigate();
  const siliconPersons = useWorkspaceStore((state) => state.siliconPersons ?? []);
  const setActiveSiliconPersonId = useWorkspaceStore((state) => state.setActiveSiliconPersonId);

  if (siliconPersons.length === 0) return null;

  /** 点击头像：切换当前硅基员工并进入共享主聊天页面。 */
  function handleAvatarClick(person: SiliconPerson) {
    const workspaceRoute = "/";
    console.info("[silicon-rail] 点击硅基员工头像，切换共享聊天对象", {
      siliconPersonId: person.id,
      route: workspaceRoute,
    });
    setActiveSiliconPersonId(person.id);
    navigate(workspaceRoute);
  }

  return (
    <aside data-testid="silicon-rail" className="silicon-rail">
      <div className="silicon-rail-list">
        {siliconPersons.map((person) => (
          <SiliconRailAvatar
            key={person.id}
            person={person}
            onClick={() => handleAvatarClick(person)}
          />
        ))}
      </div>

      <style>{`
        .silicon-rail {
          width: 52px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px 0;
          background: var(--bg-sidebar);
          border-left: 1px solid var(--glass-border);
          overflow-y: auto;
          overflow-x: hidden;
        }

        .silicon-rail::-webkit-scrollbar {
          width: 0;
        }

        .silicon-rail-list {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .silicon-rail-avatar {
          position: relative;
          width: 36px;
          height: 36px;
          padding: 0;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: 10px;
          transition: transform 0.15s ease;
        }

        .silicon-rail-avatar:hover {
          transform: scale(1.12);
        }


        .avatar-circle {
          position: relative;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
          border: 1px solid var(--glass-border);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .silicon-rail-avatar:hover .avatar-circle {
          border-color: var(--glass-border-hover);
        }

        .avatar-initial {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
          user-select: none;
        }

        .status-dot {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid var(--bg-sidebar);
          transition: background 0.2s ease;
        }

        .status-dot.is-running {
          animation: silicon-rail-pulse 1.5s ease-in-out infinite;
        }

        @keyframes silicon-rail-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .status-dot--attention {
          animation: silicon-rail-attention 1.4s ease-out infinite;
          transform-origin: center;
        }

        .status-dot--attention-yellow {
          --rail-attention-color: var(--status-yellow);
        }

        .status-dot--attention-green {
          --rail-attention-color: var(--status-green);
        }

        @keyframes silicon-rail-attention {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--rail-attention-color, var(--status-yellow)) 60%, transparent);
          }
          70% {
            transform: scale(1.08);
            box-shadow: 0 0 0 6px color-mix(in srgb, var(--rail-attention-color, var(--status-yellow)) 0%, transparent);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--rail-attention-color, var(--status-yellow)) 0%, transparent);
          }
        }
      `}</style>
    </aside>
  );
}
