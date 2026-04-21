import React, { useState, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AsrConfig, ProtocolTarget } from "@shared/contracts";
import { DEFAULT_ASR_CONFIG } from "@shared/contracts";
import { readBrMiniMaxRuntimeDiagnostics } from "@shared/br-minimax";
import { resolveModelCapability } from "../../main/services/model-capability-resolver";
import { formatCapabilitySource } from "../utils/context-ui-helpers";
import { getModelVendorLabel } from "../utils/model-profile-display";
import { Box, Sliders, ShieldCheck, Mic, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";

type ApprovalMode = "prompt" | "auto-read-only" | "auto-allow-all" | "unrestricted";

const DEFAULT_APPROVAL_POLICY = {
  mode: "prompt" as ApprovalMode,
  autoApproveReadOnly: false,
  autoApproveSkills: true,
  alwaysAllowedTools: [] as string[],
};

function createDefaultApprovalPolicy() {
  return { ...DEFAULT_APPROVAL_POLICY };
}

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

const TABS = [
  { id: "模型", label: "模型与提供商", icon: Box },
  { id: "通用", label: "通用偏好", icon: Sliders },
  { id: "审批", label: "执行与审批策略", icon: ShieldCheck },
  { id: "语音识别", label: "ASR 语音识别", icon: Mic },
] as const;

type TabName = typeof TABS[number]["id"];

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

  async function saveApprovalPolicy() {
    await workspace.updateApprovalPolicy({
      mode: approvalDraft.mode,
      autoApproveReadOnly: approvalDraft.autoApproveReadOnly,
      autoApproveSkills: approvalDraft.autoApproveSkills,
    });
  }

  function renderAppUpdatePrimaryAction() {
    if (appUpdate.stage === "available") {
      return (
        <button data-testid="app-update-download" className="btn-primary" onClick={() => void workspace.downloadAppUpdate()}>
          下载更新
        </button>
      );
    }
    if (appUpdate.stage === "downloading") {
      return (
        <button data-testid="app-update-downloading" className="btn-secondary" disabled>
          正在下载 {appUpdate.progressPercent ?? 0}%
        </button>
      );
    }
    if (appUpdate.stage === "downloaded") {
      return (
        <button data-testid="app-update-install" className="btn-primary" onClick={() => void workspace.quitAndInstallAppUpdate()}>
          重启并安装
        </button>
      );
    }
    return (
      <button
        data-testid="app-update-check"
        className="btn-secondary"
        disabled={!appUpdate.enabled}
        onClick={() => void workspace.checkForAppUpdates()}
      >
        检查更新
      </button>
    );
  }

  const activeTabDetails = TABS.find((t) => t.id === activeTab);

  return (
    <div className="settings-split-pane">
      {/* 桌面原生化：Master 侧边栏 */}
      <aside className="settings-sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">个人设置</h2>
        </div>
        <nav className="sidebar-nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                data-testid={`settings-tab-${tab.id}`}
                className={`sidebar-item ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} strokeWidth={2.5} className="sidebar-item-icon" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 桌面原生化：Detail 详情区 */}
      <main className="settings-detail-pane">
        <header className="settings-detail-header">
          <div className="header-breadcrumbs">
            <span className="eyebrow">Settings</span>
            <ChevronRight size={14} className="breadcrumb-separator" />
            <span className="eyebrow active">{activeTabDetails?.label}</span>
          </div>
          <h3 className="pane-title">{activeTabDetails?.label}</h3>
        </header>

        <div className="settings-detail-content">
          {/* ---- 模型页签 ---- */}
          {activeTab === "模型" && (
            <div className="settings-section">
              {modelConfigNotice && (
                <div className="settings-notice-banner">
                  <AlertCircle size={16} />
                  <span>{modelConfigNotice}</span>
                </div>
              )}
              
              <div className="section-header-row">
                <p className="description">管理您的 AI 模型提供商配置。默认模型将用于智能助手回复和工具分析。</p>
                <button className="btn-primary add-btn" onClick={() => navigate("/settings/models/new")}>
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                  </svg>
                  添加模型
                </button>
              </div>

              {/* 高密度列表视图改良：去掉巨型网格，采用行或更紧凑的卡片 */}
              <div data-testid="model-cards-container" className="model-rows-container">
                {(workspace.models ?? []).map((profile: any) => (
                  <div key={profile.id} className={`model-row-card ${workspace.defaultModelProfileId === profile.id ? "is-active" : ""}`}>
                    <div className="row-card-left">
                      <div className="model-row-header">
                        <strong className="model-name">{profile.name}</strong>
                        {workspace.defaultModelProfileId === profile.id && (
                          <span className="badge badge-active">当前默认</span>
                        )}
                        <span className="badge badge-provider">{getProviderLabel(profile)}</span>
                        {formatProtocolTargetLabel(profile.protocolTarget) && (
                          <span className="badge badge-route">{formatProtocolTargetLabel(profile.protocolTarget)}</span>
                        )}
                      </div>
                      <div className="model-row-meta">
                        <span className="meta-item">ID: <code>{profile.model || "--"}</code></span>
                        <span className="meta-item">URL: {profile.baseUrl || "--"}</span>
                      </div>
                      {modelConnectivityStatus[profile.id] && (
                        <div className={`model-row-status ${modelConnectivityStatus[profile.id].includes("可用") ? "ok" : "fail"}`}>
                          {modelConnectivityStatus[profile.id].includes("可用") ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                          <span>{modelConnectivityStatus[profile.id]}</span>
                        </div>
                      )}
                    </div>

                    <div className="row-card-right">
                      <div className="row-actions">
                        {workspace.defaultModelProfileId !== profile.id && (
                          <button className="btn-ghost-small" onClick={() => workspace.setDefaultModelProfile(profile.id)}>
                            设为默认
                          </button>
                        )}
                        <button
                          className="btn-icon"
                          onClick={() => void testModelProfile(profile.id)}
                          disabled={modelConnectivityLoading[profile.id]}
                          title="测试连通性"
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
                          </svg>
                        </button>
                        <button className="btn-icon" onClick={() => navigate(`/settings/models/${profile.id}`)} title="编辑">
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="settings-group-panel">
                <h4>应用更新 (桌面端版本)</h4>
                <div className="panel-grid meta-grid">
                  <div className="meta-field">
                    <span>当前版本</span>
                    <code>{appUpdate.currentVersion}</code>
                  </div>
                  <div className="meta-field">
                    <span>更新源</span>
                    <code>{appUpdateSourceLabel}</code>
                  </div>
                  {appUpdate.latestVersion && (
                    <div className="meta-field">
                      <span>最新版本</span>
                      <code>{appUpdate.latestVersion}</code>
                    </div>
                  )}
                </div>
                <p className="update-status-text">{appUpdate.message}</p>
                <div className="update-actions">
                  {renderAppUpdatePrimaryAction()}
                  {appUpdate.downloadPageUrl && (
                    <button data-testid="app-update-open-download-page" className="btn-secondary" onClick={() => void workspace.openAppUpdateDownloadPage()}>
                      手动下载安装包
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-group-panel">
                <h4>MyClaw 数据存储路径</h4>
                <div className="panel-grid path-grid">
                  <div className="path-field">
                    <span>Root</span>
                    <code>{myClawRootPath}</code>
                  </div>
                  <div className="path-field">
                    <span>Skills</span>
                    <code>{skillsRootPath}</code>
                  </div>
                  <div className="path-field">
                    <span>Sessions</span>
                    <code>{sessionsRootPath}</code>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ---- 通用页签 ---- */}
          {activeTab === "通用" && (
            <div className="settings-section">
              <div className="settings-group-panel">
                <h4>应用默认项</h4>
                <p className="description">运行时地址、启动行为和工作区级展示设置会在这里统一管理。</p>
                <div className="placeholder-box">
                  <p>通用设置暂无配置项</p>
                </div>
              </div>
            </div>
          )}

          {/* ---- 审批策略页签 ---- */}
          {activeTab === "审批" && (
            <div className="settings-section">
              <p className="description">管理执行工具和外部插件时的默认安全授权级别。</p>
              
              <div className="settings-group-panel">
                <div className="form-field">
                  <label>全局审批模式</label>
                  <select
                    className="desktop-select"
                    data-testid="approval-mode-select"
                    value={approvalDraft.mode}
                    onChange={(e) => setApprovalDraft((prev) => ({ ...prev, mode: e.target.value as ApprovalMode }))}
                  >
                    <option value="prompt">全部询问 (最安全)</option>
                    <option value="auto-read-only">仅高风险询问 (推荐)</option>
                    <option value="auto-allow-all">工作目录自动允许</option>
                    <option value="unrestricted">⚠ 危险模式 — 完全无限制</option>
                  </select>
                  <div className="form-hint">
                    {approvalDraft.mode === "prompt" && "所有工具调用均需手动审批确认。"}
                    {approvalDraft.mode === "auto-read-only" && "只读操作自动放行，写入/执行/网络等高风险操作需审批。"}
                    {approvalDraft.mode === "auto-allow-all" && "工作目录内的操作全部自动放行。访问外部路径（如桌面、其他盘符）时仍需审批确认。"}
                    {approvalDraft.mode === "unrestricted" && <span className="danger-text">警告：所有操作全部自动放行，请确保你完全信任当前的业务环境。</span>}
                  </div>
                </div>

                <div className="form-divider" />

                <label className="desktop-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="approval-readonly-toggle"
                    checked={approvalDraft.autoApproveReadOnly}
                    onChange={(e) => setApprovalDraft((prev) => ({ ...prev, autoApproveReadOnly: e.target.checked }))}
                  />
                  <div className="desktop-checkbox-label">
                    <span>只读操作默认自动允许</span>
                    <small>读取文件、搜索等不会改变系统状态的操作将直接放行。</small>
                  </div>
                </label>

                <label className="desktop-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="approval-skills-toggle"
                    checked={approvalDraft.autoApproveSkills}
                    onChange={(e) => setApprovalDraft((prev) => ({ ...prev, autoApproveSkills: e.target.checked }))}
                  />
                  <div className="desktop-checkbox-label">
                    <span>Skills 调用默认直接放行</span>
                    <small>所有通过审查注册的本地技能套件将不再经过二次弹窗。</small>
                  </div>
                </label>

                <div className="form-actions mt-4">
                  <button data-testid="approval-save" className="btn-primary" onClick={() => void saveApprovalPolicy()}>保存安全策略</button>
                </div>
              </div>
            </div>
          )}

          {/* ---- ASR 语音识别 ---- */}
          {activeTab === "语音识别" && (
            <div className="settings-section">
              <p className="description">配置会议流式 ASR 与离线识别服务地址，以及硅基员工使用的纪要生成模型。</p>
              
              <div className="settings-group-panel">
                <div className="form-field">
                  <label>实时流式 ASR WebSocket</label>
                  <input
                    className="desktop-input"
                    type="text"
                    value={asrDraft.wsUrl}
                    onChange={(e) => setAsrDraft((p) => ({ ...p, wsUrl: e.target.value }))}
                    placeholder="例如: ws://127.0.0.1:8080"
                  />
                </div>

                <div className="form-field">
                  <label>离线 ASR HTTP (批量转写)</label>
                  <input
                    className="desktop-input"
                    type="text"
                    value={asrDraft.httpUrl}
                    onChange={(e) => setAsrDraft((p) => ({ ...p, httpUrl: e.target.value }))}
                    placeholder="例如: https://api.myclaw.local/recognition"
                  />
                </div>

                <div className="form-row-multi">
                  <div className="form-field">
                    <label>识别模式</label>
                    <div className="radio-group">
                      <label className="desktop-radio-row">
                        <input
                          type="radio"
                          name="asr-mode"
                          value="online"
                          checked={asrDraft.mode === "online"}
                          onChange={() => setAsrDraft((p) => ({ ...p, mode: "online" }))}
                        />
                        <span>Online (快速呈现)</span>
                      </label>
                      <label className="desktop-radio-row">
                        <input
                          type="radio"
                          name="asr-mode"
                          value="2pass"
                          checked={asrDraft.mode === "2pass"}
                          onChange={() => setAsrDraft((p) => ({ ...p, mode: "2pass" }))}
                        />
                        <span>2pass (二次纠错)</span>
                      </label>
                    </div>
                  </div>

                  <div className="form-field" style={{ width: '120px' }}>
                    <label>最大分轨人数</label>
                    <input
                      className="desktop-input text-center"
                      type="number"
                      min={1} max={20}
                      value={asrDraft.maxSpeakers}
                      onChange={(e) => setAsrDraft((p) => ({ ...p, maxSpeakers: Number(e.target.value) || 1 }))}
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label>会议纪要大模型</label>
                  <select
                    className="desktop-select"
                    value={asrDraft.summaryModelProfileId ?? ""}
                    onChange={(e) => setAsrDraft((p) => ({ ...p, summaryModelProfileId: e.target.value ? e.target.value : null }))}
                  >
                    <option value="">跟随 Chat 默认模型</option>
                    {(workspace.models ?? []).map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name} · {m.model}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-divider" />
                
                <div className="form-row-switches">
                  <label className="desktop-checkbox-switch">
                    <input type="checkbox" checked={asrDraft.ssl} onChange={(e) => setAsrDraft((p) => ({ ...p, ssl: e.target.checked }))} />
                    <span>强制 WSS 加密传输</span>
                  </label>
                  <label className="desktop-checkbox-switch">
                    <input type="checkbox" checked={asrDraft.enableSpeaker} onChange={(e) => setAsrDraft((p) => ({ ...p, enableSpeaker: e.target.checked }))} />
                    <span>启用说话人声纹识别</span>
                  </label>
                </div>

                <div className="form-actions mt-4">
                  <button className="btn-primary" onClick={() => void saveAsrConfig()} disabled={asrSaving}>
                    {asrSaving ? "保存中..." : "保存 ASR 配置"}
                  </button>
                  {asrSaveStatus && (
                    <span className={`status-label ${asrSaveStatus.includes("失败") ? "danger-text" : "success-text"}`}>
                      {asrSaveStatus}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <style>{`
        /* Core Split Pane Layout */
        .settings-split-pane {
          display: flex;
          height: 100%;
          width: 100%;
          background: #0d0d0f; /* Pure dark desktop vibe */
          overflow: hidden;
        }

        /* Sidebar Styling */
        .settings-sidebar {
          width: 260px;
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.02);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
          padding: 24px 16px;
        }
        .sidebar-header {
          padding: 0 12px 24px;
        }
        .sidebar-title {
          font-size: 14px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          margin: 0;
        }
        .sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sidebar-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.6);
          font-size: 13px;
          font-weight: 500;
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          transition: all 0.15s ease-out;
          text-align: left;
        }
        .sidebar-item:hover {
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.9);
        }
        .sidebar-item.active {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05);
          border-color: rgba(255, 255, 255, 0.05);
        }
        .sidebar-item-icon {
          opacity: 0.7;
        }
        .sidebar-item.active .sidebar-item-icon {
          opacity: 1;
          color: #10a37f; /* A pop of primary accent color for active left nav */
        }

        /* Detail Pane Styling */
        .settings-detail-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          position: relative;
        }
        .settings-detail-header {
          position: sticky;
          top: 0;
          z-index: 10;
          padding: 32px 48px 24px;
          background: rgba(13, 13, 15, 0.85); /* Matches split pane bg with opacity */
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .header-breadcrumbs {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .header-breadcrumbs .eyebrow {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: rgba(255, 255, 255, 0.4);
        }
        .header-breadcrumbs .eyebrow.active {
          color: rgba(255, 255, 255, 0.7);
        }
        .breadcrumb-separator {
          color: rgba(255, 255, 255, 0.3);
        }
        .pane-title {
          font-size: 24px;
          font-weight: 600;
          color: #f0f6fc;
          margin: 0;
          letter-spacing: -0.01em;
        }

        /* Content Area */
        .settings-detail-content {
          padding: 32px 48px;
          /* Removed max-width to allow fluid expansion for grids */
        }
        .settings-section {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .description {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.5);
          line-height: 1.5;
          margin: 0 0 16px 0;
        }
        .section-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        /* High Density Model Row Card */
        .model-rows-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
          gap: 16px;
        }
        .model-row-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          transition: all 0.2s ease;
        }
        .model-row-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .model-row-card.is-active {
          background: rgba(16, 163, 127, 0.03);
          border-color: rgba(16, 163, 127, 0.25);
          box-shadow: 0 0 0 1px rgba(16, 163, 127, 0.1) inset;
        }
        .row-card-left {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .model-row-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .model-name {
          font-size: 15px;
          font-weight: 600;
          color: #e6edf3;
        }
        .badge {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .badge-active { background: rgba(16, 163, 127, 0.15); color: #10a37f; }
        .badge-provider { background: rgba(255, 255, 255, 0.1); color: rgba(255,255,255,0.7); }
        .badge-route { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
        
        .model-row-meta {
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.4);
        }
        .meta-item code {
          background: rgba(0,0,0,0.3);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
          color: rgba(255,255,255,0.6);
        }
        .model-row-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          margin-top: 4px;
        }
        .model-row-status.ok { color: #10a37f; }
        .model-row-status.fail { color: #f85149; }

        .row-card-right .row-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* Generic Settings Panel */
        .settings-group-panel {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-width: 860px; /* Preserve readability max-width for forms */
        }
        .settings-group-panel h4 {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          color: rgba(255,255,255,0.85);
        }

        /* Desktop Form Controls */
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .form-field label {
          font-size: 13px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
        }
        .desktop-input, .desktop-select {
          height: 36px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          color: #f0f6fc;
          padding: 0 12px;
          font-size: 13px;
          transition: all 0.2s;
        }
        .desktop-input:focus, .desktop-select:focus {
          outline: none;
          border-color: #10a37f;
          box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.15);
        }
        .form-hint {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.4);
          line-height: 1.4;
        }
        .danger-text { color: #f85149; font-weight: 500; }
        .success-text { color: #10a37f; font-weight: 500; }
        
        .form-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.06);
          margin: 8px 0;
        }

        .desktop-checkbox-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          cursor: pointer;
        }
        .desktop-checkbox-row input[type="checkbox"] {
          margin-top: 4px;
          accent-color: #10a37f;
        }
        .desktop-checkbox-label {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .desktop-checkbox-label span {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.85);
        }
        .desktop-checkbox-label small {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.4);
        }

        .form-row-multi {
          display: flex;
          gap: 24px;
          align-items: flex-end;
        }
        .radio-group {
          display: flex;
          gap: 16px;
          height: 36px;
          align-items: center;
        }
        .desktop-radio-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
        }
        .desktop-radio-row input { accent-color: #10a37f; }
        .text-center { text-align: center; }

        .form-row-switches {
          display: flex;
          gap: 24px;
        }
        .desktop-checkbox-switch {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
        }

        .mt-4 { margin-top: 16px; }
        .form-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        /* Data Grids */
        .panel-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .meta-field, .path-field {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
          padding: 8px 12px;
          background: rgba(0, 0, 0, 0.15);
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.03);
        }
        .meta-field span, .path-field span {
          color: rgba(255, 255, 255, 0.5);
          font-weight: 500;
        }
        .meta-field code, .path-field code {
          font-family: monospace;
          color: rgba(255, 255, 255, 0.9);
        }

        .update-actions { display: flex; gap: 12px; margin-top: 8px; }

        /* Buttons & Utility */
        .btn-primary, .btn-secondary, .btn-ghost-small {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
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
          background: rgba(16, 163, 127, 0.08);
          box-shadow: 0 0 8px rgba(16, 163, 127, 0.15);
        }
        .btn-secondary {
          height: 32px;
          padding: 0 16px;
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.8);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .btn-secondary:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
        }
        .btn-ghost-small {
          height: 28px;
          padding: 0 12px;
          background: transparent;
          color: rgba(255,255,255,0.6);
        }
        .btn-ghost-small:hover {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.9);
        }
        .btn-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-icon:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.9);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .settings-notice-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 8px;
          color: #38bdf8;
          font-size: 13px;
          margin-bottom: 8px;
        }

        .placeholder-box {
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px dashed rgba(255,255,255,0.15);
          border-radius: 8px;
          color: rgba(255,255,255,0.3);
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
