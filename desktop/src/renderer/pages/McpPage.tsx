import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { McpServer, McpServerConfig } from "@shared/contracts";
import { Plug, Plus, Download, X, Settings2, RefreshCw, Power } from "lucide-react";

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

// ── MCP 卡片组件 (高密度列表版) ─────────────────────────────────────────────

interface McpLibraryRowProps {
  server: McpServer;
  onRefresh: (id: string) => void;
  onToggle: (id: string) => void;
}

function McpLibraryRow({ server, onRefresh, onToggle }: McpLibraryRowProps) {
  const health = server.state?.health ?? server.health ?? "unknown";
  const isHealthy = health === "healthy";
  const isError = health === "error";

  return (
    <article className={`mcp-row-card ${!server.enabled ? "is-disabled" : ""}`}>
      <div className="mcp-row-left">
        <div className="mcp-name-group">
          {/* 状态指示红绿灯 */}
          <span 
            className={`status-dot ${isHealthy ? "status-green" : isError ? "status-red" : "status-muted"}`} 
            title={isHealthy ? "已连接" : isError ? "连接失败" : "未知状态"} 
          />
          <Link to={`/mcp/${encodeURIComponent(server.id)}`} className="mcp-name-link">
            {server.name}
          </Link>
          <span className="badge badge-accent shadow-sm">{server.transport.toUpperCase()}</span>
          {!server.enabled && <span className="badge badge-muted">已停用</span>}
        </div>
        <div className="mcp-meta-group">
          <span className="meta-text text-mono">{server.id}</span>
          <span className="meta-separator" />
          <span className="meta-text">{server.tools?.length ?? 0} 个可调用工具</span>
        </div>
      </div>

      <div className="mcp-row-right">
        <button
          className="btn-icon"
          title="刷新连接"
          onClick={() => onRefresh(server.id)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="btn-icon"
          title={server.enabled ? "停用服务" : "启用服务"}
          onClick={() => onToggle(server.id)}
          style={{ color: server.enabled ? "rgba(255,255,255,0.7)" : "#10a37f" }}
        >
          <Power size={14} />
        </button>
        <Link
          to={`/mcp/${encodeURIComponent(server.id)}`}
          className="btn-secondary ml-2"
        >
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

  // Effect to close drawer on Esc
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
    <div className="mcp-desktop-layout">
      {/* 桌面原生化：固定吸顶 Header */}
      <header className="mcp-desktop-header">
        <div className="header-text">
          <div className="eyebrow-row">
            <Plug size={14} className="eyebrow-icon" />
            <span className="eyebrow">Model Context Protocol</span>
          </div>
          <h2 className="pane-title">MCP 工具生态</h2>
          <p className="pane-subtitle">高性能协议层，将外部工具和本地资源安全接入您的 AI 引擎。</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={handleDiscover}
            className="btn-secondary"
            data-testid="mcp-import-button"
          >
            <Download size={14} />
            导入配置
          </button>
          <Link to="/mcp/new" className="btn-primary" style={{ textDecoration: "none" }} data-testid="mcp-new-button">
            <Plus size={16} />
            新建服务
          </Link>
        </div>
      </header>

      {/* 列表主体内容 */}
      <main className="mcp-desktop-content">
        {loadError ? (
          <div className="error-banner">
            <AlertCircle size={16} />
            {loadError}
          </div>
        ) : servers.length === 0 ? (
          <section className="empty-state-panel">
            <Plug size={32} className="empty-icon" />
            <h3>尚未配置任何 MCP 服务</h3>
            <p>连接工具集、数据库与本地能力，释放工作区潜能。</p>
            <Link to="/mcp/new" className="btn-primary mt-4" style={{ textDecoration: "none" }}>立即添加</Link>
          </section>
        ) : (
          <div className="mcp-rows-container">
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

      {/* 桌面原生化：侧滑盖模态 Drawer */}
      {showImport && (
        <div className="desktop-drawer-overlay" onClick={() => setShowImport(false)}>
          <aside className="desktop-drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h3>发现的本地配置</h3>
              <button className="btn-icon" onClick={() => setShowImport(false)} title="关闭 (Esc)">
                <X size={18} />
              </button>
            </header>
            
            <div className="drawer-content">
              {discoveredServers.length === 0 ? (
                <div className="empty-state-panel minimal">
                  <p>未发现已搭载的 MCP 配置文件。<br/><small>支持探测 Claude Desktop 和 Cursor 配置。</small></p>
                </div>
              ) : (
                <div className="import-list-box">
                  {discoveredServers.map((s: any, i: number) => (
                    <label key={i} className={`import-list-item ${s.alreadyImported ? "already-imported" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedImports.has(i)}
                        disabled={s.alreadyImported}
                        className="desktop-checkbox"
                        onChange={() => {
                          setSelectedImports((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          });
                        }}
                      />
                      <div className="import-info">
                        <span className="import-name">{s.name}</span>
                        <span className="import-source">源自 {s.source}</span>
                      </div>
                      {s.alreadyImported && <span className="badge badge-muted ml-auto">已存在</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            <footer className="drawer-footer">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={handleImport}
                disabled={importing || selectedImports.size === 0}
              >
                {importing ? "正在导入..." : `导入选中的配置 (${selectedImports.size})`}
              </button>
            </footer>
          </aside>
        </div>
      )}

      <style>{`
        /* Core Layout */
        .mcp-desktop-layout {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: #0d0d0f;
          position: relative;
          overflow: hidden;
        }

        /* Fixed Sticky Header */
        .mcp-desktop-header {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding: 32px 48px;
          background: rgba(13, 13, 15, 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          z-index: 10;
        }
        .header-text {
          display: flex;
          flex-direction: column;
        }
        .eyebrow-row {
          display: flex;
          align-items: center;
          gap: 6px;
          color: rgba(255,255,255,0.4);
          margin-bottom: 8px;
        }
        .eyebrow {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .pane-title {
          font-size: 28px;
          font-weight: 600;
          color: #f0f6fc;
          margin: 0 0 6px 0;
          letter-spacing: -0.02em;
        }
        .pane-subtitle {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.5);
          margin: 0;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        /* Main Content */
        .mcp-desktop-content {
          flex: 1;
          overflow-y: auto;
          padding: 32px 48px;
        }

        /* High Density Multi-Column Flow */
        .mcp-rows-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
          gap: 12px;
        }
        .mcp-row-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 20px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          transition: all 0.2s ease;
        }
        .mcp-row-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .mcp-row-card.is-disabled {
          opacity: 0.6;
          filter: grayscale(100%);
        }
        
        .mcp-row-left {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .mcp-name-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .status-green { background: #10a37f; box-shadow: 0 0 8px rgba(16,163,127,0.5); }
        .status-red { background: #f85149; box-shadow: 0 0 8px rgba(248,81,73,0.5); }
        .status-muted { background: rgba(255,255,255,0.2); }
        
        .mcp-name-link {
          font-size: 15px;
          font-weight: 600;
          color: #e6edf3;
          text-decoration: none;
        }
        .mcp-name-link:hover {
          color: #58a6ff;
        }
        .badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .badge-accent { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
        .badge-muted { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
        
        .mcp-meta-group {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-left: 18px; /* Aligns under text */
        }
        .meta-text {
          font-size: 12px;
          color: rgba(255,255,255,0.4);
        }
        .text-mono {
          font-family: inherit;
        }
        .meta-separator {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: rgba(255,255,255,0.1);
        }

        .mcp-row-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* Drawers Overlay */
        .desktop-drawer-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 100;
          display: flex;
          justify-content: flex-end;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .desktop-drawer {
          width: 420px;
          background: #161b22;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: -12px 0 32px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .drawer-header {
          padding: 24px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .drawer-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #f0f6fc;
        }
        .drawer-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .drawer-footer {
          padding: 20px;
          border-top: 1px solid rgba(255,255,255,0.06);
          background: rgba(0,0,0,0.2);
        }

        /* Import List Styling */
        .import-list-box {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .import-list-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .import-list-item:hover:not(.already-imported) {
          background: rgba(255,255,255,0.06);
        }
        .import-list-item.already-imported {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .desktop-checkbox {
          accent-color: #10a37f;
          width: 16px;
          height: 16px;
        }
        .import-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .import-name {
          font-size: 14px;
          font-weight: 600;
          color: #f0f6fc;
        }
        .import-source {
          font-size: 12px;
          color: rgba(255,255,255,0.5);
        }

        /* Commons / Utilities */
        .empty-state-panel {
          padding: 64px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          border: 1px dashed rgba(255,255,255,0.1);
          border-radius: 12px;
          background: rgba(255,255,255,0.01);
        }
        .empty-state-panel.minimal {
          padding: 32px 16px;
        }
        .empty-icon {
          color: rgba(255,255,255,0.2);
          margin-bottom: 16px;
        }
        .empty-state-panel h3 { margin: 0 0 8px; font-weight: 600; font-size: 16px; }
        .empty-state-panel p { margin: 0; color: rgba(255,255,255,0.4); font-size: 14px; line-height: 1.5;}
        
        .error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: rgba(248, 81, 73, 0.1);
          border: 1px solid rgba(248, 81, 73, 0.2);
          border-radius: 8px;
          color: #f85149;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .btn-primary, .btn-secondary, .btn-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
        }
        .btn-primary {
          height: 32px;
          padding: 0 16px;
          background: transparent;
          color: #10a37f;
          border-color: #10a37f;
        }
        .btn-primary:hover:not(:disabled) { 
          background: rgba(16,163,127,0.08); 
          box-shadow: 0 0 8px rgba(16,163,127,0.15);
        }
        .btn-secondary {
          height: 32px;
          padding: 0 16px;
          background: rgba(255, 255, 255, 0.1);
          color: #f0f6fc;
          border-color: rgba(255, 255, 255, 0.05);
        }
        .btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); }
        .btn-icon {
          width: 32px;
          height: 32px;
          background: transparent;
          color: rgba(255,255,255,0.6);
        }
        .btn-icon:hover {
          background: rgba(255,255,255,0.1);
          color: #f0f6fc;
        }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .w-full { width: 100%; }
        .mt-4 { margin-top: 16px; }
        .ml-2 { margin-left: 8px; }
        .ml-auto { margin-left: auto; }
      `}</style>
    </div>
  );
}
