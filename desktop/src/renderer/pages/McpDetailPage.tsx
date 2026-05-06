import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { McpServer, McpServerConfig, McpSource, McpTool } from "@shared/contracts";
import { ToolRiskCategory } from "@shared/contracts";
import {
  Activity,
  AlertCircle,
  ChevronLeft,
  Edit3,
  Link2,
  Plug,
  Power,
  RefreshCw,
  Settings,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";

// ── 内联 McpServerForm 组件 ──────────────────────────────────────────────────

interface McpServerFormProps {
  initialValue: McpServerConfig | null;
  isCreate: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (config: McpServerConfig) => void;
  onCancel: () => void;
}

/** 渲染 MCP 服务表单，并兼容 stdio/http 两种传输方式。 */
function McpServerForm({
  initialValue,
  isCreate,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: McpServerFormProps) {
  const [transport, setTransport] = useState<"stdio" | "http">(
    initialValue?.transport ?? "stdio",
  );
  const [id, setId] = useState(initialValue?.id ?? "");
  const [name, setName] = useState(initialValue?.name ?? "");
  const [source, setSource] = useState<McpSource>(
    (initialValue?.source as McpSource) ?? "manual",
  );
  const [enabled, setEnabled] = useState(initialValue?.enabled ?? true);
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
  const [url, setUrl] = useState(
    initialValue?.transport === "http" ? initialValue.url ?? "" : "",
  );
  const [headersText, setHeadersText] = useState(
    initialValue?.transport === "http"
      ? initialValue.headers ? JSON.stringify(initialValue.headers, null, 2) : ""
      : "",
  );
  const [formError, setFormError] = useState("");

  /** 收集表单数据并组装成 MCP 服务配置。 */
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
    <form className="mcp-form" onSubmit={handleSubmit}>
      <div className="mcp-form-grid">
        <label className="mcp-form-field">
          <span>服务 ID</span>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="my-server"
            disabled={!isCreate || submitting}
          />
        </label>

        <label className="mcp-form-field">
          <span>服务名称</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My MCP Server"
            disabled={submitting}
          />
        </label>

        <label className="mcp-form-field">
          <span>传输方式</span>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
            disabled={submitting}
          >
            <option value="stdio">STDIO</option>
            <option value="http">HTTP</option>
          </select>
        </label>

        <label className="mcp-form-field">
          <span>来源</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as McpSource)}
            disabled={submitting}
          >
            <option value="manual">manual</option>
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="cursor">cursor</option>
          </select>
        </label>
      </div>

      <label className="mcp-form-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={submitting}
        />
        <span>启用该服务</span>
      </label>

      {transport === "stdio" ? (
        <div className="mcp-form-grid">
          <label className="mcp-form-field mcp-form-field--full">
            <span>命令</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="node server.js"
              disabled={submitting}
            />
          </label>
          <label className="mcp-form-field mcp-form-field--full">
            <span>参数（空格分隔）</span>
            <input
              type="text"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="--port 8080"
              disabled={submitting}
            />
          </label>
          <label className="mcp-form-field">
            <span>工作目录（可选）</span>
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/server"
              disabled={submitting}
            />
          </label>
          <label className="mcp-form-field">
            <span>环境变量 JSON（可选）</span>
            <textarea
              rows={4}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder='{"API_KEY": "xxx"}'
              disabled={submitting}
            />
          </label>
        </div>
      ) : (
        <div className="mcp-form-grid">
          <label className="mcp-form-field mcp-form-field--full">
            <span>URL</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              disabled={submitting}
            />
          </label>
          <label className="mcp-form-field mcp-form-field--full">
            <span>请求头 JSON（可选）</span>
            <textarea
              rows={4}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder='{"Authorization": "Bearer xxx"}'
              disabled={submitting}
            />
          </label>
        </div>
      )}

      {formError && <p className="mcp-form-error">{formError}</p>}

      <div className="mcp-form-actions">
        <button type="button" className="btn-toolbar" onClick={onCancel} disabled={submitting}>
          取消
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── 辅助方法 ──────────────────────────────────────────────────────────────────

/** 安全提取字符串值，缺失时返回兜底文案。 */
function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/** 判断给定值是否为可解析的时间戳字符串。 */
function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/** 把工具风险枚举转换成中文标签。 */
function riskLabel(risk: McpTool["risk"]): string {
  if (risk === ToolRiskCategory.Read) return "读取";
  if (risk === ToolRiskCategory.Write) return "写入";
  if (risk === ToolRiskCategory.Exec) return "执行";
  if (risk === ToolRiskCategory.Install) return "安装";
  if (risk === ToolRiskCategory.Network) return "网络";
  return "未知";
}

/** 把工具风险枚举映射为状态色变体。 */
function riskVariant(risk: McpTool["risk"]): "green" | "yellow" | "red" | "muted" {
  if (risk === ToolRiskCategory.Read) return "green";
  if (risk === ToolRiskCategory.Write || risk === ToolRiskCategory.Network) return "yellow";
  if (risk === ToolRiskCategory.Exec || risk === ToolRiskCategory.Install) return "red";
  return "muted";
}

/** 判断工具输入 schema 是否包含 `properties` 定义。 */
function hasSchemaProperties(schema: Record<string, unknown>): boolean {
  const props = schema.properties;
  return Boolean(props && typeof props === "object" && Object.keys(props).length > 0);
}

/** 提取 schema 中的属性定义对象。 */
function getSchemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties;
  if (props && typeof props === "object") {
    return props as Record<string, unknown>;
  }
  return {};
}

/** 判断某个参数是否属于 schema 的必填项。 */
function isRequiredParam(schema: Record<string, unknown>, name: string): boolean {
  const required = schema.required;
  return Array.isArray(required) && required.includes(name);
}

/** 解析参数类型字段，缺失时回退为 `any`。 */
function resolveParamType(def: unknown): string {
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.type === "string") return d.type;
  }
  return "any";
}

/** 解析参数描述字段，缺失时回退为空字符串。 */
function resolveParamDesc(def: unknown): string {
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.description === "string" && d.description.trim()) return d.description.trim();
  }
  return "";
}

/** 把 MCP 服务对象重新组装成可编辑的配置结构。 */
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

// ── McpDetailPage 页面 ───────────────────────────────────────────────────────

/** 展示 MCP 服务详情，并支持创建、编辑、同步与工具预览。 */
export default function McpDetailPage() {
  const { id: paramId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();

  const isCreate = !paramId || paramId === "new" || location.pathname === "/mcp/new";
  const serverId = paramId ?? "";

  const [isEditing, setIsEditing] = useState(isCreate);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
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
  const healthVariant: "green" | "red" | "muted" =
    healthLabelKey === "healthy" ? "green" : healthLabelKey === "error" ? "red" : "muted";

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
    if (
      !window.confirm(
        `确认${action}该 MCP 服务？${nextEnabled ? "启用后将尝试重新连接服务。" : "停用后将断开与服务的连接。"}`,
      )
    ) {
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
    console.info("[mcp-detail] 取消 MCP 编辑", {
      serverId: currentServer?.id ?? null,
      isCreate,
    });
    setSaveError("");
    if (isCreate) {
      navigate("/mcp");
      return;
    }
    setIsEditing(false);
  }

  async function handleSave(config: McpServerConfig) {
    if (isSaving) return;
    console.info("[mcp-detail] 保存 MCP 服务", {
      serverId: config.id,
      isCreate,
      transport: config.transport,
    });
    setIsSaving(true);
    setSaveError("");
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
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-shell" data-testid="mcp-detail-view">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Plug size={14} />
            <span>MCP 详情</span>
          </div>
          <h2 className="page-header__title">{pageTitle}</h2>
          <p className="page-header__subtitle">{pageSubtitle}</p>
        </div>
        <div className="page-header__actions">
          <Link to="/mcp" className="btn-toolbar">
            <ChevronLeft size={14} />
            返回列表
          </Link>
          {currentServer && !isEditing && (
            <>
              <button
                type="button"
                className="btn-toolbar"
                data-testid="mcp-detail-refresh"
                onClick={handleRefresh}
              >
                <RefreshCw size={14} />
                刷新
              </button>
              <button
                type="button"
                className="btn-toolbar"
                data-testid="mcp-detail-toggle"
                onClick={handleToggle}
              >
                <Power size={14} />
                {currentServer.enabled ? "停用" : "启用"}
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="mcp-detail-edit"
                onClick={enterEditMode}
              >
                <Edit3 size={14} />
                编辑
              </button>
              <button
                type="button"
                className="btn-ghost btn-ghost--danger"
                data-testid="mcp-detail-delete"
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                删除
              </button>
            </>
          )}
        </div>
      </header>

      <main className="page-content">
        <div className="mcp-detail-content">
          {saveError && (
            <div className="banner banner--error">
              <AlertCircle size={16} />
              <span>{saveError}</span>
            </div>
          )}

          {isCreate || isEditing ? (
            <article className="glass-card glass-card--flat mcp-info-card">
              <h3 className="mcp-section-title">
                <Settings2 size={14} />
                {isCreate ? "新建 MCP 服务" : "编辑 MCP 服务"}
              </h3>
              <McpServerForm
                initialValue={formValue}
                isCreate={isCreate}
                submitting={isSaving}
                submitLabel={isSaving ? "保存中..." : isCreate ? "创建服务" : "保存修改"}
                onSubmit={handleSave}
                onCancel={handleCancelEdit}
              />
            </article>
          ) : !currentServer ? (
            <section className="empty-state">
              <AlertCircle size={32} className="empty-state__icon" />
              <h3 className="empty-state__title">未找到 MCP 服务</h3>
              <p className="empty-state__body">请返回列表检查所选服务 ID 是否正确。</p>
              <Link to="/mcp" className="btn-toolbar">
                <ChevronLeft size={14} />
                返回列表
              </Link>
            </section>
          ) : (
            <>
              <div className="mcp-detail-grid">
                <article className="glass-card glass-card--flat mcp-info-card">
                  <h3 className="mcp-section-title">
                    <Settings size={14} />
                    概览
                  </h3>
                  <dl className="mcp-info-list">
                    <div>
                      <dt>服务 ID</dt>
                      <dd className="mcp-mono">{currentServer.id}</dd>
                    </div>
                    <div>
                      <dt>名称</dt>
                      <dd>{currentServer.name}</dd>
                    </div>
                    <div>
                      <dt>健康状态</dt>
                      <dd>
                        <span className={`tag tag--${healthVariant}`}>{healthLabel}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>启用状态</dt>
                      <dd>
                        <span
                          className={`tag tag--${currentServer.enabled ? "green" : "muted"}`}
                        >
                          {currentServer.enabled ? "已启用" : "已停用"}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </article>

                <article className="glass-card glass-card--flat mcp-info-card">
                  <h3 className="mcp-section-title">
                    <Link2 size={14} />
                    连接配置
                  </h3>
                  <dl className="mcp-info-list">
                    <div>
                      <dt>传输方式</dt>
                      <dd>
                        <span className="tag tag--accent">
                          {currentServer.transport.toUpperCase()}
                        </span>
                      </dd>
                    </div>
                    {currentServer.transport === "stdio" ? (
                      <>
                        <div>
                          <dt>命令</dt>
                          <dd className="mcp-mono">{currentServer.command}</dd>
                        </div>
                        <div>
                          <dt>参数</dt>
                          <dd className="mcp-mono">
                            {(currentServer.args ?? []).join(" ") || "—"}
                          </dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <dt>URL</dt>
                          <dd className="mcp-mono">{currentServer.url}</dd>
                        </div>
                        <div>
                          <dt>请求头</dt>
                          <dd className="mcp-mono mcp-mono--block">
                            {currentServer.headers
                              ? JSON.stringify(currentServer.headers, null, 2)
                              : "—"}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                </article>
              </div>

              <article className="glass-card glass-card--flat mcp-info-card">
                <div className="mcp-section-head">
                  <h3 className="mcp-section-title">
                    <Wrench size={14} />
                    工具列表
                    <span className="tag tag--muted" style={{ marginLeft: 4 }}>
                      {currentServer.tools.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    className="btn-toolbar"
                    data-testid="mcp-detail-sync-tools"
                    disabled={syncing}
                    onClick={handleSyncTools}
                  >
                    <RefreshCw size={14} className={syncing ? "mcp-spin" : ""} />
                    {syncing ? "同步中..." : "同步工具"}
                  </button>
                </div>

                {currentServer.tools.length > 0 ? (
                  <div className="list-rows">
                    {currentServer.tools.map((tool) => {
                      const hasSchema =
                        tool.inputSchema && hasSchemaProperties(tool.inputSchema);
                      const params = hasSchema
                        ? Object.entries(getSchemaProperties(tool.inputSchema!))
                        : [];

                      return (
                        <article
                          key={tool.id}
                          className="list-row list-row--with-description"
                        >
                          <div className="list-row__lead">
                            <Wrench size={14} style={{ color: "var(--text-muted)" }} />
                          </div>
                          <div className="list-row__main">
                            <div className="list-row__title-row">
                              <span className="list-row__title">{tool.name}</span>
                              <span className={`tag tag--${riskVariant(tool.risk)}`}>
                                {riskLabel(tool.risk)}
                              </span>
                            </div>
                            {tool.description && (
                              <div className="list-row__description">{tool.description}</div>
                            )}
                            {hasSchema && (
                              <details className="mcp-tool-schema">
                                <summary>输入参数（{params.length}）</summary>
                                <ul className="mcp-tool-params">
                                  {params.map(([paramName, paramDef]) => (
                                    <li key={paramName} className="mcp-tool-param">
                                      <code className="mcp-param-name">{paramName}</code>
                                      <span className="mcp-param-type">
                                        {resolveParamType(paramDef)}
                                      </span>
                                      {isRequiredParam(tool.inputSchema!, paramName) && (
                                        <span className="mcp-param-required">required</span>
                                      )}
                                      {resolveParamDesc(paramDef) && (
                                        <span className="mcp-param-desc">
                                          {resolveParamDesc(paramDef)}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state empty-state--minimal">
                    <p className="empty-state__body">
                      暂未发现工具，点击「同步工具」尝试重新拉取。
                    </p>
                  </div>
                )}
              </article>

              <article className="glass-card glass-card--flat mcp-info-card">
                <h3 className="mcp-section-title">
                  <Activity size={14} />
                  运行状态
                </h3>
                <dl className="mcp-info-list">
                  <div>
                    <dt>连接状态</dt>
                    <dd>
                      <span
                        className={`tag tag--${currentServer.state?.connected ? "green" : "muted"}`}
                      >
                        {currentServer.state?.connected ? "已连接" : "未连接"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>工具数量</dt>
                    <dd className="mcp-stat-value">
                      {currentServer.state?.toolCount ?? currentServer.tools.length}
                    </dd>
                  </div>
                  <div>
                    <dt>最近检查时间</dt>
                    <dd className="mcp-mono">{lastCheckedLabel}</dd>
                  </div>
                  <div>
                    <dt>最近错误</dt>
                    <dd
                      className={recentErrorLabel !== "—" ? "mcp-error-text" : ""}
                    >
                      {recentErrorLabel}
                    </dd>
                  </div>
                </dl>
              </article>
            </>
          )}
        </div>
      </main>

      <style>{`
        /* MCP 详情页：max-width 1100，单列流式（双列 grid 仅用于概览/连接） */
        .mcp-detail-content {
          max-width: 1100px;
          margin: 0 auto;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .mcp-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        /* 段落卡片内边距（覆盖 .glass-card 默认无 padding） */
        .mcp-info-card { padding: 18px 20px; }

        .mcp-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 14px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .mcp-section-title svg { color: var(--text-muted); flex-shrink: 0; }

        .mcp-section-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .mcp-section-head .mcp-section-title { margin-bottom: 0; }

        /* 键值列表（label | value） */
        .mcp-info-list {
          display: flex;
          flex-direction: column;
          gap: 0;
          margin: 0;
        }
        .mcp-info-list > div {
          display: grid;
          grid-template-columns: 96px 1fr;
          align-items: center;
          gap: 16px;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          min-width: 0;
        }
        .mcp-info-list > div:last-child { border-bottom: none; }
        .mcp-info-list dt {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
        }
        .mcp-info-list dd {
          margin: 0;
          font-size: 13px;
          color: var(--text-primary);
          line-height: 1.55;
          word-break: break-word;
          min-width: 0;
        }

        .mcp-mono {
          font-family: "Cascadia Code", "Fira Code", ui-monospace, "SFMono-Regular", monospace;
          font-size: 12px;
        }
        .mcp-mono--block {
          white-space: pre;
          padding: 8px 10px;
          background: var(--bg-base);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          overflow-x: auto;
        }

        .mcp-stat-value {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--text-primary);
        }
        .mcp-error-text { color: var(--status-red); }

        /* 工具行内的折叠 schema */
        .mcp-tool-schema {
          margin-top: 6px;
        }
        .mcp-tool-schema summary {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px 0;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .mcp-tool-schema summary:hover { color: var(--text-secondary); }
        .mcp-tool-schema[open] summary { color: var(--text-primary); }

        .mcp-tool-params {
          list-style: none;
          padding: 6px 0 4px;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .mcp-tool-param {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 8px;
          font-size: 12px;
        }
        .mcp-param-name {
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          font-size: 12px;
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.04);
          padding: 1px 5px;
          border-radius: var(--radius-sm);
        }
        .mcp-param-type {
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          color: var(--accent-cyan);
        }
        .mcp-param-required {
          font-size: 10px;
          font-weight: 700;
          color: var(--status-yellow);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .mcp-param-desc {
          color: var(--text-muted);
          flex: 1;
          min-width: 200px;
        }

        @keyframes mcp-spin { to { transform: rotate(360deg); } }
        .mcp-spin { animation: mcp-spin 1s linear infinite; }

        /* 表单 */
        .mcp-form { display: flex; flex-direction: column; gap: 14px; }
        .mcp-form-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .mcp-form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .mcp-form-field--full { grid-column: 1 / -1; }
        .mcp-form-field > span {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
        }
        .mcp-form-field input,
        .mcp-form-field select,
        .mcp-form-field textarea {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          box-sizing: border-box;
        }
        .mcp-form-field input:hover:not(:disabled),
        .mcp-form-field select:hover:not(:disabled),
        .mcp-form-field textarea:hover:not(:disabled) {
          border-color: var(--glass-border-hover);
        }
        .mcp-form-field input:focus,
        .mcp-form-field select:focus,
        .mcp-form-field textarea:focus {
          outline: none;
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.14);
        }
        .mcp-form-field input:disabled,
        .mcp-form-field select:disabled,
        .mcp-form-field textarea:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .mcp-form-field select {
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          padding-right: 32px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          background-size: 12px;
        }
        .mcp-form-field textarea {
          font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace;
          resize: vertical;
        }

        .mcp-form-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--row-border);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .mcp-form-checkbox:hover {
          background: var(--bg-surface-hover);
          border-color: var(--row-border-hover);
        }
        .mcp-form-checkbox input[type="checkbox"] {
          accent-color: var(--accent-cyan);
          width: 14px;
          height: 14px;
          margin: 0;
        }
        .mcp-form-checkbox span {
          font-size: 13px;
          color: var(--text-primary);
        }

        .mcp-form-error {
          margin: 0;
          color: var(--status-red);
          font-size: 13px;
        }

        .mcp-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 4px;
        }

        @media (max-width: 900px) {
          .mcp-detail-grid { grid-template-columns: 1fr; }
          .mcp-form-grid { grid-template-columns: 1fr; }
          .mcp-info-list > div { grid-template-columns: 80px 1fr; }
        }
      `}</style>
    </div>
  );
}
