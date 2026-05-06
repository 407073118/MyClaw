import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { McpServer, McpServerConfig } from "@shared/contracts";
import { Plug, Plus, Download, X, Settings2, RefreshCw, Power, AlertCircle } from "lucide-react";

// ── 辅助方法 ──────────────────────────────────────────────────────────────────

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

// ── MCP 列表行 ────────────────────────────────────────────────────────────────

interface McpLibraryRowProps {
  server: McpServer;
  onRefresh: (id: string) => void;
  onToggle: (id: string) => void;
}

function McpLibraryRow({ server, onRefresh, onToggle }: McpLibraryRowProps) {
  const health = server.state?.health ?? server.health ?? "unknown";
  const isHealthy = health === "healthy";
  const isError = health === "error";
  const dotVariant = isHealthy ? "green" : isError ? "red" : "muted";
  const dotTitle = isHealthy ? "已连接" : isError ? "连接失败" : "未知状态";

  return (
    <article className={`list-row${!server.enabled ? " is-disabled" : ""}`}>
      <div className="list-row__lead">
        <span className={`status-dot status-dot--${dotVariant}`} title={dotTitle} />
      </div>

      <div className="list-row__main">
        <div className="list-row__title-row">
          <Link to={`/mcp/${encodeURIComponent(server.id)}`} className="list-row__title">
            {server.name}
          </Link>
          <span className="tag tag--accent">{server.transport.toUpperCase()}</span>
          {!server.enabled && <span className="tag tag--muted">已停用</span>}
        </div>
        <div className="list-row__meta-row">
          <span className="list-row__meta list-row__meta--mono">{server.id}</span>
          <span className="list-row__meta-sep" />
          <span className="list-row__meta">{server.tools?.length ?? 0} 个可调用工具</span>
        </div>
      </div>

      <div className="list-row__trailing">
        <button
          type="button"
          className="icon-btn"
          title="刷新连接"
          onClick={() => onRefresh(server.id)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={server.enabled ? "停用服务" : "启用服务"}
          onClick={() => onToggle(server.id)}
          style={server.enabled ? undefined : { color: "var(--accent-cyan)" }}
        >
          <Power size={14} />
        </button>
        <Link to={`/mcp/${encodeURIComponent(server.id)}`} className="btn-toolbar">
          <Settings2 size={14} />
          配置
        </Link>
      </div>
    </article>
  );
}

// ── McpPage 页面 ──────────────────────────────────────────────────────────────

export default function McpPage() {
  const workspace = useWorkspaceStore();
  const servers = workspace.mcpServers;
  const [loadError, setLoadError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (workspace.mcpServers.length > 0) return;
    workspace.loadMcpServers().catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "加载 MCP 服务失败。");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRefresh(serverId: string) {
    try {
      await workspace.refreshMcpServer(serverId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "刷新 MCP 服务失败。");
    }
  }

  async function handleToggle(serverId: string) {
    const server = workspace.mcpServers.find((item) => item.id === serverId);
    if (!server) return;
    try {
      await workspace.updateMcpServer(serverId, toServerConfig(server, !server.enabled));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "切换 MCP 服务状态失败。");
    }
  }

  async function handleDiscover() {
    setShowImport(true);
    try {
      const discovered = await window.myClawAPI.discoverExternalMcpServers();
      setDiscoveredServers(discovered);
      setSelectedImports(
        new Set(discovered.map((_: any, i: number) => i).filter((i: number) => !discovered[i].alreadyImported))
      );
    } catch (err) {
      setLoadError("发现 MCP 服务失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

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

  // 抽屉 Esc 关闭
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showImport) {
        setShowImport(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showImport]);

  return (
    <div className="page-shell">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Plug size={14} />
            <span>Model Context Protocol</span>
          </div>
          <h2 className="page-header__title">MCP 工具生态</h2>
          <p className="page-header__subtitle">
            高性能协议层，将外部工具和本地资源安全接入您的 AI 引擎。
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            onClick={handleDiscover}
            className="btn-toolbar"
            data-testid="mcp-import-button"
          >
            <Download size={14} />
            导入配置
          </button>
          <Link to="/mcp/new" className="btn-primary" data-testid="mcp-new-button">
            <Plus size={16} />
            新建服务
          </Link>
        </div>
      </header>

      <main className="page-content">
        {loadError ? (
          <div className="banner banner--error">
            <AlertCircle size={16} />
            <span>{loadError}</span>
          </div>
        ) : servers.length === 0 ? (
          <section className="empty-state">
            <Plug size={32} className="empty-state__icon" />
            <h3 className="empty-state__title">尚未配置任何 MCP 服务</h3>
            <p className="empty-state__body">
              连接工具集、数据库与本地能力，释放工作区潜能。
            </p>
            <Link to="/mcp/new" className="btn-primary">立即添加</Link>
          </section>
        ) : (
          <div className="list-rows">
            {servers.map((server) => (
              <McpLibraryRow
                key={server.id}
                server={server}
                onRefresh={handleRefresh}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </main>

      {showImport && (
        <div className="drawer-overlay" onClick={() => setShowImport(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer__header">
              <h3>发现的本地配置</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowImport(false)}
                title="关闭 (Esc)"
              >
                <X size={18} />
              </button>
            </header>

            <div className="drawer__content">
              {discoveredServers.length === 0 ? (
                <div className="empty-state empty-state--minimal">
                  <p className="empty-state__body">
                    未发现已搭载的 MCP 配置文件。
                    <br />
                    <small>支持探测 Claude Desktop 和 Cursor 配置。</small>
                  </p>
                </div>
              ) : (
                <div className="mcp-import-list">
                  {discoveredServers.map((s: any, i: number) => (
                    <label
                      key={i}
                      className={`mcp-import-item${s.alreadyImported ? " is-imported" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedImports.has(i)}
                        disabled={s.alreadyImported}
                        className="mcp-import-checkbox"
                        onChange={() => {
                          setSelectedImports((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          });
                        }}
                      />
                      <div className="mcp-import-info">
                        <span className="mcp-import-name">{s.name}</span>
                        <span className="mcp-import-source">源自 {s.source}</span>
                      </div>
                      {s.alreadyImported && (
                        <span className="tag tag--muted" style={{ marginLeft: "auto" }}>
                          已存在
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <footer className="drawer__footer">
              <button
                type="button"
                className="btn-primary"
                onClick={handleImport}
                disabled={importing || selectedImports.size === 0}
                style={{ width: "100%" }}
              >
                {importing ? "正在导入..." : `导入选中的配置 (${selectedImports.size})`}
              </button>
            </footer>
          </aside>
        </div>
      )}

      <style>{`
        /* MCP 导入抽屉的内部列表样式（页面专属，未提升到 global） */
        .mcp-import-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .mcp-import-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .mcp-import-item:hover:not(.is-imported) {
          background: rgba(255, 255, 255, 0.06);
        }
        .mcp-import-item.is-imported {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .mcp-import-checkbox {
          accent-color: var(--accent-cyan);
          width: 16px;
          height: 16px;
        }
        .mcp-import-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .mcp-import-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .mcp-import-source {
          font-size: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
