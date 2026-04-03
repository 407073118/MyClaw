import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import type { ModelProfile, ProviderKind } from "@shared/contracts";
import { resolveModelCapability } from "../../main/services/model-capability-resolver";
import { formatTokenCount, formatCapabilitySource } from "../utils/context-ui-helpers";

// ── Provider presets (inlined from desktop/apps/desktop/src/settings/provider-presets.ts) ──

type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  baseUrlMode: "provider-root" | "manual";
  provider: ProviderKind;
};

const providerPresets: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimaxi.com", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "moonshot", label: "Moonshot", baseUrl: "https://api.moonshot.cn", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "qwen", label: "Qwen", baseUrl: "https://dashscope.aliyuncs.com", baseUrlMode: "provider-root", provider: "openai-compatible" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", baseUrlMode: "provider-root", provider: "anthropic" },
  { id: "custom", label: "Custom", baseUrl: "", baseUrlMode: "manual", provider: "openai-compatible" },
];

function resolveProviderPresetId(profile: Pick<ModelProfile, "provider" | "baseUrl" | "model">): string {
  const normalizedBaseUrl = profile.baseUrl.trim().toLowerCase();
  const normalizedModel = profile.model.trim().toLowerCase();

  if (normalizedBaseUrl.includes("minimax") || normalizedBaseUrl.includes("minimaxi") || normalizedModel.startsWith("minimax")) return "minimax";
  if (profile.provider === "anthropic" || normalizedBaseUrl.includes("anthropic")) return "anthropic";
  if (normalizedBaseUrl.includes("dashscope.aliyuncs.com") || normalizedModel.startsWith("qwen")) return "qwen";
  if (normalizedBaseUrl.includes("moonshot")) return "moonshot";
  if (normalizedBaseUrl.includes("openai.com")) return "openai";
  return "custom";
}

// ── ModelDetailPage ───────────────────────────────────────────────────────────

export default function ModelDetailPage() {
  const { id: profileId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();

  const isNew = !profileId || location.pathname === "/settings/models/new";

  const [profile, setProfile] = useState<ModelProfile>({
    id: "",
    name: "",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com",
    baseUrlMode: "provider-root",
    apiKey: "",
    model: "",
    headers: {},
    requestBody: {},
  });
  const [selectedPresetId, setSelectedPresetId] = useState("openai");
  const [headersText, setHeadersText] = useState("");
  const [requestBodyText, setRequestBodyText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState("");
  const [availableModelIds, setAvailableModelIds] = useState<string[]>([]);

  const baseUrlPlaceholder = profile.baseUrlMode === "provider-root"
    ? "https://api.minimaxi.com"
    : "https://gateway.example.com/v1";

  const baseUrlHint = profile.baseUrlMode === "provider-root"
    ? "当前预设只需填写服务根地址，系统会自动补全对应厂商接口路径。"
    : "Custom 模式需要填写完整兼容地址，例如 https://gateway.example.com/v1。";

  function applyPreset(presetId?: string) {
    const id = presetId ?? selectedPresetId;
    const preset = providerPresets.find((p) => p.id === id);
    if (preset) {
      setProfile((prev) => ({
        ...prev,
        provider: preset.provider,
        baseUrl: preset.baseUrl,
        baseUrlMode: preset.baseUrlMode,
        ...(isNew ? { name: `New ${preset.label} Config` } : {}),
      }));
      setAvailableModelIds([]);
      setModelCatalogError("");
    }
  }

  useEffect(() => {
    if (!isNew) {
      const existing = workspace.models.find((m) => m.id === profileId);
      if (existing) {
        setProfile({ ...existing });
        setHeadersText(existing.headers ? JSON.stringify(existing.headers, null, 2) : "");
        setRequestBodyText(existing.requestBody ? JSON.stringify(existing.requestBody, null, 2) : "");
        const presetId = resolveProviderPresetId(existing);
        setSelectedPresetId(presetId);
      } else {
        navigate("/settings");
      }
    } else {
      applyPreset("openai");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applySelectedModelId(event: React.ChangeEvent<HTMLSelectElement>) {
    setProfile((prev) => ({ ...prev, model: event.target.value }));
  }

  function handleBack() {
    navigate("/settings");
  }

  async function handleDelete() {
    if (!window.confirm("确定要删除此模型配置吗？")) return;
    setIsBusy(true);
    try {
      await workspace.deleteModelProfile(profile.id);
      navigate("/settings");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setIsBusy(false);
    }
  }

  async function upsertProfile() {
    setError("");
    let parsedHeaders = {};
    let parsedBody = {};

    try {
      if (headersText.trim()) parsedHeaders = JSON.parse(headersText);
      if (requestBodyText.trim()) parsedBody = JSON.parse(requestBodyText);
    } catch {
      setError("JSON 格式不正确，请检阅 Headers 或 RequestBody 字段。");
      return;
    }

    setIsBusy(true);
    try {
      const data: ModelProfile = {
        ...profile,
        name: profile.name.trim() || "未命名配置",
        baseUrl: profile.baseUrl.trim(),
        baseUrlMode: profile.baseUrlMode,
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
        headers: parsedHeaders,
        requestBody: parsedBody,
      };

      if (isNew) {
        const newProfile = await workspace.createModelProfile(data);
        await workspace.setDefaultModelProfile(newProfile.id);
      } else {
        await workspace.updateModelProfile(profile.id, data);
      }
      navigate("/settings");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setIsBusy(false);
    }
  }

  /** 基于当前表单配置拉取模型目录，并将首个结果回填到模型输入框。 */
  async function loadModelCatalog() {
    setModelCatalogError("");
    setAvailableModelIds([]);
    setIsFetchingModels(true);

    try {
      const parsedHeaders = headersText.trim() ? JSON.parse(headersText) : {};
      const parsedBody = requestBodyText.trim() ? JSON.parse(requestBodyText) : {};
      const modelIds = await workspace.fetchAvailableModelIds({
        provider: profile.provider,
        baseUrl: profile.baseUrl.trim(),
        baseUrlMode: profile.baseUrlMode,
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
        headers: parsedHeaders,
        requestBody: parsedBody,
      });

      setAvailableModelIds(modelIds);
      if (!profile.model && modelIds.length > 0) {
        setProfile((prev) => ({ ...prev, model: modelIds[0]! }));
      }
      if (modelIds.length === 0) {
        setModelCatalogError("当前服务未返回可用模型，请确认接口地址、权限与服务商兼容性。");
      }
    } catch (e: unknown) {
      setModelCatalogError((e as Error)?.message ?? "模型列表获取失败");
    } finally {
      setIsFetchingModels(false);
    }
  }

  return (
    <div className="model-detail-layout">
      {/* Compact Top Bar */}
      <header className="detail-topbar">
        <div className="topbar-left">
          <button className="icon-back-btn" onClick={handleBack} title="返回设置">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 12H5M12 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div className="divider" />
          <div className="title-group">
            <span className="eyebrow">{isNew ? "新增模型" : "编辑配置"}</span>
            <h2 className="title">{profile.name || "未命名配置"}</h2>
          </div>
        </div>

        <div className="topbar-right">
          {!isNew && (
            <button className="danger-ghost-btn" onClick={handleDelete} disabled={isBusy}>
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                />
              </svg>
              删除
            </button>
          )}
          <button className="primary-save-btn" onClick={upsertProfile} disabled={isBusy}>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8"
              />
            </svg>
            {isBusy ? "保存中..." : "保存配置"}
          </button>
        </div>
      </header>

      <main className="detail-content">
        {error && (
          <div className="error-banner">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <div className="main-form">
          {/* Section: Basic Info */}
          <section className="form-section">
            <div className="section-header">
              <span className="dot-icon" />
              基础参数
            </div>
            <div className="field-grid">
              <label className="field">
                <span className="label">配置名称</span>
                <input
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="例如：我的 GPT-4o"
                />
              </label>
              <label className="field">
                <span className="label">服务商预设</span>
                <div className="select-wrapper">
                  <select
                    value={selectedPresetId}
                    data-testid="model-preset-select"
                    onChange={(e) => {
                      setSelectedPresetId(e.target.value);
                      applyPreset(e.target.value);
                    }}
                  >
                    {providerPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <div className="select-arrow">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 9l6 6 6-6"
                      />
                    </svg>
                  </div>
                </div>
              </label>
              <label className="field">
                <span className="label">模型 ID</span>
                <input
                  value={profile.model}
                  onChange={(e) => setProfile((prev) => ({ ...prev, model: e.target.value }))}
                  data-testid="model-id-input"
                  placeholder="gpt-4o, claude-3-5-sonnet..."
                />
                {availableModelIds.length > 0 && (
                  <div className="field-inline">
                    <div className="select-wrapper">
                      <select
                        value={profile.model}
                        data-testid="model-id-select"
                        onChange={applySelectedModelId}
                      >
                        {availableModelIds.map((modelId) => (
                          <option key={modelId} value={modelId}>
                            {modelId}
                          </option>
                        ))}
                      </select>
                      <div className="select-arrow">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 9l6 6 6-6"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}
              </label>
              <label className="field">
                <span className="label">接口地址 (Base URL)</span>
                <input
                  value={profile.baseUrl}
                  onChange={(e) => setProfile((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  data-testid="model-base-url-input"
                  placeholder={baseUrlPlaceholder}
                />
                <input
                  type="hidden"
                  value={profile.baseUrlMode ?? "manual"}
                  data-testid="model-base-url-mode"
                  readOnly
                />
                <div className="field-hint">{baseUrlHint}</div>
              </label>
              <label className="field full-width">
                <span className="label">API Key / Token</span>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={profile.apiKey}
                    onChange={(e) => setProfile((prev) => ({ ...prev, apiKey: e.target.value }))}
                    data-testid="model-api-key-input"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword((v) => !v)}
                    title={showPassword ? "隐藏" : "显示"}
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
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="field-inline">
                  <button
                    type="button"
                    className="secondary-action-btn"
                    data-testid="model-fetch-list"
                    disabled={isFetchingModels}
                    onClick={loadModelCatalog}
                  >
                    {isFetchingModels ? "加载中..." : "获取模型列表"}
                  </button>
                </div>
                {modelCatalogError && (
                  <div className="field-hint error-hint">{modelCatalogError}</div>
                )}
              </label>
            </div>
          </section>

          {/* Section: Advanced Parameters */}
          <section className="form-section flex-fill">
            <div className="section-header">
              <span className="dot-icon blue" />
              高级负载 (JSON)
            </div>
            <div className="editor-row">
              <div className="editor-col">
                <div className="field">
                  <span className="label">自定义 Headers</span>
                  <textarea
                    value={headersText}
                    onChange={(e) => setHeadersText(e.target.value)}
                    placeholder='{"x-custom-header": "value"}'
                  />
                  <div className="field-hint">附加到每个 HTTP 请求头的 JSON 对象。</div>
                </div>
              </div>
              <div className="editor-col">
                <div className="field">
                  <span className="label">额外请求体 (RequestBody)</span>
                  <textarea
                    value={requestBodyText}
                    onChange={(e) => setRequestBodyText(e.target.value)}
                    placeholder='{"temperature": 0.7}'
                  />
                  <div className="field-hint">合并到模型请求 payload 中的 JSON 参数。</div>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Model Capability Info (read-only diagnostics) */}
          {!isNew && profile.model && (
            <section className="form-section">
              <div className="section-header">
                <span className="dot-icon green" />
                模型能力（自动解析）
              </div>
              {(() => {
                const resolved = resolveModelCapability(profile);
                const eff = resolved.effective;
                return (
                  <div className="capability-card">
                    <div className="cap-grid">
                      <div className="cap-item">
                        <span className="cap-label">上下文窗口</span>
                        <span className="cap-value">{formatTokenCount(eff.contextWindowTokens)}</span>
                      </div>
                      <div className="cap-item">
                        <span className="cap-label">最大输入</span>
                        <span className="cap-value">{formatTokenCount(eff.maxInputTokens)}</span>
                      </div>
                      <div className="cap-item">
                        <span className="cap-label">最大输出</span>
                        <span className="cap-value">{formatTokenCount(eff.maxOutputTokens)}</span>
                      </div>
                      <div className="cap-item">
                        <span className="cap-label">能力来源</span>
                        <span className="cap-value cap-source">{formatCapabilitySource(eff.source)}</span>
                      </div>
                    </div>
                    <div className="cap-features">
                      {eff.supportsTools && <span className="feature-tag">工具调用</span>}
                      {eff.supportsStreaming && <span className="feature-tag">流式输出</span>}
                      {eff.supportsReasoning && <span className="feature-tag">推理</span>}
                      {eff.supportsVision && <span className="feature-tag">视觉</span>}
                      {eff.supportsPromptCaching && <span className="feature-tag">提示缓存</span>}
                    </div>
                  </div>
                );
              })()}
            </section>
          )}
        </div>
      </main>

      <style>{`
        .model-detail-layout {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #0d0d0f;
          color: #fff;
          overflow: hidden;
        }

        .detail-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 56px;
          padding: 0 24px;
          background: #161618;
          border-bottom: 1px solid #27272a;
          flex-shrink: 0;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .icon-back-btn {
          background: transparent;
          border: 0;
          color: #a1a1aa;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          transition: all 0.2s;
        }

        .icon-back-btn:hover { background: #27272a; color: #fff; }

        .divider {
          width: 1px;
          height: 20px;
          background: #3f3f46;
        }

        .eyebrow {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: #71717a;
          letter-spacing: 0.05em;
          display: block;
        }

        .title {
          font-size: 16px;
          font-weight: 600;
          margin: 0;
          color: #f4f4f5;
        }

        .topbar-right {
          display: flex;
          gap: 12px;
        }

        .primary-save-btn, .danger-ghost-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 16px;
          height: 32px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary-save-btn {
          background: #fff;
          color: #000;
          border: 0;
        }

        .primary-save-btn:hover:not(:disabled) { opacity: 0.9; }
        .primary-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .danger-ghost-btn {
          background: transparent;
          border: 1px solid #451a1a;
          color: #f87171;
        }

        .danger-ghost-btn:hover { background: #451a1a; }

        .detail-content {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .error-banner {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          color: #f87171;
          padding: 10px 16px;
          border-radius: 6px;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .main-form {
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 900px;
          width: 100%;
          margin: 0 auto;
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #a1a1aa;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .dot-icon {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #eab308;
          display: inline-block;
        }

        .dot-icon.blue { background: #3b82f6; }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field.full-width { grid-column: span 2; }

        .label {
          font-size: 12px;
          color: #71717a;
          font-weight: 500;
        }

        .field input, .field select, .field textarea {
          background: #161618;
          border: 1px solid #27272a;
          border-radius: 6px;
          color: #f4f4f5;
          padding: 8px 12px;
          font-size: 14px;
          outline: none;
          transition: all 0.2s;
          width: 100%;
          font: inherit;
        }

        .field select {
          appearance: none;
          cursor: pointer;
          padding-right: 32px;
        }

        .select-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .select-wrapper select {
          width: 100%;
        }

        .select-arrow {
          position: absolute;
          right: 12px;
          pointer-events: none;
          color: #71717a;
          display: flex;
          align-items: center;
        }

        .field input:focus, .field select:focus, .field textarea:focus {
          border-color: #3f3f46;
          background: #09090b;
        }

        .editor-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .editor-col {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .password-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .password-input-wrapper input { padding-right: 40px; }

        .toggle-password {
          position: absolute;
          right: 8px;
          background: transparent;
          border: 0;
          color: #71717a;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .toggle-password:hover { color: #fff; background: rgba(255,255,255,0.05); }

        .field textarea {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          min-height: 180px;
          line-height: 1.5;
          resize: none;
        }

        .field-hint {
          font-size: 11px;
          color: #52525b;
          margin-top: 4px;
        }

        .field-inline { margin-top: 10px; }

        .secondary-action-btn {
          height: 36px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid #303038;
          background: #1b1b1f;
          color: #f4f4f5;
          cursor: pointer;
          font: inherit;
        }

        .secondary-action-btn:disabled { cursor: not-allowed; opacity: 0.6; }

        .error-hint { color: #fca5a5; }

        .flex-fill { flex: 1; }

        .dot-icon.green { background: #22c55e; }

        .capability-card {
          background: #161618;
          border: 1px solid #27272a;
          border-radius: 8px;
          padding: 16px;
        }

        .cap-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 12px;
        }

        .cap-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .cap-label {
          font-size: 11px;
          color: #71717a;
        }

        .cap-value {
          font-size: 16px;
          font-weight: 600;
          color: #f4f4f5;
          font-family: monospace;
        }

        .cap-source {
          font-size: 13px;
          font-family: inherit;
          color: #a1a1aa;
        }

        .cap-features {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .feature-tag {
          font-size: 11px;
          padding: 2px 10px;
          border-radius: 999px;
          background: #22c55e15;
          border: 1px solid #22c55e33;
          color: #4ade80;
        }

        .detail-content::-webkit-scrollbar { width: 6px; }
        .detail-content::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
      `}</style>
    </div>
  );
}
