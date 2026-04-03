import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { McpServer, McpServerConfig } from "@shared/contracts";

// ── Helper ────────────────────────────────────────────────────────────────────

function toServerConfig(server: McpServer, enabled = server.enabled): McpServerConfig {
  if (server.transport === "http") {
    return {
      id: server.id,
      name: server.name,
      source: server.source,
      enabled,
      transport: "http",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return {
    id: server.id,
    name: server.name,
    source: server.source,
    enabled,
    transport: "stdio",
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

// ── McpLibraryCard ────────────────────────────────────────────────────────────

interface McpLibraryCardProps {
  server: McpServer;
  onRefresh: (id: string) => void;
  onToggle: (id: string) => void;
}

function McpLibraryCard({ server, onRefresh, onToggle }: McpLibraryCardProps) {
  const health = server.state?.health ?? server.health ?? "unknown";
  const connected = server.state?.connected ?? false;

  return (
    <article className="mcp-card">
      <div className="mcp-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            className={`status-dot status-${health}`}
            title={health === "healthy" ? "已连接" : health === "error" ? "连接失败" : "未知"}
          />
          <Link to={`/mcp/${encodeURIComponent(server.id)}`} className="mcp-card-name">
            {server.name}
          </Link>
        </div>
        <div className="mcp-card-badges">
          <span className="transport-badge">{server.transport === "http" ? "HTTP" : "STDIO"}</span>
          <span
            className="inline-badge"
            data-health={health}
            data-connected={String(connected)}
            data-enabled={String(server.enabled)}
          >
            {server.enabled ? "已启用" : "已停用"}
          </span>
        </div>
      </div>

      <div className="mcp-card-meta">
        <span className="mcp-card-id">{server.id}</span>
        <div className="mcp-card-stats">
          <span>{server.tools?.length ?? 0} 工具</span>
        </div>
      </div>

      <div className="mcp-card-footer">
        <button
          type="button"
          className="card-action-btn"
          onClick={() => onRefresh(server.id)}
        >
          刷新
        </button>
        <button
          type="button"
          className="card-action-btn"
          onClick={() => onToggle(server.id)}
        >
          {server.enabled ? "停用" : "启用"}
        </button>
        <Link
          to={`/mcp/${encodeURIComponent(server.id)}`}
          className="card-action-btn card-action-primary"
        >
          详情
        </Link>
      </div>
    </article>
  );
}

// ── McpPage ───────────────────────────────────────────────────────────────────

export default function McpPage() {
  const workspace = useWorkspaceStore();
  const servers = workspace.mcpServers;
  const [loadError, setLoadError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (workspace.mcpServers.length > 0) {
      return;
    }

    console.info("[mcp-view] MCP 服务列表为空，开始加载");
    workspace.loadMcpServers().catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "加载 MCP 服务失败。";
      setLoadError(msg);
      console.error("[mcp-view] 加载 MCP 服务失败", { detail: msg });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 刷新指定 MCP 服务。 */
  async function handleRefresh(serverId: string) {
    console.info("[mcp-view] 刷新 MCP 服务", { serverId });
    try {
      await workspace.refreshMcpServer(serverId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "刷新 MCP 服务失败。";
      setLoadError(msg);
      console.error("[mcp-view] 刷新 MCP 服务失败", { serverId, detail: msg });
    }
  }

  /** 切换指定 MCP 服务启用状态。 */
  async function handleToggle(serverId: string) {
    const server = workspace.mcpServers.find((item) => item.id === serverId);
    if (!server) {
      setLoadError("未找到要切换的 MCP 服务。");
      console.error("[mcp-view] 切换 MCP 服务失败", { serverId });
      return;
    }

    console.info("[mcp-view] 切换 MCP 服务启用状态", { serverId, enabled: server.enabled });
    try {
      await workspace.updateMcpServer(serverId, toServerConfig(server, !server.enabled));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换 MCP 服务状态失败。";
      setLoadError(msg);
      console.error("[mcp-view] 切换 MCP 服务状态失败", { serverId, detail: msg });
    }
  }

  /** 发现外部 MCP 服务（Claude Desktop、Cursor）。 */
  async function handleDiscover() {
    setShowImport(true);
    try {
      const servers = await window.myClawAPI.discoverExternalMcpServers();
      setDiscoveredServers(servers);
      setSelectedImports(
        new Set(
          servers
            .map((_: any, i: number) => i)
            .filter((i: number) => !servers[i].alreadyImported),
        ),
      );
    } catch (err) {
      setLoadError("发现 MCP 服务失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** 导入选中的外部 MCP 服务。 */
  async function handleImport() {
    setImporting(true);
    try {
      const toImport = discoveredServers.filter((_: any, i: number) => selectedImports.has(i));
      await window.myClawAPI.importMcpServers(toImport);
      await workspace.loadMcpServers();
      setShowImport(false);
    } catch (err) {
      setLoadError("导入失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImporting(false);
    }
  }

  return (
    <main data-testid="mcp-view" className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">全局 MCP</span>
          <h2 className="page-title">MCP 服务库</h2>
          <p className="page-subtitle">用卡片统一管理 MCP 服务，进入详情页查看配置、状态与工具。</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleDiscover}
            className="btn-secondary import-button"
            data-testid="mcp-import-button"
          >
            导入 MCP
          </button>
          <Link to="/mcp/new" className="btn-premium accent new-button" data-testid="mcp-new-button">
            新建 MCP
          </Link>
        </div>
      </header>

      {showImport && (
        <section className="import-panel" data-testid="mcp-import-panel">
          <div className="import-panel-header">
            <h3 style={{ margin: 0 }}>发现的 MCP 服务</h3>
            <button type="button" onClick={() => setShowImport(false)} className="card-action-btn">
              关闭
            </button>
          </div>
          {discoveredServers.length === 0 ? (
            <p className="import-empty">未发现已配置的 MCP 服务。支持 Claude Desktop 和 Cursor 配置文件。</p>
          ) : (
            <>
              <ul className="import-list">
                {discoveredServers.map((s: any, i: number) => (
                  <li key={i} className="import-item">
                    <label className="import-label">
                      <input
                        type="checkbox"
                        checked={selectedImports.has(i)}
                        disabled={s.alreadyImported}
                        onChange={() => {
                          setSelectedImports((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          });
                        }}
                      />
                      <span className="import-name">{s.name}</span>
                      <span className="import-source">{s.source}</span>
                      {s.alreadyImported && <span className="import-exists">已存在</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || selectedImports.size === 0}
                className="btn-premium accent"
              >
                {importing ? "导入中..." : `导入 (${selectedImports.size})`}
              </button>
            </>
          )}
        </section>
      )}

      {loadError ? (
        <p className="error-copy">{loadError}</p>
      ) : servers.length === 0 ? (
        <section className="empty-state" data-testid="mcp-empty-state">
          当前还没有 MCP 服务，先新建一个吧。
        </section>
      ) : (
        <section className="card-grid">
          {servers.map((server) => (
            <McpLibraryCard
              key={server.id}
              server={server}
              onRefresh={handleRefresh}
              onToggle={handleToggle}
            />
          ))}
        </section>
      )}

      <style>{`
        .page-container {
          height: 100%;
          overflow-y: auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-start;
          margin-bottom: 28px;
        }

        .header-text {
          min-width: 0;
        }

        .eyebrow {
          display: inline-block;
          margin-bottom: 8px;
          color: var(--accent-cyan, #67e8f9);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .page-title {
          margin: 0;
          color: var(--text-primary, #fff);
          font-size: 28px;
        }

        .page-subtitle {
          margin: 10px 0 0;
          max-width: 620px;
          color: var(--text-secondary, #b0b0b8);
          line-height: 1.7;
        }

        .new-button {
          text-decoration: none;
        }

        .card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 24px;
        }

        .empty-state,
        .error-copy {
          padding: 48px 24px;
          border-radius: 16px;
          text-align: center;
        }

        .empty-state {
          border: 1px dashed var(--glass-border, #3f3f46);
          color: var(--text-secondary, #b0b0b8);
          background: color-mix(in srgb, var(--bg-card, #1b1b20) 70%, transparent);
        }

        .error-copy {
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        /* MCP Card */
        .mcp-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 20px;
          border-radius: var(--radius-xl);
          background: var(--bg-card);
          backdrop-filter: var(--blur-std);
          -webkit-backdrop-filter: var(--blur-std);
          border: 1px solid var(--glass-border, #27272a);
          box-shadow: var(--shadow-card), var(--glass-inner-glow);
          transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
        }

        .mcp-card:hover {
          border-color: var(--glass-border-hover);
          box-shadow: var(--shadow-card-hover), var(--glass-inner-glow);
          transform: translateY(-2px);
        }

        .mcp-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .mcp-card-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary, #fff);
          text-decoration: none;
        }

        .mcp-card-name:hover {
          color: var(--accent-cyan, #67e8f9);
        }

        .mcp-card-badges {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .transport-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          font-family: monospace;
          color: var(--accent-cyan, #67e8f9);
          background: rgba(103, 232, 249, 0.08);
          border: 1px solid rgba(103, 232, 249, 0.18);
        }

        .inline-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid var(--glass-border, #3f3f46);
          background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
          color: var(--text-secondary, #b0b0b8);
        }

        .inline-badge[data-enabled="true"] {
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.25);
          background: rgba(34, 197, 94, 0.1);
        }

        .mcp-card-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .mcp-card-id {
          font-size: 12px;
          color: var(--text-muted, #71717a);
          font-family: monospace;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mcp-card-stats {
          font-size: 12px;
          color: var(--text-secondary, #a1a1aa);
          flex-shrink: 0;
        }

        .mcp-card-footer {
          display: flex;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid var(--glass-border, #27272a);
        }

        .card-action-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 30px;
          padding: 0 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--glass-border, #3f3f46);
          background: transparent;
          color: var(--text-primary, #fff);
          transition: all 0.2s;
          text-decoration: none;
        }

        .card-action-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: var(--glass-border-hover);
        }

        .card-action-primary {
          margin-left: auto;
          color: var(--accent-cyan, #67e8f9);
          border-color: rgba(103, 232, 249, 0.25);
        }

        /* Status dots */
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }
        .status-healthy {
          background: #22c55e;
          box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
        }
        .status-error {
          background: #ef4444;
        }
        .status-unknown {
          background: #71717a;
        }

        /* Import button */
        .import-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 36px;
          padding: 0 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--glass-border, #3f3f46);
          background: transparent;
          color: var(--text-primary, #fff);
          transition: all 0.2s;
          text-decoration: none;
        }
        .import-button:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        /* Import panel */
        .import-panel {
          margin-bottom: 24px;
          padding: 20px;
          border-radius: var(--radius-lg, 16px);
          background: var(--bg-card, #18181b);
          border: 1px solid var(--glass-border, #27272a);
        }
        .import-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .import-empty {
          color: var(--text-secondary, #b0b0b8);
        }
        .import-list {
          list-style: none;
          padding: 0;
          margin: 0 0 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .import-item {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--glass-border, #27272a);
          background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
        }
        .import-label {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }
        .import-name {
          font-weight: 600;
          color: var(--text-primary, #fff);
        }
        .import-source {
          font-size: 11px;
          color: var(--text-muted, #71717a);
          font-family: monospace;
          padding: 2px 8px;
          border-radius: 6px;
          background: rgba(103, 232, 249, 0.08);
        }
        .import-exists {
          font-size: 11px;
          color: #fbbf24;
          margin-left: auto;
        }

        @media (max-width: 720px) {
          .page-header {
            flex-direction: column;
          }
        }
      `}</style>
    </main>
  );
}
