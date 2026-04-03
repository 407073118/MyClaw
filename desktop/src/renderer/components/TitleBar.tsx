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
  "/employees": "Employees",
  "/workflows": "Workflows",
  "/publish-drafts": "Publish",
  "/settings": "Settings",
};

function resolvePageLabel(pathname: string): string {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  for (const [prefix, label] of Object.entries(PAGE_LABELS)) {
    if (prefix !== "/" && pathname.startsWith(prefix)) return label;
  }
  return "MyClaw";
}

export default function TitleBar() {
  const api = window.myClawAPI;
  const isMac = api?.platform === "darwin";

  let pageLabel = "MyClaw";
  try {
    const location = useLocation();
    pageLabel = resolvePageLabel(location.pathname);
  } catch {
    // TitleBar may render outside Router (e.g. bootstrap splash)
  }

  return (
    <div data-testid="custom-titlebar" className="titlebar">
      {/* macOS 红绿灯按钮的占位区域 */}
      {isMac && <div className="titlebar-mac-spacer" />}

      {/* 左侧品牌 + 页面指示 */}
      <div className="titlebar-brand">
        <svg className="titlebar-logo" viewBox="0 0 24 24" width="14" height="14">
          <path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
        </svg>
        <span className="titlebar-app-name">MyClaw</span>
        <span className="titlebar-sep">/</span>
        <span className="titlebar-page">{pageLabel}</span>
      </div>

      {/* 可拖拽区域 — 覆盖标题栏大部分面积，让用户可以拖动窗口 */}
      <div className="titlebar-drag-region" />

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
      `}</style>
    </div>
  );
}
