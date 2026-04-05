import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  BR_MINIMAX_BASE_URL,
  BR_MINIMAX_DEFAULT_NAME,
  BR_MINIMAX_MODEL,
  createBrMiniMaxProfile,
} from "@shared/br-minimax";

const DEFAULT_MODEL = {
  name: BR_MINIMAX_DEFAULT_NAME,
  provider: "openai-compatible" as const,
  baseUrl: BR_MINIMAX_BASE_URL,
  baseUrlMode: "provider-root" as const,
  apiKey: "",
  model: BR_MINIMAX_MODEL,
};

/** 首次启动引导页，帮助用户快速配置默认模型。 */
export default function SetupPage() {
  const navigate = useNavigate();
  const workspace = useWorkspaceStore();
  const [saving, setSaving] = useState(false);

  // 模型配置表单状态。
  const [modelApiKey, setModelApiKey] = useState(DEFAULT_MODEL.apiKey);
  const [modelError, setModelError] = useState("");

  /** 保存默认模型配置，并通知工作区退出初始化状态。 */
  async function handleFinish() {
    if (!modelApiKey.trim()) {
      setModelError("请输入 API Key。");
      return;
    }
    setSaving(true);
    setModelError("");

    try {
      // 通过 IPC 创建默认模型配置。
      const result = await window.myClawAPI.createModelProfile(createBrMiniMaxProfile({
        apiKey: modelApiKey.trim(),
      }));

      // 更新工作区状态，避免 AppShell 再次跳回初始化页。
      workspace.addModelAndClearSetup(result.profile);

      navigate("/", { replace: true });
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
          <h1>连接 BR MiniMax</h1>
          <p>首次使用默认接入企业私有部署的 BR MiniMax。系统已预置网关、模型和推荐参数，你只需填写 API Key。</p>
        </div>

        <div className="setup-step">
          <div className="step-content">
            <div className="model-form">
              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  value={modelApiKey}
                  onChange={(e) => setModelApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </label>

              <div className="managed-hint-card">
                <div><strong>模型类型：</strong>{DEFAULT_MODEL.name}</div>
                <div><strong>网关地址：</strong>{DEFAULT_MODEL.baseUrl}</div>
                <div><strong>模型 ID：</strong>{DEFAULT_MODEL.model}</div>
                <div><strong>模式：</strong>托管 thinking + tool use 优化</div>
              </div>
            </div>

            {modelError && <p className="error-msg">{modelError}</p>}
          </div>
        </div>

        <button className="continue-btn" onClick={handleFinish} disabled={saving}>
          {saving ? "正在保存..." : "完成配置，开始使用"}
        </button>
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

        /* 步骤内容区 */
        .setup-step {
          display: flex;
          gap: 16px;
        }

        .step-content {
          flex: 1;
          display: grid;
          gap: 14px;
        }

        /* 模型配置表单 */
        .model-form {
          display: grid;
          gap: 14px;
        }

        .managed-hint-card {
          display: grid;
          gap: 8px;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(15, 23, 42, 0.56);
          color: rgba(226, 232, 240, 0.86);
          font-size: 13px;
          line-height: 1.6;
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

        /* 操作按钮 */
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
        }

        .continue-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .continue-btn:not(:disabled):hover {
          opacity: 0.9;
        }
      `}</style>
    </main>
  );
}
