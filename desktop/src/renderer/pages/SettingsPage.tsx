import React, { useState, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AsrConfig, ProtocolTarget } from "@shared/contracts";
import { DEFAULT_ASR_CONFIG } from "@shared/contracts";
import { readBrMiniMaxRuntimeDiagnostics } from "@shared/br-minimax";
import { resolveModelCapability } from "../../main/services/model-capability-resolver";
import { formatCapabilitySource } from "../utils/context-ui-helpers";
import { getModelVendorLabel } from "../utils/model-profile-display";

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
  return getModelVendorLabel(profile);
}

function formatProtocolTargetLabel(target?: ProtocolTarget | null): string | null {
  if (!target) return null;
  if (target === "openai-responses") return "OpenAI Responses";
  if (target === "anthropic-messages") return "Anthropic Messages";
  return "OpenAI Compatible";
}

function formatProtocolSelectionSourceLabel(source?: "saved" | "probe" | "registry-default" | "fallback" | null): string | null {
  if (!source) return null;
  if (source === "saved") return "保存选择";
  if (source === "probe") return "探测推荐";
  if (source === "registry-default") return "注册表默认";
  return "回退选择";
}

const TABS = ["模型", "通用", "审批", "语音识别"] as const;
type TabName = typeof TABS[number];

/** 渲染个人设置页，管理模型、通用选项与审批策略。 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useWorkspaceStore();
  const defaultApprovalPolicy = createDefaultApprovalPolicy();
  const locationState = location.state as { activeTab?: TabName; modelConfigNotice?: string } | null;

  const [activeTab, setActiveTab] = useState<TabName>(locationState?.activeTab ?? "模型");
  const [modelConnectivityStatus, setModelConnectivityStatus] = useState<Record<string, string>>({});
  const [modelConnectivityLoading, setModelConnectivityLoading] = useState<Record<string, boolean>>({});

  const [approvalDraft, setApprovalDraft] = useState({
    mode: (workspace.approvals?.mode ?? defaultApprovalPolicy.mode) as ApprovalMode,
    autoApproveReadOnly: workspace.approvals?.autoApproveReadOnly ?? defaultApprovalPolicy.autoApproveReadOnly,
    autoApproveSkills: workspace.approvals?.autoApproveSkills ?? defaultApprovalPolicy.autoApproveSkills,
  });

  // ---- ASR 配置 ----------------------------------------------------------
  const [asrDraft, setAsrDraft] = useState<AsrConfig>({ ...DEFAULT_ASR_CONFIG });
  const [asrSaving, setAsrSaving] = useState(false);
  const [asrSaveStatus, setAsrSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { config } = await window.myClawAPI.getAsrConfig();
        if (config) setAsrDraft(config);
      } catch (err) {
        console.error("[settings] 读取 ASR 配置失败", err);
      }
    })();
  }, []);

  async function saveAsrConfig() {
    setAsrSaving(true);
    setAsrSaveStatus(null);
    try {
      const { config } = await window.myClawAPI.saveAsrConfig(asrDraft);
      setAsrDraft(config);
      setAsrSaveStatus("已保存");
    } catch (err) {
      setAsrSaveStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAsrSaving(false);
    }
  }

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
  const modelConfigNotice = locationState?.modelConfigNotice ?? null;
  const appUpdate = workspace.appUpdate ?? {
    enabled: false,
    stage: "disabled",
    currentVersion: "0.1.0",
    latestVersion: null,
    progressPercent: null,
    message: "未配置公开发布仓库，暂不启用自动更新。",
    feedLabel: null,
    downloadPageUrl: null,
  };
  const appUpdateSourceLabel = appUpdate.feedLabel ?? "未配置公开发布仓库";

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

  /** 根据当前更新状态渲染主操作按钮，保持设置页交互明确且最小。 */
  function renderAppUpdatePrimaryAction() {
    if (appUpdate.stage === "available") {
      return (
        <button data-testid="app-update-download" className="primary" onClick={() => void workspace.downloadAppUpdate()}>
          下载更新
        </button>
      );
    }

    if (appUpdate.stage === "downloading") {
      return (
        <button data-testid="app-update-downloading" className="secondary" disabled>
          正在下载 {appUpdate.progressPercent ?? 0}%
        </button>
      );
    }

    if (appUpdate.stage === "downloaded") {
      return (
        <button data-testid="app-update-install" className="primary" onClick={() => void workspace.quitAndInstallAppUpdate()}>
          重启并安装
        </button>
      );
    }

    return (
      <button
        data-testid="app-update-check"
        className="secondary"
        disabled={!appUpdate.enabled}
        onClick={() => void workspace.checkForAppUpdates()}
      >
        检查更新
      </button>
    );
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
          {modelConfigNotice && (
            <div className="settings-notice-banner">
              {modelConfigNotice}
            </div>
          )}
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

          <div data-testid="model-cards-container" className="model-cards-container single-column">
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
                    <div className="model-name-block">
                      <div data-testid="model-name-title" className="model-name-title-row">
                        <strong>{profile.name}</strong>
                      </div>
                      <div data-testid="model-name-tags" className="model-name-tags-row">
                        <span className="provider-tag">{getProviderLabel(profile)}</span>
                        {formatProtocolTargetLabel(profile.protocolTarget) && (
                          <span className="route-tag">{formatProtocolTargetLabel(profile.protocolTarget)}</span>
                        )}
                        {formatProtocolSelectionSourceLabel(profile.protocolSelectionSource) && (
                          <span className="route-source-tag">{formatProtocolSelectionSourceLabel(profile.protocolSelectionSource)}</span>
                        )}
                        <span className="route-source-tag capability-source-tag">
                          {formatCapabilitySource(resolveModelCapability(profile).effective.source)}
                        </span>
                      </div>
                    </div>
                    <div className="model-metrics-grid">
                      <p className="model-metric"><span>Model ID</span> <strong className="metric-value">{profile.model || "--"}</strong></p>
                      <p className="model-metric"><span>Base URL</span> <strong className="metric-value">{profile.baseUrl || "--"}</strong></p>
                      {profile.providerFlavor === "br-minimax" && (
                        <p className="model-metric">
                          <span>Thinking</span> <strong className="metric-value">{readBrMiniMaxRuntimeDiagnostics(profile).thinkingPath || "--"}</strong>
                        </p>
                      )}
                    </div>
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

          <section data-testid="app-update-section" className="storage-section card update-section">
            <p className="eyebrow">应用更新</p>
            <h4>桌面端版本</h4>
            <div className="update-meta-list">
              <div className="storage-path-item">
                <span className="storage-path-label">当前版本</span>
                <p className="path-text">{appUpdate.currentVersion}</p>
              </div>
              <div className="storage-path-item">
                <span className="storage-path-label">更新源</span>
                <p className="path-text">{appUpdateSourceLabel}</p>
              </div>
              {appUpdate.latestVersion && (
                <div className="storage-path-item">
                  <span className="storage-path-label">最新版本</span>
                  <p className="path-text">{appUpdate.latestVersion}</p>
                </div>
              )}
            </div>
            <p data-testid="app-update-status" className="update-status-text">{appUpdate.message}</p>
            <div className="update-actions">
              {renderAppUpdatePrimaryAction()}
              {appUpdate.downloadPageUrl && (
                <button
                  data-testid="app-update-open-download-page"
                  className="secondary"
                  onClick={() => void workspace.openAppUpdateDownloadPage()}
                >
                  手动下载安装包
                </button>
              )}
            </div>
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

      {/* 语音识别页签 */}
      {activeTab === "语音识别" && (
        <article className="card">
          <p className="eyebrow">ASR</p>
          <h3>会议语音识别服务</h3>
          <p>配置实时流式 ASR 与离线识别服务地址，以及会议纪要生成使用的模型。</p>

          <div className="approval-controls" style={{ marginTop: 20 }}>
            <label className="field">
              <span>实时流式 ASR WebSocket 地址</span>
              <input
                type="text"
                value={asrDraft.wsUrl}
                onChange={(e) => setAsrDraft((p) => ({ ...p, wsUrl: e.target.value }))}
                placeholder="ws://host:port"
                style={{
                  height: 40,
                  padding: "0 12px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 14,
                }}
              />
            </label>

            <label className="field">
              <span>识别模式</span>
              <div style={{ display: "flex", gap: 16 }}>
                <label className="switch-row" style={{ cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="asr-mode"
                    value="online"
                    checked={asrDraft.mode === "online"}
                    onChange={() => setAsrDraft((p) => ({ ...p, mode: "online" }))}
                  />
                  <span>online（低延迟）</span>
                </label>
                <label className="switch-row" style={{ cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="asr-mode"
                    value="2pass"
                    checked={asrDraft.mode === "2pass"}
                    onChange={() => setAsrDraft((p) => ({ ...p, mode: "2pass" }))}
                  />
                  <span>2pass（更准确）</span>
                </label>
              </div>
            </label>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={asrDraft.ssl}
                onChange={(e) => setAsrDraft((p) => ({ ...p, ssl: e.target.checked }))}
              />
              <span>启用 SSL / WSS</span>
            </label>

            <label className="field">
              <span>离线 ASR HTTP 地址</span>
              <input
                type="text"
                value={asrDraft.httpUrl}
                onChange={(e) => setAsrDraft((p) => ({ ...p, httpUrl: e.target.value }))}
                placeholder="https://host/recognition"
                style={{
                  height: 40,
                  padding: "0 12px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 14,
                }}
              />
            </label>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={asrDraft.enableSpeaker}
                onChange={(e) => setAsrDraft((p) => ({ ...p, enableSpeaker: e.target.checked }))}
              />
              <span>启用说话人识别</span>
            </label>

            <label className="field">
              <span>最大说话人数</span>
              <input
                type="number"
                min={1}
                max={20}
                value={asrDraft.maxSpeakers}
                onChange={(e) => setAsrDraft((p) => ({ ...p, maxSpeakers: Number(e.target.value) || 1 }))}
                style={{
                  height: 40,
                  padding: "0 12px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 14,
                  width: 120,
                }}
              />
            </label>

            <label className="field">
              <span>会议纪要生成模型</span>
              <select
                value={asrDraft.summaryModelProfileId ?? ""}
                onChange={(e) =>
                  setAsrDraft((p) => ({
                    ...p,
                    summaryModelProfileId: e.target.value ? e.target.value : null,
                  }))
                }
              >
                <option value="">默认模型（跟随 Chat 默认）</option>
                {(workspace.models ?? []).map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.model}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                type="button"
                className="primary"
                onClick={() => void saveAsrConfig()}
                disabled={asrSaving}
              >
                {asrSaving ? "保存中..." : "保存配置"}
              </button>
              {asrSaveStatus && (
                <span
                  style={{
                    fontSize: 13,
                    color: asrSaveStatus.startsWith("保存失败")
                      ? "var(--status-red)"
                      : "var(--status-green)",
                  }}
                >
                  {asrSaveStatus}
                </span>
              )}
            </div>
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
        .settings-notice-banner { margin: 24px 32px 0; padding: 12px 14px; border-radius: 10px; border: 1px solid #10a37f44; background: #10a37f14; color: #86efac; font-size: 13px; }
        .header-content h3 { font-size: 24px; margin: 0 0 8px; }
        .description { color: var(--text-muted); max-width: 600px; }
        .add-btn { display: flex; align-items: center; gap: 8px; padding: 12px 20px; }
        .model-cards-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; margin: 0 auto 32px; padding: 0 32px; max-width: 1040px; }
        .model-card { background: linear-gradient(145deg, var(--bg-card), rgba(0,0,0,0.3)); border: 1px solid var(--glass-border); border-radius: var(--radius-xl); display: flex; flex-direction: column; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); backdrop-filter: var(--blur-std); -webkit-backdrop-filter: var(--blur-std); overflow: hidden; position: relative; }
        .model-card:hover { border-color: var(--glass-border-hover); transform: translateY(-4px); box-shadow: 0 12px 24px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1); background: linear-gradient(145deg, var(--bg-card), rgba(0,0,0,0.1)); }
        .model-card.is-active { border-color: var(--status-green); background: linear-gradient(145deg, rgba(46,160,67,0.06), rgba(46,160,67,0.01)); box-shadow: 0 0 0 1px rgba(46,160,67,0.3), inset 0 1px 0 rgba(255,255,255,0.05); }
        .model-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent); opacity: 0; transition: opacity 0.3s; }
        .model-card:hover::before { opacity: 1; }
        .card-status-bar { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.04); flex-wrap: wrap; background: rgba(0,0,0,0.15); }
        .status-badge { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
        .status-badge.active { color: #3fb950; text-shadow: 0 0 10px rgba(63,185,80,0.3); }
        .status-badge.inactive { color: var(--text-muted); }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
        .card-actions-mini { display: flex; gap: 6px; }
        .icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
        .icon-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); border-color: rgba(255,255,255,0.1); }
        .card-body { padding: 24px 20px; flex: 1; display: flex; flex-direction: column; }
        .model-info { display: flex; flex-direction: column; gap: 16px; }
        .model-name-block { display: flex; flex-direction: column; gap: 12px; margin-bottom: 4px; }
        .model-name-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .model-name-tags-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .provider-tag, .route-tag, .route-source-tag, .capability-source-tag { font-size: 10px; font-weight: 700; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1; border: 1px solid transparent; display: inline-block; }
        .provider-tag { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); color: var(--text-secondary); }
        .route-tag { background: rgba(16,163,127,0.1); border-color: rgba(16,163,127,0.2); color: #34d399; }
        .route-source-tag { background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.2); color: #fbbf24; }
        .capability-source-tag { background: rgba(59,130,246,0.1); border-color: rgba(96,165,250,0.2); color: #93c5fd; }
        .model-info strong { font-size: 18px; line-height: 1.3; color: #e6edf3; font-weight: 600; letter-spacing: -0.01em; }
        .model-metrics-grid { display: flex; flex-direction: column; gap: 8px; }
        .model-info p.model-metric { font-size: 12px; margin: 0; display: flex; flex-direction: column; gap: 4px; color: #8b949e; background: rgba(0,0,0,0.2); padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); }
        .model-info p.model-metric span { color: #7d8590; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; width: auto; }
        .model-info p.model-metric strong.metric-value { font-size: 13px; font-weight: 500; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #c9d1d9; word-break: break-all; }
        .connectivity-info { margin-top: 16px; padding-top: 16px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 12px; display: flex; align-items: center; gap: 8px; }
        .status-text { display: flex; align-items: center; gap: 6px; font-weight: 500; color: var(--text-secondary); }
        .status-text::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
        .status-text.ok { color: #3fb950; }
        .status-text.ok::before { background: #3fb950; box-shadow: 0 0 8px rgba(63,185,80,0.4); }
        .card-footer-actions { padding: 16px 20px; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.04); margin-top: auto; }
        .primary-ghost { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #c9d1d9; width: 100%; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; }
        .primary-ghost:hover:not(.disabled) { background: rgba(63,185,80,0.1); color: #3fb950; border-color: rgba(63,185,80,0.3); box-shadow: 0 0 12px rgba(63,185,80,0.15); }
        .model-card.is-active .primary-ghost.disabled { background: transparent; color: #3fb950; font-weight: 600; border-color: transparent; cursor: default; }
        .storage-section { margin: 0 32px 32px; }
        .storage-path-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
        .storage-path-item { display: flex; flex-direction: column; gap: 4px; }
        .storage-path-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
        .path-text { font-family: monospace; font-size: 12px; background: var(--bg-base); padding: 8px; border-radius: 4px; border: 1px solid var(--glass-border); margin: 0; color: var(--text-primary) !important; }
        .setup-hint { margin-top: 16px !important; color: var(--status-yellow) !important; font-size: 13px !important; }
        .update-section { display: flex; flex-direction: column; gap: 16px; }
        .update-meta-list { display: flex; flex-direction: column; gap: 12px; }
        .update-status-text { color: var(--text-primary) !important; }
        .update-actions { display: flex; flex-wrap: wrap; gap: 12px; }
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
        @media (max-width: 900px) {
          .section-header-row { flex-direction: column; gap: 16px; }
          .model-cards-container { padding: 0 20px; }
        }
        @media (max-width: 640px) {
          .page-container { padding: 20px; }
          .section-header-row { padding: 24px 20px 0; }
          .model-cards-container { padding: 0 20px; gap: 14px; }
          .card-status-bar, .card-body, .card-footer-actions { padding-left: 16px; padding-right: 16px; }
          .model-info p { flex-direction: column; gap: 4px; }
          .model-info p span { width: auto; }
        }
      `}</style>
    </main>
  );
}
