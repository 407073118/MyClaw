import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

type SetupStep = "directory" | "model" | "done";

const DEFAULT_MODEL = {
  name: "Qwen 3.5 Plus",
  provider: "openai-compatible" as const,
  baseUrl: "https://coding.dashscope.aliyuncs.com",
  baseUrlMode: "provider-root" as const,
  apiKey: "",
  model: "qwen3.5-plus",
};

export default function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SetupStep>("directory");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Model config state
  const [modelName, setModelName] = useState(DEFAULT_MODEL.name);
  const [modelBaseUrl, setModelBaseUrl] = useState(DEFAULT_MODEL.baseUrl);
  const [modelApiKey, setModelApiKey] = useState(DEFAULT_MODEL.apiKey);
  const [modelId, setModelId] = useState(DEFAULT_MODEL.model);
  const [modelError, setModelError] = useState("");

  async function handleSelectFolder() {
    const result = await window.myClawAPI.changeRootDir();
    if (result?.myClawRootPath) {
      setSelectedPath(result.myClawRootPath);
    }
  }

  function handleDirNext() {
    if (!selectedPath) return;
    setStep("model");
  }

  async function handleFinish() {
    if (!modelApiKey.trim()) {
      setModelError("请输入 API Key。");
      return;
    }
    setSaving(true);
    setModelError("");

    try {
      // Create the default model profile via IPC
      await window.myClawAPI.createModelProfile({
        name: modelName,
        provider: DEFAULT_MODEL.provider,
        baseUrl: modelBaseUrl,
        baseUrlMode: DEFAULT_MODEL.baseUrlMode,
        apiKey: modelApiKey,
        model: modelId,
      } as any);

      // Mark setup as done
      localStorage.setItem("myclaw-setup-done", "true");
      navigate("/login", { replace: true });
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "模型配置保存失败");
      setSaving(false);
    }
  }

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <div className="setup-header">
          <span className="eyebrow">MyClaw Desktop</span>
          <h1>初始配置</h1>
          <p>首次使用需要完成以下两步设置。</p>
        </div>

        {/* Step indicator */}
        <div className="step-indicator">
          <div className={`step-dot${step === "directory" ? " active" : " done"}`}>1</div>
          <div className="step-line" />
          <div className={`step-dot${step === "model" ? " active" : ""}`}>2</div>
        </div>

        {/* Step 1: Directory */}
        {step === "directory" && (
          <>
            <div className="setup-step">
              <div className="step-content">
                <h3>选择数据存储目录</h3>
                <p>MyClaw 会在您选择的目录下创建 <code>myClaw/</code> 文件夹，用于存放模型配置、Skills、会话记录等数据。</p>
                <button className="select-btn" onClick={handleSelectFolder}>
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  </svg>
                  {selectedPath ? "重新选择" : "选择文件夹"}
                </button>

                {selectedPath && (
                  <div className="selected-path">
                    <span className="path-label">已选择：</span>
                    <code className="path-value">{selectedPath}</code>
                    <div className="path-preview">
                      <p className="preview-title">将创建以下目录结构：</p>
                      <pre>{`${selectedPath}
├── skills/      — 技能定义
├── sessions/    — 会话记录
├── models/      — 模型配置
└── settings.json`}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button className="continue-btn" onClick={handleDirNext} disabled={!selectedPath}>
              下一步：配置模型
            </button>
          </>
        )}

        {/* Step 2: Model */}
        {step === "model" && (
          <>
            <div className="setup-step">
              <div className="step-content">
                <h3>配置默认 AI 模型</h3>
                <p>配置用于智能对话的 AI 模型。已为您填入默认值，只需输入 API Key 即可。</p>

                <div className="model-form">
                  <label className="field">
                    <span>模型名称</span>
                    <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="例如 Qwen 3.5 Plus" />
                  </label>

                  <label className="field">
                    <span>API 地址</span>
                    <input value={modelBaseUrl} onChange={(e) => setModelBaseUrl(e.target.value)} placeholder="https://..." />
                  </label>

                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={modelApiKey}
                      onChange={(e) => setModelApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                  </label>

                  <label className="field">
                    <span>模型 ID</span>
                    <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="例如 qwen3.5-plus" />
                  </label>
                </div>

                {modelError && <p className="error-msg">{modelError}</p>}
              </div>
            </div>

            <div className="btn-row">
              <button className="back-btn" onClick={() => setStep("directory")}>上一步</button>
              <button className="continue-btn" onClick={handleFinish} disabled={saving}>
                {saving ? "正在保存..." : "完成配置，进入登录"}
              </button>
            </div>
          </>
        )}
      </section>

      <style>{`
        .setup-page {
          height: 100vh;
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 32px;
          overflow-y: auto;
          background:
            radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 34%),
            radial-gradient(circle at bottom right, rgba(34, 197, 94, 0.16), transparent 28%),
            linear-gradient(160deg, #071018 0%, #0d1724 42%, #0b1016 100%);
        }

        .setup-panel {
          width: min(560px, 100%);
          padding: 40px;
          border-radius: 28px;
          background: rgba(10, 15, 25, 0.9);
          border: 1px solid rgba(148, 163, 184, 0.16);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
          display: grid;
          gap: 28px;
        }

        .setup-header {
          display: grid;
          gap: 10px;
        }

        .setup-header .eyebrow {
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.9);
        }

        .setup-header h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1.08;
          color: #f8fafc;
        }

        .setup-header p {
          margin: 0;
          color: rgba(226, 232, 240, 0.78);
          line-height: 1.7;
          font-size: 14px;
        }

        /* Step indicator */
        .step-indicator {
          display: flex;
          align-items: center;
          gap: 0;
          justify-content: center;
        }

        .step-dot {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          border: 2px solid rgba(148, 163, 184, 0.3);
          color: rgba(148, 163, 184, 0.5);
          background: transparent;
          transition: all 0.3s;
        }

        .step-dot.active {
          border-color: #38bdf8;
          color: #38bdf8;
          background: rgba(56, 189, 248, 0.1);
        }

        .step-dot.done {
          border-color: #22c55e;
          color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
        }

        .step-line {
          width: 60px;
          height: 2px;
          background: rgba(148, 163, 184, 0.2);
        }

        /* Step content */
        .setup-step {
          display: flex;
          gap: 16px;
        }

        .step-content {
          flex: 1;
          display: grid;
          gap: 14px;
        }

        .step-content h3 {
          margin: 0;
          font-size: 16px;
          color: #f8fafc;
          font-weight: 600;
        }

        .step-content p {
          margin: 0;
          color: rgba(226, 232, 240, 0.7);
          font-size: 13px;
          line-height: 1.6;
        }

        .step-content code {
          background: rgba(56, 189, 248, 0.1);
          color: #38bdf8;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
        }

        .select-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.8);
          color: #f8fafc;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .select-btn:hover {
          border-color: rgba(56, 189, 248, 0.5);
          background: rgba(56, 189, 248, 0.08);
        }

        .selected-path {
          display: grid;
          gap: 8px;
          padding: 16px;
          border-radius: 12px;
          background: rgba(34, 197, 94, 0.06);
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .path-label {
          font-size: 12px;
          color: #22c55e;
          font-weight: 600;
        }

        .path-value {
          font-size: 13px;
          color: #f8fafc;
          word-break: break-all;
          background: rgba(15, 23, 42, 0.6);
          padding: 8px 10px;
          border-radius: 6px;
        }

        .path-preview {
          margin-top: 4px;
        }

        .preview-title {
          font-size: 11px !important;
          color: rgba(148, 163, 184, 0.7) !important;
          margin-bottom: 6px !important;
        }

        .path-preview pre {
          margin: 0;
          font-size: 12px;
          color: rgba(226, 232, 240, 0.6);
          line-height: 1.6;
          padding: 10px;
          background: rgba(15, 23, 42, 0.5);
          border-radius: 6px;
          border: 1px solid rgba(148, 163, 184, 0.1);
        }

        /* Model form */
        .model-form {
          display: grid;
          gap: 14px;
        }

        .model-form .field {
          display: grid;
          gap: 6px;
        }

        .model-form .field span {
          font-size: 12px;
          color: #cbd5e1;
          font-weight: 500;
        }

        .model-form .field input {
          height: 42px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(15, 23, 42, 0.8);
          color: #f8fafc;
          padding: 0 14px;
          font-size: 13px;
          font-family: inherit;
        }

        .model-form .field input:focus {
          outline: none;
          border-color: rgba(56, 189, 248, 0.8);
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
        }

        .error-msg {
          margin: 0;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 13px;
          color: #fecaca;
          background: rgba(127, 29, 29, 0.4);
          border: 1px solid rgba(248, 113, 113, 0.24);
        }

        /* Buttons */
        .continue-btn {
          height: 48px;
          border: none;
          border-radius: 14px;
          background: linear-gradient(135deg, #38bdf8, #22c55e);
          color: #04111b;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
          transition: all 0.2s;
          flex: 1;
        }

        .continue-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .continue-btn:not(:disabled):hover {
          opacity: 0.9;
        }

        .btn-row {
          display: flex;
          gap: 12px;
        }

        .back-btn {
          height: 48px;
          padding: 0 24px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 14px;
          background: transparent;
          color: rgba(226, 232, 240, 0.8);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .back-btn:hover {
          border-color: rgba(148, 163, 184, 0.4);
          background: rgba(148, 163, 184, 0.06);
        }
      `}</style>
    </main>
  );
}
