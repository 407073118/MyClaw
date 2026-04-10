import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { McpServer, McpServerConfig } from "@shared/contracts";

// ── 辅助方法 ──────────────────────────────────────────────────────────────────

/** 将运行时中的 MCP 服务对象转换成可提交的配置结构。 */
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

// ── MCP 卡片组件 ──────────────────────────────────────────────────────────────

interface McpLibraryCardProps {
  server: McpServer;
  onRefresh: (id: string) => void;
  onToggle: (id: string) => void;
}

/** 渲染单个 MCP 服务卡片，并暴露刷新与启停操作。 */
function McpLibraryCard({ server, onRefresh, onToggle }: McpLibraryCardProps) {
  const health = server.state?.health ?? server.health ?? "unknown";
  const connected = server.state?.connected ?? false;

  const healthPillVariant = health === "healthy" ? "green" : health === "error" ? "red" : "muted";
  const enabledPillVariant = server.enabled ? "green" : "muted";

  return (
    <article className="glass-card glass-card--accent">
      <div className="glass-card__header">
        <div className="mcp-name-row">
          <span
            className={`mcp-health-dot mcp-health-dot--${healthPillVariant}`}
            title={health === "healthy" ? "已连接" : health === "error" ? "连接失败" : "未知"}
          />
          <Link to={`/mcp/${encodeURIComponent(server.id)}`} className="mcp-card-name">
            {server.name}
          </Link>
        </div>
        <div className="mcp-card-badges">
          <span className="glass-pill glass-pill--accent mcp-transport-pill">{server.transport === "http" ? "HTTP" : "STDIO"}</span>
          <span className={`glass-pill glass-pill--${enabledPillVariant}`}>
            {server.enabled ? "已启用" : "已停用"}
          </span>
        </div>
      </div>

      <div className="glass-card__body">
        <div className="mcp-card-meta">
          <span className="mcp-card-id">{server.id}</span>
          <span className="mcp-card-stats">{server.tools?.length ?? 0} 工具</span>
        </div>
      </div>

      <div className="glass-card__footer">
        <button
          type="button"
          className="glass-action-btn"
          onClick={() => onRefresh(server.id)}
        >
          刷新
        </button>
        <button
          type="button"
          className="glass-action-btn"
          onClick={() => onToggle(server.id)}
        >
          {server.enabled ? "停用" : "启用"}
        </button>
        <Link
          to={`/mcp/${encodeURIComponent(server.id)}`}
          className="glass-action-btn glass-action-btn--primary"
          style={{ marginLeft: "auto", textDecoration: "none" }}
        >
          详情
        </Link>
      </div>
    </article>
  );
}

// ── McpPage 页面 ──────────────────────────────────────────────────────────────

/** 展示全局 MCP 服务列表，并支持导入外部配置。 */
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
    <main data-testid="mcp-view" className="page-container" style={{ height: "100%", overflowY: "auto" }}>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">全局 MCP</span>
          <h2 className="page-title">MCP 服务库</h2>
          <p className="page-subtitle">用卡片统一管理 MCP 服务，进入详情页查看配置、状态与工具。</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={handleDiscover}
            className="btn-premium"
            data-testid="mcp-import-button"
          >
            导入 MCP
          </button>
          <Link to="/mcp/new" className="btn-premium accent" style={{ textDecoration: "none" }} data-testid="mcp-new-button">
            新建 MCP
          </Link>
        </div>
      </header>

      {showImport && (
        <section className="glass-card glass-card--flat mcp-import-panel" data-testid="mcp-import-panel">
          <div className="glass-card__header">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>发现的 MCP 服务</h3>
            <button type="button" onClick={() => setShowImport(false)} className="glass-action-btn">
              关闭
            </button>
          </div>
          <div className="glass-card__body">
            {discoveredServers.length === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>未发现已配置的 MCP 服务。支持 Claude Desktop 和 Cursor 配置文件。</p>
            ) : (
              <>
                <ul className="mcp-import-list">
                  {discoveredServers.map((s: any, i: number) => (
                    <li key={i} className="mcp-import-item">
                      <label className="mcp-import-label">
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
                        <span className="mcp-import-name">{s.name}</span>
                        <span className="glass-pill glass-pill--accent">{s.source}</span>
                        {s.alreadyImported && <span className="mcp-import-exists">已存在</span>}
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
          </div>
        </section>
      )}

      {loadError ? (
        <p className="mcp-error-copy">{loadError}</p>
      ) : servers.length === 0 ? (
        <section className="mcp-empty-state" data-testid="mcp-empty-state">
          当前还没有 MCP 服务，先新建一个吧。
        </section>
      ) : (
        <section className="glass-grid glass-grid--md">
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
        /* ── MCP Card Inner ── */
        .mcp-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .mcp-card-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          text-decoration: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mcp-card-name:hover {
          color: var(--accent-cyan);
        }

        .mcp-card-badges {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .mcp-transport-pill {
          font-family: "Cascadia Code", "Fira Code", monospace;
        }

        .mcp-card-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .mcp-card-id {
          font-size: 12px;
          color: var(--text-muted);
          font-family: "Cascadia Code", "Fira Code", monospace;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mcp-card-stats {
          font-size: 12px;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        /* ── Health Dots ── */
        .mcp-health-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }
        .mcp-health-dot--green {
          background: var(--status-green);
          box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
        }
        .mcp-health-dot--red {
          background: var(--status-red);
        }
        .mcp-health-dot--muted {
          background: var(--text-muted);
        }

        /* ── Import Panel ── */
        .mcp-import-panel {
          margin-top: -16px;
        }

        .mcp-import-list {
          list-style: none;
          padding: 0;
          margin: 0 0 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .mcp-import-item {
          padding: 10px 12px;
          border-radius: var(--radius-lg);
          border: 1px solid var(--glass-border);
          background: color-mix(in srgb, var(--bg-base) 80%, transparent);
        }

        .mcp-import-label {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }

        .mcp-import-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .mcp-import-exists {
          font-size: 11px;
          color: var(--status-yellow);
          margin-left: auto;
        }

        /* ── Empty & Error ── */
        .mcp-empty-state {
          padding: 48px 24px;
          border-radius: var(--radius-xl);
          text-align: center;
          border: 1px dashed var(--glass-border);
          color: var(--text-secondary);
          background: color-mix(in srgb, var(--bg-card) 70%, transparent);
        }

        .mcp-error-copy {
          padding: 48px 24px;
          border-radius: var(--radius-xl);
          text-align: center;
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.2);
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
