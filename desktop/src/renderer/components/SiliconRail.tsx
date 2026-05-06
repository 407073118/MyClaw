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

  // 单点视觉提示优先级：needsApproval > hasUnread > running > 静态。
  // 注意：硅基员工 @ 投递后的 done 不一定是终态，只要 hasUnread 就拉响注意。
  let attentionVariant: "yellow" | "green" | null = null;
  if (person.needsApproval) {
    attentionVariant = "yellow";
  } else if (person.hasUnread) {
    attentionVariant = "green";
  }

  const buttonClassName = [
    "silicon-rail-avatar",
    attentionVariant ? `silicon-rail-avatar--attention silicon-rail-avatar--attention-${attentionVariant}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const dotClassName = [
    "status-dot",
    person.status === "running" && !attentionVariant ? "is-running" : null,
  ]
    .filter(Boolean)
    .join(" ");

  let titleText = `${person.name} — ${statusLabel}`;
  if (person.needsApproval) {
    titleText = `${person.name} — 待审批`;
  } else if (person.hasUnread) {
    titleText = `${person.name} — 有新消息（${person.unreadCount} 条）`;
  }

  return (
    <button
      data-testid={`silicon-rail-avatar-${person.id}`}
      className={buttonClassName}
      onClick={onClick}
      title={titleText}
      type="button"
    >
      {attentionVariant && <span className="attention-dot" aria-hidden="true" />}
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

        /* 整个头像级别的注意提示：彩色边框 + 外发光环 + 持续脉冲，确保扫一眼就能看到。 */
        .silicon-rail-avatar--attention {
          animation: silicon-rail-avatar-pulse 1.6s ease-out infinite;
        }

        .silicon-rail-avatar--attention-yellow {
          --rail-attention-color: var(--status-yellow);
        }

        .silicon-rail-avatar--attention-green {
          --rail-attention-color: var(--status-green);
        }

        .silicon-rail-avatar--attention .avatar-circle {
          border-color: var(--rail-attention-color);
          box-shadow: 0 0 0 1px var(--rail-attention-color),
            0 0 8px 1px color-mix(in srgb, var(--rail-attention-color) 55%, transparent);
        }

        @keyframes silicon-rail-avatar-pulse {
          0% {
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--rail-attention-color, transparent) 55%, transparent);
          }
          70% {
            box-shadow: 0 0 0 8px color-mix(in srgb, var(--rail-attention-color, transparent) 0%, transparent);
          }
          100% {
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--rail-attention-color, transparent) 0%, transparent);
          }
        }

        /* 头像左上角的高对比小红点（实心填色，醒目，不依赖动画也能被看到）。 */
        .attention-dot {
          position: absolute;
          top: -3px;
          left: -3px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--rail-attention-color);
          border: 2px solid var(--bg-sidebar);
          z-index: 2;
          pointer-events: none;
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
      `}</style>
    </aside>
  );
}
