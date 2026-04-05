import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspace";
import { readBrMiniMaxRuntimeDiagnostics } from "@shared/br-minimax";

type ApprovalMode = "prompt" | "auto-read-only" | "auto-allow-all" | "unrestricted";

const DEFAULT_APPROVAL_POLICY = {
  mode: "prompt" as ApprovalMode,
  autoApproveReadOnly: false,
  autoApproveSkills: true,
  alwaysAllowedTools: [] as string[],
};

/** 基于默认常量创建一份独立的审批策略草稿。 */
function createDefaultApprovalPolicy() {
  return { ...DEFAULT_APPROVAL_POLICY };
}

/** 根据完整 profile 推断供应商标签 */
function getProviderLabel(profile: any): string {
  if (profile.providerFlavor === "br-minimax") return "BR MiniMax";
  const url = profile.baseUrl ?? "";
  if (url.includes("anthropic")) return "Anthropic";
  if (url.includes("openai")) return "OpenAI";
  if (url.includes("azure")) return "Azure";
  if (url.includes("deepseek")) return "DeepSeek";
  if (url.includes("mistral")) return "Mistral";
  return profile.provider ?? "Other";
}

const TABS = ["模型", "通用", "审批"] as const;
type TabName = typeof TABS[number];

/** 渲染个人设置页，管理模型、通用选项与审批策略。 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();
  const defaultApprovalPolicy = createDefaultApprovalPolicy();

  const [activeTab, setActiveTab] = useState<TabName>("模型");
  const [modelConnectivityStatus, setModelConnectivityStatus] = useState<Record<string, string>>({});
  const [modelConnectivityLoading, setModelConnectivityLoading] = useState<Record<string, boolean>>({});

  const [approvalDraft, setApprovalDraft] = useState({
    mode: (workspace.approvals?.mode ?? defaultApprovalPolicy.mode) as ApprovalMode,
    autoApproveReadOnly: workspace.approvals?.autoApproveReadOnly ?? defaultApprovalPolicy.autoApproveReadOnly,
    autoApproveSkills: workspace.approvals?.autoApproveSkills ?? defaultApprovalPolicy.autoApproveSkills,
  });

  // 工作区审批配置变化后，同步刷新本地编辑草稿。
  useEffect(() => {
    const approvals = workspace.approvals;
    setApprovalDraft({
      mode: approvals?.mode ?? defaultApprovalPolicy.mode,
      autoApproveReadOnly: approvals?.autoApproveReadOnly ?? defaultApprovalPolicy.autoApproveReadOnly,
      autoApproveSkills: approvals?.autoApproveSkills ?? defaultApprovalPolicy.autoApproveSkills,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.approvals]);

  const alwaysAllowedToolsLabel = useMemo(() => {
    const tools = workspace.approvals?.alwaysAllowedTools ?? defaultApprovalPolicy.alwaysAllowedTools;
    return tools.length ? tools.join("、") : "暂无";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.approvals]);

  const myClawRootPath = workspace.myClawRootPath ?? "未设置";
  const skillsRootPath = workspace.skillsRootPath ?? "未设置";
  const sessionsRootPath = workspace.sessionsRootPath ?? "未设置";

  /** 测试指定模型配置的连通性并回写状态文案。 */
  async function testModelProfile(profileId: string) {
    setModelConnectivityLoading((prev) => ({ ...prev, [profileId]: true }));
    setModelConnectivityStatus((prev) => ({ ...prev, [profileId]: "测试中..." }));
    try {
      const payload = await workspace.testModelProfileConnectivity(profileId);
      const result = payload as {
        success: boolean;
        ok?: boolean;
        latencyMs?: number;
        error?: string;
        diagnostics?: { thinkingPath?: string };
      };
      const latency = typeof result.latencyMs === "number" ? `${Math.round(result.latencyMs)}ms` : "--";
      const diagnosticsLabel = result.diagnostics?.thinkingPath
        && result.diagnostics.thinkingPath !== "unverified"
        ? ` · ${result.diagnostics.thinkingPath}`
        : "";
      setModelConnectivityStatus((prev) => ({
        ...prev,
        [profileId]: (result.ok ?? result.success)
          ? `可用 (${latency})${diagnosticsLabel}`
          : "失败",
      }));
    } catch (error) {
      setModelConnectivityStatus((prev) => ({ ...prev, [profileId]: `失败: ${error instanceof Error ? error.message : "未知错误"}` }));
    } finally {
      setModelConnectivityLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  }

  /** 保存当前审批策略草稿。 */
  async function saveApprovalPolicy() {
    await workspace.updateApprovalPolicy({
      mode: approvalDraft.mode,
      autoApproveReadOnly: approvalDraft.autoApproveReadOnly,
      autoApproveSkills: approvalDraft.autoApproveSkills,
    });
  }

  return (
    <main className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Settings</span>
          <h2 className="page-title">个人设置</h2>
          <p className="page-subtitle">管理您的模型、运行时、审批策略以及应用偏好。</p>
        </div>
        <div className="header-actions">
          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                data-testid={`settings-tab-${tab}`}
                className={`tab${activeTab === tab ? " active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 模型页签 */}
      {activeTab === "模型" && (
        <article className="card no-padding">
          <div className="section-header-row">
            <div className="header-content">
              <p className="eyebrow">模型列表</p>
              <h3>已配置模型</h3>
              <p className="description">管理您的 AI 模型提供商配置。默认模型将用于智能助手回复和工具分析。</p>
            </div>
            <button className="primary add-btn" onClick={() => navigate("/settings/models/new")}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              添加模型配置
            </button>
          </div>

          <div className="model-cards-container">
            {(workspace.models ?? []).map((profile: any) => (
              <div key={profile.id} className={`model-card${workspace.defaultModelProfileId === profile.id ? " is-active" : ""}`}>
                <div className="card-status-bar">
                  {workspace.defaultModelProfileId === profile.id ? (
                    <span className="status-badge active"><span className="dot"></span>当前默认模型</span>
                  ) : (
                    <span className="status-badge inactive">未启用</span>
                  )}
                  <div className="card-actions-mini">
                    <button
                      className="icon-btn"
                      onClick={() => void testModelProfile(profile.id)}
                      disabled={modelConnectivityLoading[profile.id]}
                      title="测试连通性"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                    </button>
                    <button className="icon-btn" onClick={() => navigate(`/settings/models/${profile.id}`)} title="编辑">
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  <div className="model-info">
                    <div className="model-name-row">
                      <span className="provider-tag">{getProviderLabel(profile)}</span>
                      <strong>{profile.name}</strong>
                    </div>
                    <p className="model-id"><span>ID:</span> {profile.model}</p>
                    <p className="model-url"><span>URL:</span> {profile.baseUrl}</p>
                    {profile.providerFlavor === "br-minimax" && (
                      <p className="model-url">
                        <span>Thinking:</span> {readBrMiniMaxRuntimeDiagnostics(profile).thinkingPath}
                      </p>
                    )}
                  </div>
                  {modelConnectivityStatus[profile.id] && (
                    <div className="connectivity-info">
                      <span className={`status-text${modelConnectivityStatus[profile.id].includes("可用") ? " ok" : ""}`}>
                        {modelConnectivityStatus[profile.id]}
                      </span>
                    </div>
                  )}
                </div>
                <div className="card-footer-actions">
                  {workspace.defaultModelProfileId !== profile.id ? (
                    <button className="primary-ghost" onClick={() => workspace.setDefaultModelProfile(profile.id)}>设为默认</button>
                  ) : (
                    <button className="primary-ghost disabled" disabled>已设为默认</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <section className="storage-section card">
            <p className="eyebrow">存储资源</p>
            <h4>MyClaw 数据目录</h4>
            <div className="storage-path-list">
              <div className="storage-path-item">
                <span className="storage-path-label">根目录</span>
                <p data-testid="myclaw-root-path" className="path-text">{myClawRootPath}</p>
              </div>
              <div className="storage-path-item">
                <span className="storage-path-label">Skills</span>
                <p data-testid="skills-root-path" className="path-text">{skillsRootPath}</p>
              </div>
              <div className="storage-path-item">
                <span className="storage-path-label">Sessions</span>
                <p data-testid="sessions-root-path" className="path-text">{sessionsRootPath}</p>
              </div>
            </div>
            {workspace.requiresInitialSetup && (
              <p data-testid="initial-setup-hint" className="setup-hint">首次使用请先添加有效模型 Token 并设为默认。</p>
            )}
          </section>
        </article>
      )}

      {/* 通用页签 */}
      {activeTab === "通用" && (
        <article className="card">
          <p className="eyebrow">通用</p>
          <h3>应用默认项</h3>
          <p>运行时地址、启动行为和工作区级展示设置会在这里统一管理。</p>
        </article>
      )}

      {/* 审批页签 */}
      {activeTab === "审批" && (
        <article className="card">
          <p className="eyebrow">审批</p>
          <h3>执行策略</h3>
          <div className="approval-controls">
            <label className="field">
              <span>全局审批模式</span>
              <select
                data-testid="approval-mode-select"
                value={approvalDraft.mode}
                onChange={(e) => setApprovalDraft((prev) => ({ ...prev, mode: e.target.value as ApprovalMode }))}
              >
                <option value="prompt">全部询问</option>
                <option value="auto-read-only">仅高风险询问</option>
                <option value="auto-allow-all">工作目录自动允许</option>
                <option value="unrestricted">⚠ 危险模式 — 完全无限制</option>
              </select>
            </label>

            <label className="switch-row">
              <input
                data-testid="approval-readonly-toggle"
                type="checkbox"
                checked={approvalDraft.autoApproveReadOnly}
                onChange={(e) => setApprovalDraft((prev) => ({ ...prev, autoApproveReadOnly: e.target.checked }))}
              />
              <span>只读操作默认自动允许</span>
            </label>

            <label className="switch-row">
              <input
                data-testid="approval-skills-toggle"
                type="checkbox"
                checked={approvalDraft.autoApproveSkills}
                onChange={(e) => setApprovalDraft((prev) => ({ ...prev, autoApproveSkills: e.target.checked }))}
              />
              <span>Skills 调用默认直接放行</span>
            </label>

            <button data-testid="approval-save" className="primary" onClick={() => void saveApprovalPolicy()}>保存审批策略</button>
          </div>

          <div className="approval-mode-hint">
            {approvalDraft.mode === "prompt" && <p>所有工具调用均需手动审批确认。</p>}
            {approvalDraft.mode === "auto-read-only" && <p>只读操作自动放行，写入/执行/网络等高风险操作需审批。</p>}
            {approvalDraft.mode === "auto-allow-all" && <p>工作目录内的操作全部自动放行。访问外部路径（如桌面、其他盘符）时仍需审批确认。</p>}
            {approvalDraft.mode === "unrestricted" && <p className="danger-hint">⚠ 危险模式：所有操作全部自动放行，包括访问任意外部路径、执行命令、网络请求等。请确保你信任当前会话的所有操作。</p>}
          </div>

          <div className="approval-summary">
            <p>{approvalDraft.autoApproveSkills ? "Skills 调用默认直接放行。" : "Skills 调用需要审批。"}</p>
            <p>{approvalDraft.autoApproveReadOnly ? "只读操作默认自动允许。" : "只读操作当前也需要审批。"}</p>
            <p>已设为始终允许的工具：{alwaysAllowedToolsLabel}</p>
          </div>
        </article>
      )}

      <style>{`
        .page-container { flex: 1; overflow-y: auto; padding: 24px 32px; }
        .card { padding: 32px; border-radius: var(--radius-xl); background: var(--bg-card); border: 1px solid var(--glass-border); backdrop-filter: var(--blur-std); -webkit-backdrop-filter: var(--blur-std); box-shadow: var(--shadow-card), var(--glass-inner-glow); }
        .no-padding { padding: 0; background: transparent; border: 0; }
        h3, h4 { font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
        h3 { font-size: 16px; }
        h4 { font-size: 14px; margin-bottom: 12px; }
        .card p { color: var(--text-secondary); font-size: 14px; line-height: 1.5; margin: 0; }
        .tabs { display: flex; gap: 4px; background: var(--bg-base); padding: 4px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); }
        .tab { padding: 6px 16px; border: 0; border-radius: 6px; color: var(--text-secondary); cursor: pointer; background: transparent; font-size: 13px; font-weight: 500; transition: all 0.2s; }
        .tab:hover { color: var(--text-primary); }
        .tab.active { background: var(--bg-card); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
        .primary, .secondary { padding: 10px 16px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; }
        .primary { background: var(--text-primary); color: var(--bg-base); border-color: var(--text-primary); }
        .primary:hover:not(:disabled) { opacity: 0.9; }
        .secondary { background: var(--bg-base); color: var(--text-primary); border-color: var(--glass-border); }
        .secondary:hover:not(:disabled) { background: var(--bg-card); border-color: var(--text-muted); }
        .primary:disabled, .secondary:disabled { opacity: 0.5; cursor: not-allowed; }
        .section-header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding: 32px 32px 0; }
        .header-content h3 { font-size: 24px; margin: 0 0 8px; }
        .description { color: var(--text-muted); max-width: 600px; }
        .add-btn { display: flex; align-items: center; gap: 8px; padding: 12px 20px; }
        .model-cards-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 32px; padding: 0 32px; }
        .model-card { background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: var(--radius-xl); display: flex; flex-direction: column; transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease; backdrop-filter: var(--blur-std); -webkit-backdrop-filter: var(--blur-std); }
        .model-card:hover { border-color: var(--glass-border-hover); transform: translateY(-2px); box-shadow: var(--shadow-card-hover), var(--glass-inner-glow); }
        .model-card.is-active { border-color: var(--status-green); background: linear-gradient(135deg, var(--bg-card), rgba(46,160,67,0.03)); }
        .card-status-bar { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--glass-border); }
        .status-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        .status-badge.active { color: var(--status-green); }
        .status-badge.inactive { color: var(--text-muted); }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--status-green); box-shadow: 0 0 8px var(--status-green); }
        .card-actions-mini { display: flex; gap: 4px; }
        .icon-btn { width: 32px; height: 32px; border-radius: 6px; border: 0; background: transparent; color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
        .icon-btn:hover { background: var(--bg-base); color: var(--text-primary); }
        .card-body { padding: 24px 20px; flex: 1; }
        .model-info { display: flex; flex-direction: column; gap: 12px; }
        .model-name-row { display: flex; align-items: center; gap: 10px; }
        .provider-tag { font-size: 10px; font-weight: 700; padding: 2px 8px; background: var(--bg-base); border: 1px solid var(--glass-border); border-radius: 4px; color: var(--text-muted); text-transform: uppercase; }
        .model-info strong { font-size: 16px; color: var(--text-primary); }
        .model-info p { font-size: 13px; margin: 0; display: flex; gap: 8px; }
        .model-info p span { color: var(--text-muted); width: 32px; font-weight: 500; }
        .connectivity-info { margin-top: 16px; font-size: 12px; }
        .status-text.ok { color: var(--status-green); }
        .card-footer-actions { padding: 16px 20px; background: rgba(0,0,0,0.1); border-top: 1px solid var(--glass-border); }
        .primary-ghost { background: transparent; border: 1px solid var(--glass-border); color: var(--text-primary); width: 100%; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .primary-ghost:hover:not(.disabled) { background: var(--status-green); color: white; border-color: var(--status-green); }
        .model-card.is-active .primary-ghost.disabled { color: var(--status-green); font-weight: 700; border-color: transparent; cursor: default; }
        .storage-section { margin: 0 32px 32px; }
        .storage-path-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
        .storage-path-item { display: flex; flex-direction: column; gap: 4px; }
        .storage-path-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
        .path-text { font-family: monospace; font-size: 12px; background: var(--bg-base); padding: 8px; border-radius: 4px; border: 1px solid var(--glass-border); margin: 0; color: var(--text-primary) !important; }
        .setup-hint { margin-top: 16px !important; color: var(--status-yellow) !important; font-size: 13px !important; }
        .approval-controls { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
        .approval-controls .field { display: flex; flex-direction: column; gap: 8px; }
        .approval-controls .field span { font-size: 13px; color: var(--text-secondary); }
        .approval-controls select { height: 40px; padding: 0 12px; background: var(--bg-base); border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-primary); font-family: inherit; font-size: 14px; transition: border-color 0.2s, box-shadow 0.2s; }
        .approval-controls select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.14); }
        .switch-row { display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text-secondary); font-size: 14px; }
        .switch-row input[type="checkbox"] { accent-color: var(--accent-cyan); cursor: pointer; }
        .switch-row input[type="checkbox"]:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
        .approval-mode-hint { margin-top: 16px; padding: 12px 16px; background: var(--bg-base); border-radius: var(--radius-md); border: 1px solid var(--glass-border); }
        .approval-mode-hint p { margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
        .approval-mode-hint .danger-hint { color: var(--status-red); font-weight: 500; }
        .approval-summary { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; padding: 16px; background: var(--bg-base); border-radius: var(--radius-md); border: 1px solid var(--glass-border); }
        .approval-summary p { font-size: 13px !important; color: var(--text-secondary) !important; }
      `}</style>
    </main>
  );
}
