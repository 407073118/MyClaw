import React from "react";
import { useLocation } from "react-router-dom";

// ---------------------------------------------------------------------------
// 自定义标题栏组件 — 提供可拖拽区域 + 左侧品牌/页面指示
// ---------------------------------------------------------------------------

const PAGE_LABELS: Record<string, string> = {
  "/": "Chat",
  "/hub": "Hub",
  "/tools": "Tools",
  "/mcp": "MCP Servers",
  "/skills": "Skills",
  "/employees": "硅基员工",
  "/workflows": "Workflows",
  "/time": "时间规划",
  "/publish-drafts": "Publish",
  "/me/prompt": "My Prompt",
  "/settings": "Settings",
};

/** 根据当前路由路径推断标题栏右侧的页面标签。 */
function resolvePageLabel(pathname: string): string {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  for (const [prefix, label] of Object.entries(PAGE_LABELS)) {
    if (prefix !== "/" && pathname.startsWith(prefix)) return label;
  }
  return "MyClaw";
}

type TitleBarAssistantChip = {
  tone: "accent" | "warning" | "neutral";
  label: string;
  expanded: boolean;
  onClick: () => void;
};

type TitleBarProps = {
  assistantChip?: TitleBarAssistantChip | null;
};

/** 渲染自定义标题栏，并兼容 macOS 交通灯占位。 */
export default function TitleBar({ assistantChip = null }: TitleBarProps) {
  const api = window.myClawAPI;
  const isMac = api?.platform === "darwin";

  let pageLabel = "MyClaw";
  try {
    const location = useLocation();
    pageLabel = resolvePageLabel(location.pathname);
  } catch {
    // 标题栏在启动闪屏等场景可能运行在 Router 之外。
  }

  return (
    <div data-testid="custom-titlebar" className="titlebar">
      {/* macOS 红绿灯按钮的占位区域 */}
      {isMac && <div className="titlebar-mac-spacer" />}

      {/* 左侧品牌 + 页面指示 */}
      <div className="titlebar-brand">
        <svg className="titlebar-logo" viewBox="0 0 24 24" width="14" height="14">
          <path
            fill="currentColor"
            d="M12.06 2.75 6.18 20h2.36l1.32-4.01h4.27L15.47 20h2.35L12.06 2.75Zm0 5.41 1.37 4.18h-2.76l1.39-4.18Z"
          />
          <path fill="currentColor" opacity="0.34" d="m12.08 9.84 2.05 6.15H9.86z" />
        </svg>
        <span className="titlebar-app-name">MyClaw</span>
        <span className="titlebar-sep">/</span>
        <span className="titlebar-page">{pageLabel}</span>
      </div>

      {/* 可拖拽区域，覆盖标题栏大部分面积，方便直接拖动窗口。 */}
      <div className="titlebar-drag-region" />

      {assistantChip ? (
        <div className="titlebar-actions">
          <button
            type="button"
            data-testid="titlebar-time-chip"
            className={`titlebar-time-chip titlebar-time-chip--${assistantChip.tone} ${assistantChip.expanded ? "is-expanded" : ""}`}
            onClick={assistantChip.onClick}
          >
            <span className="titlebar-time-chip__dot" />
            <span className="titlebar-time-chip__label">{assistantChip.label}</span>
          </button>
        </div>
      ) : null}

      <style>{`
        .titlebar {
          position: relative;
          display: flex;
          align-items: center;
          height: 36px;
          flex-shrink: 0;
          background: var(--bg-base, #0E0E0E);
          z-index: 9999;
          user-select: none;
        }

        .titlebar-mac-spacer {
          width: 78px;
          flex-shrink: 0;
        }

        .titlebar-brand {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 14px;
          height: 100%;
          flex-shrink: 0;
          -webkit-app-region: drag;
          app-region: drag;
        }

        .titlebar-logo {
          color: var(--accent-cyan, #10a37f);
          flex-shrink: 0;
        }

        .titlebar-app-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary, #a3a3a3);
          letter-spacing: -0.01em;
        }

        .titlebar-sep {
          font-size: 12px;
          color: var(--text-muted, #737373);
          margin: 0 1px;
        }

        .titlebar-page {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-primary, #ededed);
        }

        .titlebar-drag-region {
          flex: 1;
          height: 36px;
          -webkit-app-region: drag;
          app-region: drag;
        }

        .titlebar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-right: 12px;
          -webkit-app-region: no-drag;
          app-region: no-drag;
        }

        .titlebar-time-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 26px;
          max-width: 260px;
          padding: 0 10px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.05);
          color: var(--text-primary, #ededed);
          cursor: pointer;
        }

        .titlebar-time-chip--warning {
          border-color: rgba(245, 158, 11, 0.22);
          background: rgba(245, 158, 11, 0.12);
        }

        .titlebar-time-chip--accent {
          border-color: rgba(16, 163, 127, 0.24);
          background: rgba(16, 163, 127, 0.12);
        }

        .titlebar-time-chip.is-expanded {
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
        }

        .titlebar-time-chip__dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.8;
          flex-shrink: 0;
        }

        .titlebar-time-chip__label {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
