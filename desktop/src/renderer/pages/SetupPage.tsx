import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  BR_MINIMAX_BASE_URL,
  BR_MINIMAX_MODEL,
  BR_MINIMAX_PROVIDER_FLAVOR,
  createBrMiniMaxProfile,
} from "@shared/br-minimax";
import type { ModelProfile, ProviderKind } from "@shared/contracts";

// ── 供应商选项 ─────────────────────────────────────────────────────────────

type ProviderOption = {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  baseUrlMode: "provider-root" | "manual";
  provider: ProviderKind;
  providerFlavor?: ModelProfile["providerFlavor"];
  defaultModel?: string;
  recommended?: boolean;
  modelPlaceholder?: string;
};

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: "br-minimax",
    label: "BR MiniMax",
    description: "企业私有部署，系统预置网关与推荐参数",
    baseUrl: BR_MINIMAX_BASE_URL,
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    providerFlavor: BR_MINIMAX_PROVIDER_FLAVOR,
    defaultModel: BR_MINIMAX_MODEL,
    recommended: true,
    modelPlaceholder: "minimax-m2-5",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o、o1 等 OpenAI 官方模型",
    baseUrl: "https://api.openai.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    modelPlaceholder: "gpt-4o",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude 系列，支持 Messages API",
    baseUrl: "https://api.anthropic.com",
    baseUrlMode: "provider-root",
    provider: "anthropic",
    modelPlaceholder: "claude-sonnet-4-20250514",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek-V3、R1 等推理模型",
    baseUrl: "https://api.deepseek.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    providerFlavor: "deepseek",
    modelPlaceholder: "deepseek-chat",
  },
  {
    id: "qwen",
    label: "通义千问",
    description: "阿里云 DashScope 千问系列",
    baseUrl: "https://dashscope.aliyuncs.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    modelPlaceholder: "qwen-max",
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "MiniMax 官方 API，长文本与多模态",
    baseUrl: "https://api.minimaxi.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    modelPlaceholder: "abab6-chat",
  },
  {
    id: "volcengine-ark",
    label: "火山引擎 Ark",
    description: "字节跳动旗下模型推理平台",
    baseUrl: "https://ark.cn-beijing.volces.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    providerFlavor: "volcengine-ark",
    modelPlaceholder: "doubao-pro-32k",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    description: "Kimi 背后的 Moonshot AI",
    baseUrl: "https://api.moonshot.cn",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    modelPlaceholder: "moonshot-v1-8k",
  },
  {
    id: "custom",
    label: "自定义接入",
    description: "填写任意 OpenAI 兼容接口",
    baseUrl: "",
    baseUrlMode: "manual",
    provider: "openai-compatible",
    modelPlaceholder: "model-id",
  },
];

// ── 页面组件 ──────────────────────────────────────────────────────────────

/** 首次启动引导页，帮助用户选择供应商并快速配置默认模型。 */
export default function SetupPage() {
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();

  const [step, setStep] = useState<"select" | "configure">("select");
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const isBrMiniMax = selectedProvider?.id === "br-minimax";
  const isCustom = selectedProvider?.id === "custom";

  /** 点选供应商卡片，进入配置步骤并预填默认值。 */
  function handleSelectProvider(provider: ProviderOption) {
    setSelectedProvider(provider);
    setApiKey("");
    setModelId(provider.defaultModel ?? "");
    setBaseUrl(provider.baseUrl);
    setError("");
    setShowPassword(false);
    setStep("configure");
  }

  /** 返回供应商选择。 */
  function handleBackToSelect() {
    setStep("select");
    setSelectedProvider(null);
    setApiKey("");
    setModelId("");
    setBaseUrl("");
    setError("");
  }

  /** 校验并保存模型配置，完成首次引导。 */
  async function handleFinish() {
    if (!selectedProvider) return;

    if (!apiKey.trim()) {
      setError("请输入 API Key。");
      return;
    }
    if (!isBrMiniMax && !modelId.trim()) {
      setError("请输入模型 ID。");
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setError("自定义接入需要填写接口地址。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      let profileInput: Omit<ModelProfile, "id">;

      if (isBrMiniMax) {
        profileInput = createBrMiniMaxProfile({ apiKey: apiKey.trim() });
      } else {
        profileInput = {
          name: selectedProvider.label,
          provider: selectedProvider.provider,
          providerFlavor: selectedProvider.providerFlavor,
          baseUrl: baseUrl.trim(),
          baseUrlMode: selectedProvider.baseUrlMode,
          apiKey: apiKey.trim(),
          model: modelId.trim(),
          headers: {},
          requestBody: {},
        };
      }

      const result = await window.myClawAPI.createModelProfile(profileInput);
      workspace.addModelAndClearSetup(result.profile);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型配置保存失败");
      setSaving(false);
    }
  }

  // ── 选择供应商 ──────────────────────────────────────────────────────────

  if (step === "select") {
    return (
      <main className="setup-page">
        <section className="setup-panel setup-panel--wide" key="select">
          <div className="setup-header">
            <span className="setup-eyebrow">MyClaw Desktop</span>
            <h1 className="setup-title">选择你的 AI 模型供应商</h1>
            <p className="setup-subtitle">
              开始之前，先选择一个模型服务。你可以随时在设置中添加更多或修改配置。
            </p>
          </div>

          <div className="provider-grid">
            {PROVIDER_OPTIONS.map((provider) => (
              <button
                key={provider.id}
                className={`provider-card${provider.recommended ? " provider-card--recommended" : ""}`}
                onClick={() => handleSelectProvider(provider)}
                type="button"
              >
                {provider.recommended && (
                  <span className="provider-badge">推荐</span>
                )}
                <span className="provider-card-name">{provider.label}</span>
                <span className="provider-card-desc">{provider.description}</span>
              </button>
            ))}
          </div>
        </section>

        <style>{setupStyles}</style>
      </main>
    );
  }

  // ── 配置表单 ──────────────────────────────────────────────────────────

  return (
    <main className="setup-page">
      <section className="setup-panel" key="configure">
        <button className="back-link" onClick={handleBackToSelect} type="button">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 12H5M12 19l-7-7 7-7"
            />
          </svg>
          重新选择供应商
        </button>

        <div className="setup-header">
          <span className="setup-eyebrow">MyClaw Desktop</span>
          <h1 className="setup-title">配置 {selectedProvider?.label}</h1>
          <p className="setup-subtitle">
            填写以下信息完成模型接入。高级选项可稍后在设置页调整。
          </p>
        </div>

        <div className="config-form">
          {/* API Key — 所有供应商都需要 */}
          <div className="form-field">
            <label className="form-label">API Key</label>
            <p className="form-desc">
              你的模型服务密钥，用于身份验证。通常在供应商控制台中生成。
            </p>
            <div className="input-password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                className="form-input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoFocus
              />
              <button
                type="button"
                className="eye-toggle"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "隐藏密钥" : "显示密钥"}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                    />
                    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* 模型 ID — 非 BR MiniMax 供应商 */}
          {!isBrMiniMax && (
            <div className="form-field">
              <label className="form-label">模型 ID</label>
              <p className="form-desc">
                指定要调用的具体模型名称。不确定可以先用示例值，稍后在设置中修改。
              </p>
              <input
                type="text"
                className="form-input"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={selectedProvider?.modelPlaceholder ?? "model-id"}
              />
            </div>
          )}

          {/* 接口地址 — 仅 Custom 模式需要手动输入 */}
          {isCustom && (
            <div className="form-field">
              <label className="form-label">接口地址 (Base URL)</label>
              <p className="form-desc">
                模型服务的 API 根地址，需要完整填写。系统会自动拼接具体路由路径。
              </p>
              <input
                type="text"
                className="form-input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://gateway.example.com/v1"
              />
            </div>
          )}

          {/* 已知供应商显示预设接口地址 */}
          {!isCustom && !isBrMiniMax && (
            <div className="preset-info">
              <span className="preset-info-label">接口地址</span>
              <span className="preset-info-value">{baseUrl}</span>
              <span className="preset-info-hint">使用预设官方地址，可在设置页修改</span>
            </div>
          )}

          {/* BR MiniMax 托管参数预览 */}
          {isBrMiniMax && (
            <div className="managed-card">
              <div className="managed-card-header">托管配置（由系统自动管理）</div>
              <div className="managed-row">
                <span className="managed-label">模型 ID</span>
                <span className="managed-value">{BR_MINIMAX_MODEL}</span>
              </div>
              <div className="managed-row">
                <span className="managed-label">网关地址</span>
                <span className="managed-value">{BR_MINIMAX_BASE_URL}</span>
              </div>
              <div className="managed-row">
                <span className="managed-label">运行模式</span>
                <span className="managed-value">托管 thinking + tool use 优化</span>
              </div>
              <p className="managed-note">
                以上参数可在设置 &gt; 模型详情中手动调整。
              </p>
            </div>
          )}
        </div>

        {error && <p className="setup-error">{error}</p>}

        <button
          className="finish-btn"
          onClick={handleFinish}
          disabled={saving}
          type="button"
        >
          {saving ? "正在保存..." : "完成配置，开始使用"}
          {!saving && (
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 12h14M12 5l7 7-7 7"
              />
            </svg>
          )}
        </button>
      </section>

      <style>{setupStyles}</style>
    </main>
  );
}

// ── 页面样式 ──────────────────────────────────────────────────────────────

const setupStyles = `
  .setup-page {
    height: 100vh;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px;
    overflow-y: auto;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(16, 163, 127, 0.1), transparent 50%),
      radial-gradient(ellipse at 80% 100%, rgba(16, 163, 127, 0.05), transparent 40%),
      var(--bg-base);
  }

  /* ── 面板 ── */
  .setup-panel {
    width: min(560px, 100%);
    display: flex;
    flex-direction: column;
    gap: 24px;
    animation: setupFadeUp 0.3s ease;
  }

  .setup-panel--wide {
    width: min(720px, 100%);
  }

  @keyframes setupFadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── 头部 ── */
  .setup-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setup-eyebrow {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--accent-cyan);
  }

  .setup-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.15;
  }

  .setup-subtitle {
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.6;
    margin: 0;
  }

  /* ── 返回链接 ── */
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s;
    align-self: flex-start;
  }

  .back-link:hover {
    color: var(--text-primary);
  }

  /* ── 供应商网格 ── */
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .provider-card {
    padding: 20px 18px;
    border-radius: var(--radius-xl);
    background: var(--bg-card);
    border: 1px solid var(--glass-border);
    backdrop-filter: var(--blur-std);
    -webkit-backdrop-filter: var(--blur-std);
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
    overflow: hidden;
  }

  .provider-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 50%);
    pointer-events: none;
  }

  .provider-card:hover {
    border-color: var(--glass-border-hover);
    transform: translateY(-3px);
    box-shadow: var(--shadow-card-hover), inset 0 1px 0 rgba(255,255,255,0.06);
  }

  .provider-card--recommended {
    border-color: rgba(16, 163, 127, 0.25);
    box-shadow: 0 0 0 0 transparent;
  }

  .provider-card--recommended:hover {
    border-color: rgba(16, 163, 127, 0.45);
    box-shadow: var(--shadow-card-hover), var(--shadow-glow-accent);
  }

  .provider-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    color: var(--accent-cyan);
    background: rgba(16, 163, 127, 0.12);
    border: 1px solid rgba(16, 163, 127, 0.25);
    letter-spacing: 0.04em;
    line-height: 1.5;
  }

  .provider-card-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .provider-card-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* ── 配置表单 ── */
  .config-form {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 28px 24px;
    border-radius: var(--radius-xl);
    background: var(--bg-card);
    border: 1px solid var(--glass-border);
    backdrop-filter: var(--blur-std);
    -webkit-backdrop-filter: var(--blur-std);
    box-shadow: var(--shadow-card);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 4px;
  }

  .form-input {
    height: 42px;
    padding: 0 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--glass-border);
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    transition: border-color 0.2s, box-shadow 0.2s;
    width: 100%;
  }

  .form-input:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
  }

  .form-input::placeholder {
    color: var(--text-muted);
  }

  /* ── 密码输入 ── */
  .input-password-wrap {
    position: relative;
    display: flex;
  }

  .input-password-wrap .form-input {
    padding-right: 42px;
  }

  .eye-toggle {
    position: absolute;
    right: 1px;
    top: 1px;
    bottom: 1px;
    width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .eye-toggle:hover {
    color: var(--text-primary);
  }

  /* ── 预设信息行 ── */
  .preset-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .preset-info-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .preset-info-value {
    font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .preset-info-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* ── BR MiniMax 托管卡片 ── */
  .managed-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(16, 163, 127, 0.15);
    background: rgba(16, 163, 127, 0.04);
  }

  .managed-card-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-cyan);
    letter-spacing: 0.02em;
  }

  .managed-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    font-size: 12px;
    line-height: 1.5;
  }

  .managed-label {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .managed-value {
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-align: right;
    word-break: break-all;
  }

  .managed-note {
    font-size: 11px;
    color: var(--text-muted);
    margin: 2px 0 0;
    line-height: 1.5;
  }

  /* ── 错误提示 ── */
  .setup-error {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    font-size: 13px;
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  /* ── 完成按钮 ── */
  .finish-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 46px;
    width: 100%;
    border: 1px solid var(--accent-cyan);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--accent-cyan);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s ease;
  }

  .finish-btn:hover:not(:disabled) {
    background: rgba(16, 163, 127, 0.08);
    box-shadow: 0 4px 15px rgba(16, 163, 127, 0.15);
    transform: translateY(-1px);
  }

  .finish-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── 响应式 ── */
  @media (max-width: 640px) {
    .setup-page {
      padding: 20px;
    }
    .provider-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .setup-title {
      font-size: 22px;
    }
    .config-form {
      padding: 20px 16px;
    }
  }

  @media (max-width: 420px) {
    .provider-grid {
      grid-template-columns: 1fr;
    }
  }
`;
