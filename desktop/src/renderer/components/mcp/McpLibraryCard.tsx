import React from "react";
import { Link } from "react-router-dom";
import type { McpServer } from "@shared/contracts";

interface McpLibraryCardProps {
  server: McpServer;
  onRefresh: (id: string) => void;
  onToggle: (id: string) => void;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

export default function McpLibraryCard({ server, onRefresh, onToggle }: McpLibraryCardProps) {
  const safeId = safeString(server?.id, "unknown");
  const safeName = safeString(server?.name, "未命名 MCP");
  const transportLabel = server.transport === "http" ? "HTTP 传输" : "STDIO 传输";
  const enabledLabel = server.enabled ? "已启用" : "已停用";
  const toggleLabel = server.enabled ? "停用" : "启用";
  const detailPath = `/mcp/${encodeURIComponent(safeId)}`;
  const healthLabelKey = server.state?.health ?? server.health ?? "unknown";

  const healthLabel = (() => {
    if (healthLabelKey === "healthy") return "正常";
    if (healthLabelKey === "error") return "异常";
    return "未知";
  })();

  const toolCountLabel = String(server.state?.toolCount ?? server.tools.length ?? 0);

  const lastCheckedLabel = (() => {
    const value = server.state?.lastCheckedAt ?? server.lastCheckedAt ?? null;
    if (!isValidTimestamp(value)) return "暂无记录";
    return new Date(value).toLocaleString("zh-CN", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  })();

  const recentErrorLabel = safeString(server.state?.recentError ?? server.recentError ?? "", "");

  function emitRefresh() {
    console.info("[mcp-library-card] 请求刷新 MCP 服务", { serverId: safeId, name: safeName });
    onRefresh(safeId);
  }

  function emitToggle() {
    console.info("[mcp-library-card] 请求切换 MCP 服务启用状态", { serverId: safeId, enabled: server.enabled });
    onToggle(safeId);
  }

  return (
    <article data-testid={`mcp-library-card-${safeId}`} className="mcp-card">
      <header className="card-header">
        <div className="title-block">
          <strong className="card-title">{safeName}</strong>
          <p className="card-subtitle">{transportLabel}</p>
        </div>
        <div className="badge-row">
          <span className="status-badge" data-health={healthLabelKey}>{healthLabel}</span>
          <span className="enabled-badge" data-enabled={String(server.enabled)}>{enabledLabel}</span>
        </div>
      </header>

      <dl className="meta-grid">
        <div className="meta-item">
          <dt>工具数</dt>
          <dd data-testid={`mcp-library-tools-${safeId}`}>{toolCountLabel}</dd>
        </div>
        <div className="meta-item">
          <dt>最近检查</dt>
          <dd data-testid={`mcp-library-last-checked-${safeId}`}>{lastCheckedLabel}</dd>
        </div>
      </dl>

      {recentErrorLabel && (
        <p className="error-copy" data-testid={`mcp-library-error-${safeId}`}>
          {recentErrorLabel}
        </p>
      )}

      <footer className="card-footer">
        <button
          type="button"
          className="ghost-button"
          data-testid={`mcp-library-refresh-${safeId}`}
          onClick={emitRefresh}
        >
          刷新
        </button>
        <button
          type="button"
          className="ghost-button"
          data-testid={`mcp-library-toggle-${safeId}`}
          onClick={emitToggle}
        >
          {toggleLabel}
        </button>
        <Link to={detailPath} className="primary-link" data-testid={`mcp-library-open-${safeId}`}>
          查看详情
        </Link>
      </footer>

      <style>{`
        .mcp-card {
          display: flex;
          flex-direction: column;
          gap: 18px;
          min-height: 240px;
          padding: 22px;
          border-radius: 18px;
          border: 1px solid var(--glass-border, #30303a);
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--accent-primary, #3b82f6) 12%, transparent), transparent 42%),
            var(--bg-card, #18181b);
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.2);
        }
        .mcp-card .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .mcp-card .title-block { min-width: 0; }
        .mcp-card .card-title {
          display: block;
          font-size: 18px;
          color: var(--text-primary, #fff);
        }
        .mcp-card .card-subtitle {
          margin: 8px 0 0;
          color: var(--text-secondary, #b0b0b8);
          font-size: 13px;
        }
        .mcp-card .badge-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .mcp-card .status-badge,
        .mcp-card .enabled-badge {
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid var(--glass-border, #3f3f46);
          background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
          color: var(--text-secondary, #b0b0b8);
        }
        .mcp-card .status-badge[data-health="healthy"] {
          color: #16a34a;
          border-color: rgba(22, 163, 74, 0.25);
          background: rgba(22, 163, 74, 0.12);
        }
        .mcp-card .status-badge[data-health="error"] {
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.12);
        }
        .mcp-card .enabled-badge[data-enabled="true"] {
          color: var(--text-primary, #fff);
        }
        .mcp-card .meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin: 0;
        }
        .mcp-card .meta-item {
          padding: 14px;
          border-radius: 12px;
          border: 1px solid var(--glass-border, #2f2f38);
          background: color-mix(in srgb, var(--bg-base, #121214) 88%, transparent);
        }
        .mcp-card .meta-item dt {
          font-size: 11px;
          color: var(--text-muted, #8d8d97);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .mcp-card .meta-item dd {
          margin: 8px 0 0;
          font-size: 14px;
          color: var(--text-primary, #fff);
        }
        .mcp-card .error-copy {
          margin: 0;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          font-size: 13px;
          line-height: 1.5;
        }
        .mcp-card .card-footer {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: auto;
        }
        .mcp-card .ghost-button,
        .mcp-card .primary-link {
          height: 30px;
          border-radius: 8px;
          padding: 0 12px;
          font-size: 12px;
          font-weight: 600;
        }
        .mcp-card .ghost-button {
          border: 1px solid var(--glass-border, #42424c);
          background: transparent;
          color: var(--text-primary, #fff);
          cursor: pointer;
        }
        .mcp-card .primary-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          color: var(--accent-text, #fff);
          background: linear-gradient(135deg, #2563eb, #0f766e);
        }
        @media (max-width: 720px) {
          .mcp-card .meta-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </article>
  );
}
