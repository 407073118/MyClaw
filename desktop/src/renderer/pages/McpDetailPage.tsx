import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { McpServer, McpServerConfig, McpSource, McpTool } from "@shared/contracts";
import { ToolRiskCategory } from "@shared/contracts";

// ── Inline McpServerForm component ───────────────────────────────────────────

interface McpServerFormProps {
  initialValue: McpServerConfig | null;
  isCreate: boolean;
  submitLabel: string;
  onSubmit: (config: McpServerConfig) => void;
  onCancel: () => void;
}

function McpServerForm({ initialValue, isCreate, submitLabel, onSubmit, onCancel }: McpServerFormProps) {
  const [transport, setTransport] = useState<"stdio" | "http">(
    initialValue?.transport ?? "stdio",
  );
  const [id, setId] = useState(initialValue?.id ?? "");
  const [name, setName] = useState(initialValue?.name ?? "");
  const [source, setSource] = useState<McpSource>(
    (initialValue?.source as McpSource) ?? "manual",
  );
  const [enabled, setEnabled] = useState(initialValue?.enabled ?? true);
  // stdio fields
  const [command, setCommand] = useState(
    initialValue?.transport === "stdio" ? initialValue.command ?? "" : "",
  );
  const [argsText, setArgsText] = useState(
    initialValue?.transport === "stdio" ? (initialValue.args ?? []).join(" ") : "",
  );
  const [cwd, setCwd] = useState(
    initialValue?.transport === "stdio" ? initialValue.cwd ?? "" : "",
  );
  const [envText, setEnvText] = useState(
    initialValue?.transport === "stdio"
      ? initialValue.env ? JSON.stringify(initialValue.env, null, 2) : ""
      : "",
  );
  // http fields
  const [url, setUrl] = useState(
    initialValue?.transport === "http" ? initialValue.url ?? "" : "",
  );
  const [headersText, setHeadersText] = useState(
    initialValue?.transport === "http"
      ? initialValue.headers ? JSON.stringify(initialValue.headers, null, 2) : ""
      : "",
  );
  const [formError, setFormError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!id.trim() || !name.trim()) {
      setFormError("服务 ID 和名称为必填项。");
      return;
    }

    try {
      if (transport === "stdio") {
        const args = argsText.trim() ? argsText.trim().split(/\s+/) : undefined;
        const env = envText.trim() ? JSON.parse(envText) : undefined;
        onSubmit({
          id: id.trim(),
          name: name.trim(),
          source,
          enabled,
          transport: "stdio",
          command: command.trim(),
          ...(args ? { args } : {}),
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          ...(env ? { env } : {}),
        });
      } else {
        const headers = headersText.trim() ? JSON.parse(headersText) : undefined;
        onSubmit({
          id: id.trim(),
          name: name.trim(),
          source,
          enabled,
          transport: "http",
          url: url.trim(),
          ...(headers ? { headers } : {}),
        });
      }
    } catch {
      setFormError("JSON 格式不正确，请检查 Env 或 Headers 字段。");
    }
  }

  return (
    <form className="server-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          <span>服务 ID</span>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="my-server"
            disabled={!isCreate}
          />
        </label>

        <label className="field">
          <span>服务名称</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My MCP Server"
          />
        </label>

        <label className="field">
          <span>传输方式</span>
          <select value={transport} onChange={(e) => setTransport(e.target.value as "stdio" | "http")}>
            <option value="stdio">STDIO</option>
            <option value="http">HTTP</option>
          </select>
        </label>

        <label className="field">
          <span>来源</span>
          <select value={source} onChange={(e) => setSource(e.target.value as McpSource)}>
            <option value="manual">manual</option>
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="cursor">cursor</option>
          </select>
        </label>
      </div>

      <label className="field checkbox-field">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>启用该服务</span>
      </label>

      {transport === "stdio" ? (
        <div className="form-grid">
          <label className="field full-width">
            <span>命令</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="node server.js"
            />
          </label>
          <label className="field full-width">
            <span>参数 (空格分隔)</span>
            <input
              type="text"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="--port 8080"
            />
          </label>
          <label className="field">
            <span>工作目录 (可选)</span>
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/server"
            />
          </label>
          <label className="field">
            <span>环境变量 JSON (可选)</span>
            <textarea
              rows={4}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder='{"API_KEY": "xxx"}'
            />
          </label>
        </div>
      ) : (
        <div className="form-grid">
          <label className="field full-width">
            <span>URL</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label className="field full-width">
            <span>请求头 JSON (可选)</span>
            <textarea
              rows={4}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder='{"Authorization": "Bearer xxx"}'
            />
          </label>
        </div>
      )}

      {formError && <p className="form-error">{formError}</p>}

      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="primary-button">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Helper functions ──────────────────────────────────────────────────────────

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function riskLabel(risk: McpTool["risk"]): string {
  if (risk === ToolRiskCategory.Read) return "读取";
  if (risk === ToolRiskCategory.Write) return "写入";
  if (risk === ToolRiskCategory.Exec) return "执行";
  if (risk === ToolRiskCategory.Install) return "安装";
  if (risk === ToolRiskCategory.Network) return "网络";
  return "未知";
}

function hasSchemaProperties(schema: Record<string, unknown>): boolean {
  const props = schema.properties;
  return Boolean(props && typeof props === "object" && Object.keys(props).length > 0);
}

function getSchemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties;
  if (props && typeof props === "object") {
    return props as Record<string, unknown>;
  }
  return {};
}

function isRequiredParam(schema: Record<string, unknown>, name: string): boolean {
  const required = schema.required;
  return Array.isArray(required) && required.includes(name);
}

function resolveParamType(def: unknown): string {
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.type === "string") return d.type;
  }
  return "any";
}

function resolveParamDesc(def: unknown): string {
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.description === "string" && d.description.trim()) return d.description.trim();
  }
  return "";
}

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

// ── McpDetailPage ─────────────────────────────────────────────────────────────

export default function McpDetailPage() {
  const { id: paramId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();

  const isCreate = !paramId || paramId === "new" || location.pathname === "/mcp/new";
  const serverId = paramId ?? "";

  const [isEditing, setIsEditing] = useState(isCreate);
  const [saveError, setSaveError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const prevPath = useRef(location.pathname);
  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      prevPath.current = location.pathname;
      setIsEditing(isCreate);
      setSaveError("");
    }
  }, [location.pathname, isCreate]);

  useEffect(() => {
    if (workspace.mcpServers.length > 0) return;
    console.info("[mcp-detail] MCP 服务列表为空，开始加载", { serverId, isCreate });
    workspace.loadMcpServers().catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "加载 MCP 服务失败。";
      setSaveError(msg);
      console.error("[mcp-detail] 加载 MCP 服务失败", { serverId, detail: msg });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentServer = useMemo(
    () => (isCreate ? null : workspace.mcpServers.find((item) => item.id === serverId) ?? null),
    [workspace.mcpServers, serverId, isCreate],
  );

  const formValue = useMemo<McpServerConfig | null>(
    () => (currentServer ? toServerConfig(currentServer) : null),
    [currentServer],
  );

  const pageTitle = isCreate ? "新建 MCP 服务" : "MCP 服务详情";
  const pageSubtitle = isCreate
    ? "填写连接方式与基础信息，创建一个新的 MCP 服务。"
    : "查看服务状态、连接配置与已发现工具。";

  const healthLabelKey = currentServer?.state?.health ?? currentServer?.health ?? "unknown";
  const healthLabel =
    healthLabelKey === "healthy" ? "正常" : healthLabelKey === "error" ? "异常" : "未知";

  const lastCheckedLabel = useMemo(() => {
    const value = currentServer?.state?.lastCheckedAt ?? currentServer?.lastCheckedAt ?? null;
    if (!isValidTimestamp(value)) return "—";
    return new Date(value).toLocaleString("zh-CN", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [currentServer]);

  const recentErrorLabel = safeString(
    currentServer?.state?.recentError ?? currentServer?.recentError ?? "",
    "—",
  );

  async function handleRefresh() {
    if (!currentServer) return;
    console.info("[mcp-detail] 刷新 MCP 服务", { serverId: currentServer.id });
    try {
      await workspace.refreshMcpServer(currentServer.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "刷新 MCP 服务失败。";
      setSaveError(msg);
    }
  }

  async function handleSyncTools() {
    if (!currentServer || syncing) return;
    setSyncing(true);
    setSaveError("");
    console.info("[mcp-detail] 同步 MCP 工具", { serverId: currentServer.id });
    try {
      await workspace.refreshMcpServer(currentServer.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "同步工具失败。";
      setSaveError(msg);
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggle() {
    if (!currentServer) return;
    const nextEnabled = !currentServer.enabled;
    const action = nextEnabled ? "启用" : "停用";
    if (!window.confirm(`确认${action}该 MCP 服务？${nextEnabled ? "启用后将尝试重新连接服务。" : "停用后将断开与服务的连接。"}`)) {
      return;
    }
    console.info("[mcp-detail] 切换 MCP 服务启用状态", {
      serverId: currentServer.id,
      enabled: currentServer.enabled,
    });
    try {
      await workspace.updateMcpServer(
        currentServer.id,
        toServerConfig(currentServer, nextEnabled),
      );
      if (nextEnabled) {
        // 启用后自动尝试重连
        try {
          await workspace.refreshMcpServer(currentServer.id);
        } catch {
          // 连接失败不阻塞，用户可手动刷新
        }
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "切换 MCP 服务状态失败。");
    }
  }

  async function handleDelete() {
    if (!currentServer) return;
    if (!window.confirm(`确认删除 MCP 服务「${currentServer.name}」？此操作不可撤销。`)) {
      return;
    }
    console.info("[mcp-detail] 删除 MCP 服务", { serverId: currentServer.id });
    try {
      await workspace.deleteMcpServer(currentServer.id);
      navigate("/mcp");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "删除 MCP 服务失败。");
    }
  }

  function enterEditMode() {
    console.info("[mcp-detail] 进入 MCP 编辑态", { serverId: currentServer?.id ?? null });
    setIsEditing(true);
    setSaveError("");
  }

  function handleCancelEdit() {
    console.info("[mcp-detail] 取消 MCP 编辑", { serverId: currentServer?.id ?? null, isCreate });
    setSaveError("");
    if (isCreate) {
      navigate("/mcp");
      return;
    }
    setIsEditing(false);
  }

  async function handleSave(config: McpServerConfig) {
    console.info("[mcp-detail] 保存 MCP 服务", { serverId: config.id, isCreate, transport: config.transport });
    try {
      if (isCreate) {
        const created = await workspace.createMcpServer(config);
        navigate(`/mcp/${encodeURIComponent(created.id)}`);
        return;
      }

      if (!currentServer) {
        throw new Error("未找到要更新的 MCP 服务。");
      }

      await workspace.updateMcpServer(currentServer.id, config);
      setIsEditing(false);
      setSaveError("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "保存 MCP 服务失败。";
      setSaveError(msg);
      console.error("[mcp-detail] 保存 MCP 服务失败", { serverId: config.id, detail: msg });
    }
  }

  return (
    <main data-testid="mcp-detail-view" className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">MCP 详情</span>
          <h2 className="page-title">{pageTitle}</h2>
          <p className="page-subtitle">{pageSubtitle}</p>
        </div>
        <div className="header-actions">
          <Link to="/mcp" className="secondary-link">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回列表
          </Link>
          {currentServer && !isEditing && (
            <>
              <button
                type="button"
                className="secondary-button"
                data-testid="mcp-detail-refresh"
                onClick={handleRefresh}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                刷新
              </button>
              <button
                type="button"
                className="secondary-button"
                data-testid="mcp-detail-toggle"
                onClick={handleToggle}
              >
                {currentServer.enabled ? "停用" : "启用"}
              </button>
              <button
                type="button"
                className="primary-button"
                data-testid="mcp-detail-edit"
                onClick={enterEditMode}
              >
                编辑
              </button>
              <button
                type="button"
                className="danger-button"
                data-testid="mcp-detail-delete"
                onClick={handleDelete}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                删除
              </button>
            </>
          )}
        </div>
      </header>

      {saveError && <p className="error-banner">{saveError}</p>}

      {isCreate || isEditing ? (
        <section className="detail-card">
          <h3 className="section-title">{isCreate ? "新建 MCP 服务" : "编辑 MCP 服务"}</h3>
          <McpServerForm
            initialValue={formValue}
            isCreate={isCreate}
            submitLabel={isCreate ? "创建服务" : "保存修改"}
            onSubmit={handleSave}
            onCancel={handleCancelEdit}
          />
        </section>
      ) : !currentServer ? (
        <section className="empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-icon">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <h3>未找到 MCP 服务</h3>
          <p>请返回列表检查所选服务 ID 是否正确。</p>
        </section>
      ) : (
        <>
          {/* 概览 + 连接配置 */}
          <section className="detail-grid">
            <article className="detail-card overview-card">
              <div className="card-head">
                <h3 className="section-title">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  概览
                </h3>
              </div>
              <dl className="info-grid">
                <div className="info-item">
                  <dt>服务 ID</dt>
                  <dd className="mono-text">{currentServer.id}</dd>
                </div>
                <div className="info-item">
                  <dt>名称</dt>
                  <dd>{currentServer.name}</dd>
                </div>
                <div className="info-item">
                  <dt>健康状态</dt>
                  <dd>
                    <span className="inline-badge" data-health={healthLabelKey}>{healthLabel}</span>
                  </dd>
                </div>
                <div className="info-item">
                  <dt>启用状态</dt>
                  <dd>
                    <span className="inline-badge" data-enabled={String(currentServer.enabled)}>
                      {currentServer.enabled ? "已启用" : "已停用"}
                    </span>
                  </dd>
                </div>
              </dl>
            </article>

            <article className="detail-card connection-card">
              <div className="card-head">
                <h3 className="section-title">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  连接配置
                </h3>
              </div>
              <dl className="info-grid">
                <div className="info-item">
                  <dt>传输方式</dt>
                  <dd>
                    <span className="transport-badge">
                      {currentServer.transport === "http" ? "HTTP" : "STDIO"}
                    </span>
                  </dd>
                </div>
                {currentServer.transport === "stdio" ? (
                  <>
                    <div className="info-item">
                      <dt>命令</dt>
                      <dd className="mono-text">{currentServer.command}</dd>
                    </div>
                    <div className="info-item full-width">
                      <dt>参数</dt>
                      <dd className="mono-text">{(currentServer.args ?? []).join(" ") || "—"}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="info-item full-width">
                      <dt>URL</dt>
                      <dd className="mono-text">{currentServer.url}</dd>
                    </div>
                    <div className="info-item full-width">
                      <dt>请求头</dt>
                      <dd className="mono-text">
                        {currentServer.headers
                          ? JSON.stringify(currentServer.headers, null, 2)
                          : "—"}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          </section>

          {/* 工具列表 + 运行状态 */}
          <section className="detail-grid">
            <article className="detail-card tools-card">
              <div className="card-head">
                <h3 className="section-title">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  工具列表
                  <span className="tool-count-badge">{currentServer.tools.length}</span>
                </h3>
                <button
                  type="button"
                  className="sync-button"
                  data-testid="mcp-detail-sync-tools"
                  disabled={syncing}
                  onClick={handleSyncTools}
                >
                  <svg
                    className={syncing ? "spinning" : ""}
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  {syncing ? "同步中..." : "同步工具"}
                </button>
              </div>

              {currentServer.tools.length > 0 ? (
                <div className="tool-grid">
                  {currentServer.tools.map((tool) => (
                    <div key={tool.id} className="tool-card">
                      <div className="tool-header">
                        <div className="tool-name">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                            <path d="M16 3h-8l-2 4h12z" />
                          </svg>
                          {tool.name}
                        </div>
                        <span className="risk-badge" data-risk={tool.risk ?? "unknown"}>
                          {riskLabel(tool.risk)}
                        </span>
                      </div>
                      {tool.description && <p className="tool-desc">{tool.description}</p>}
                      {tool.inputSchema && hasSchemaProperties(tool.inputSchema) && (
                        <div className="tool-schema">
                          <div className="schema-header">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="4 7 4 4 20 4 20 7" />
                              <line x1="9" y1="20" x2="15" y2="20" />
                              <line x1="12" y1="4" x2="12" y2="20" />
                            </svg>
                            输入参数
                          </div>
                          <div className="schema-params">
                            {Object.entries(getSchemaProperties(tool.inputSchema)).map(([paramName, paramDef]) => (
                              <div key={paramName} className="param-row">
                                <span className="param-name">{paramName}</span>
                                <span className="param-type">{resolveParamType(paramDef)}</span>
                                {isRequiredParam(tool.inputSchema!, paramName) && (
                                  <span className="param-required">required</span>
                                )}
                                {resolveParamDesc(paramDef) && (
                                  <span className="param-desc">{resolveParamDesc(paramDef)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="placeholder-state">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" className="placeholder-icon">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <p>暂未发现工具，点击"同步工具"尝试重新拉取。</p>
                </div>
              )}
            </article>

            <article className="detail-card runtime-card">
              <div className="card-head">
                <h3 className="section-title">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  运行状态
                </h3>
              </div>
              <dl className="info-grid">
                <div className="info-item">
                  <dt>连接状态</dt>
                  <dd>
                    <span
                      className="inline-badge"
                      data-connected={String(currentServer.state?.connected ?? false)}
                    >
                      {currentServer.state?.connected ? "已连接" : "未连接"}
                    </span>
                  </dd>
                </div>
                <div className="info-item">
                  <dt>工具数量</dt>
                  <dd className="stat-value">
                    {currentServer.state?.toolCount ?? currentServer.tools.length}
                  </dd>
                </div>
                <div className="info-item">
                  <dt>最近检查时间</dt>
                  <dd>{lastCheckedLabel}</dd>
                </div>
                <div className="info-item full-width">
                  <dt>最近错误</dt>
                  <dd className={recentErrorLabel !== "—" ? "error-text" : ""}>{recentErrorLabel}</dd>
                </div>
              </dl>
            </article>
          </section>
        </>
      )}

      <style>{`
        .page-container {
          height: 100%;
          overflow-y: auto;
          padding-bottom: 40px;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 28px;
        }

        .header-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .eyebrow {
          display: inline-block;
          margin-bottom: 8px;
          color: var(--accent-cyan, #67e8f9);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .page-title {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text-primary, #fff);
        }

        .page-subtitle {
          margin: 10px 0 0;
          max-width: 620px;
          color: var(--text-secondary, #b0b0b8);
          line-height: 1.7;
        }

        .secondary-link, .secondary-button, .primary-button {
          height: 32px;
          border-radius: 8px;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .secondary-link, .secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-decoration: none;
          border: 1px solid var(--glass-border, #41414b);
          background: transparent;
          color: var(--text-primary, #fff);
          cursor: pointer;
        }

        .secondary-link:hover, .secondary-button:hover {
          border-color: var(--accent-cyan, #67e8f9);
          color: var(--accent-cyan, #67e8f9);
        }

        .primary-button {
          border: none;
          color: #fff;
          background: linear-gradient(135deg, var(--accent-cyan), rgba(16, 163, 127, 0.7));
          cursor: pointer;
        }

        .primary-button:hover {
          filter: brightness(1.15);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(16, 163, 127, 0.25);
        }

        .danger-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 32px;
          border-radius: 8px;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid rgba(239, 68, 68, 0.4);
          background: rgba(239, 68, 68, 0.12);
          color: #f87171;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .danger-button:hover {
          background: rgba(239, 68, 68, 0.25);
          border-color: rgba(239, 68, 68, 0.6);
        }

        .error-banner {
          margin: 0 0 20px;
          padding: 14px 18px;
          border-radius: 14px;
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          font-size: 13px;
          line-height: 1.6;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 56px 24px;
          border-radius: 18px;
          border: 1px dashed var(--glass-border, #3f3f46);
          background: color-mix(in srgb, var(--bg-card, #1b1b20) 70%, transparent);
          text-align: center;
        }

        .empty-icon { color: var(--text-muted, #6b6b76); }
        .empty-state h3 { margin: 0; color: var(--text-primary, #fff); }
        .empty-state p { margin: 0; color: var(--text-secondary, #b0b0b8); }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          margin-bottom: 20px;
        }

        .detail-card {
          padding: 24px;
          border-radius: 18px;
          border: 1px solid var(--glass-border, #30303a);
          background: var(--bg-card, #18181b);
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
        }

        .detail-card:hover {
          border-color: color-mix(in srgb, var(--accent-cyan) 30%, var(--glass-border, #30303a));
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
          transform: translateY(-2px);
        }

        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary, #fff);
        }

        .section-title svg { color: var(--accent-cyan, #67e8f9); flex-shrink: 0; }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin: 0;
        }

        .info-item {
          padding: 12px 14px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--bg-base, #121214) 80%, transparent);
          border: 1px solid var(--glass-border, #28282f);
        }

        .info-item.full-width { grid-column: 1 / -1; }

        .info-item dt {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted, #8d8d97);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        .info-item dd {
          margin: 0;
          font-size: 13px;
          color: var(--text-primary, #fff);
          line-height: 1.6;
          word-break: break-word;
        }

        .mono-text {
          font-family: "JetBrains Mono", "Fira Code", monospace;
          font-size: 12px;
        }

        .stat-value { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
        .error-text { color: #fca5a5; }

        .inline-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid var(--glass-border, #3f3f46);
          background: color-mix(in srgb, var(--bg-base, #111214) 80%, transparent);
          color: var(--text-secondary, #b0b0b8);
        }

        .inline-badge[data-health="healthy"],
        .inline-badge[data-connected="true"],
        .inline-badge[data-enabled="true"] {
          color: var(--status-green);
          border-color: rgba(34, 197, 94, 0.25);
          background: rgba(34, 197, 94, 0.1);
        }

        .inline-badge[data-health="error"] {
          color: var(--status-red);
          border-color: rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.1);
        }

        .transport-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          font-family: monospace;
          letter-spacing: 0.04em;
          color: var(--accent-cyan, #67e8f9);
          background: rgba(103, 232, 249, 0.08);
          border: 1px solid rgba(103, 232, 249, 0.18);
        }

        .tools-card { grid-column: 1 / -1; }

        .tool-count-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          color: var(--accent-cyan, #67e8f9);
          background: rgba(103, 232, 249, 0.12);
        }

        .sync-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid var(--glass-border, #3f3f46);
          background: transparent;
          color: var(--text-secondary, #b0b0b8);
          cursor: pointer;
          transition: all 0.2s;
        }

        .sync-button:hover:not(:disabled) {
          border-color: var(--accent-cyan, #67e8f9);
          color: var(--accent-cyan, #67e8f9);
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        .sync-button:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinning { animation: spin 1s linear infinite; }

        .tool-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
        }

        .tool-card {
          padding: 14px;
          border-radius: 12px;
          border: 1px solid var(--glass-border, #28282f);
          background: color-mix(in srgb, var(--bg-base, #121214) 70%, transparent);
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
        }

        .tool-card:hover {
          border-color: var(--glass-border, #3f3f46);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          transform: translateY(-1px);
        }

        .tool-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .tool-name {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        .risk-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--glass-border, #3f3f46);
          color: var(--text-secondary, #b0b0b8);
        }

        .risk-badge[data-risk="low"] { color: var(--status-green); border-color: rgba(34,197,94,0.25); background: rgba(34,197,94,0.08); }
        .risk-badge[data-risk="medium"] { color: var(--status-yellow); border-color: rgba(245,158,11,0.25); background: rgba(245,158,11,0.08); }
        .risk-badge[data-risk="high"] { color: var(--status-red); border-color: rgba(239,68,68,0.25); background: rgba(239,68,68,0.08); }

        .tool-desc { font-size: 12px; color: var(--text-secondary, #b0b0b8); margin: 0; line-height: 1.5; }

        .tool-schema {
          padding-top: 8px;
          border-top: 1px solid var(--glass-border, #28282f);
        }

        .schema-header {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted, #71717a);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 8px;
        }

        .schema-params { display: flex; flex-direction: column; gap: 4px; }

        .param-row {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          font-size: 12px;
        }

        .param-name { font-weight: 600; color: var(--text-primary, #fff); font-family: monospace; }
        .param-type { color: var(--accent-cyan, #67e8f9); font-family: monospace; }
        .param-required { color: #fbbf24; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .param-desc { color: var(--text-muted, #71717a); }

        .placeholder-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 32px;
          text-align: center;
        }

        .placeholder-icon { color: var(--text-muted, #52525b); }
        .placeholder-state p { margin: 0; color: var(--text-secondary, #b0b0b8); font-size: 13px; }

        /* Form Styles */
        .server-form { display: flex; flex-direction: column; gap: 20px; }

        .form-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-secondary, #a1a1aa);
          font-size: 13px;
        }

        .field.full-width { grid-column: 1 / -1; }

        .checkbox-field {
          flex-direction: row;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: var(--glass-reflection, rgba(255,255,255,0.04));
          border: 1px solid var(--glass-border, #27272a);
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .checkbox-field:hover { background: rgba(255,255,255,0.06); }
        .checkbox-field input[type="checkbox"] {
          width: 16px;
          height: 16px;
          accent-color: var(--accent-cyan, #10a37f);
          cursor: pointer;
        }
        .checkbox-field span { font-weight: 500; color: var(--text-primary, #ededed); }

        .field input, .field select, .field textarea {
          background: var(--bg-base, #121214);
          border: 1px solid var(--glass-border, #27272a);
          border-radius: 8px;
          color: var(--text-primary, #fff);
          padding: 10px 12px;
          font: inherit;
          font-size: 14px;
          outline: none;
          width: 100%;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .field input:focus, .field select:focus, .field textarea:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14);
        }

        .field input:disabled { opacity: 0.5; cursor: not-allowed; }

        .form-error { margin: 0; color: var(--status-red); font-size: 13px; }

        .form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding-top: 8px;
        }

        @media (max-width: 900px) {
          .detail-grid { grid-template-columns: 1fr; }
          .form-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}
