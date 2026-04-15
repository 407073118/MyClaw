import { Link, useLocation } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import { formatTokenCount, formatCapabilitySource } from "../utils/context-ui-helpers";
import { getModelVendorLabel } from "../utils/model-profile-display";
import { resolveModelCapability } from "../../main/services/model-capability-resolver";
import type { ProtocolTarget } from "@shared/contracts";

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

export default function ModelsPage() {
  const workspace = useWorkspaceStore();
  const models = workspace.models ?? [];
  const defaultModelProfileId = workspace.defaultModelProfileId;
  const location = useLocation();
  const notice = (location.state as { modelConfigNotice?: string } | null)?.modelConfigNotice ?? null;

  return (
    <main className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Model Profiles</span>
          <h2 className="page-title">Provider configuration</h2>
          <p className="page-subtitle">
            Store model name, URL, and token settings separately from chat and runtime modules.
          </p>
        </div>
        <Link to="/settings/models/new" className="btn-premium accent">
          + 新增模型
        </Link>
      </header>

      <div className="models-content">
        {notice && (
          <section className="notice-banner">
            {notice}
          </section>
        )}
        {models.length === 0 ? (
          <section className="card">
            <p>This is where you manage your model connections.</p>
          </section>
        ) : (
          <section className="models-list">
            {models.map((model) => (
              <Link
                key={model.id}
                to={`/settings/models/${model.id}`}
                className="model-row"
              >
                <div className="model-row-left">
                  <span className="model-name">{model.name}</span>
                  <span className="model-meta">{model.model || "—"}</span>
                </div>
                <div className="model-row-right">
                  {(() => {
                    const resolved = resolveModelCapability(model);
                    const ctxWindow = resolved.effective.contextWindowTokens;
                    return ctxWindow ? (
                      <span className="ctx-badge" title={`上下文窗口: ${ctxWindow?.toLocaleString()} tokens\n来源: ${formatCapabilitySource(resolved.effective.source)}`}>
                        {formatTokenCount(ctxWindow)}
                      </span>
                    ) : null;
                  })()}
                  {model.id === defaultModelProfileId && (
                    <span className="default-badge">default</span>
                  )}
                  {formatProtocolTargetLabel(model.protocolTarget) && (
                    <span className="route-badge">{formatProtocolTargetLabel(model.protocolTarget)}</span>
                  )}
                  {formatProtocolSelectionSourceLabel(model.protocolSelectionSource) && (
                    <span className="route-source-badge">{formatProtocolSelectionSourceLabel(model.protocolSelectionSource)}</span>
                  )}
                  {(() => {
                    const resolved = resolveModelCapability(model);
                    return resolved.effective.source ? (
                      <span className="source-badge">{formatCapabilitySource(resolved.effective.source)}</span>
                    ) : null;
                  })()}
                  <span className="provider-badge">{getModelVendorLabel(model)}</span>
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>

      <style>{`
        .page-container {
          height: 100%;
          overflow-y: auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 28px;
        }

        .eyebrow {
          display: inline-block;
          margin-bottom: 8px;
          color: var(--accent-cyan, #67e8f9);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .page-title {
          margin: 0;
          color: var(--text-primary, #fff);
          font-size: 28px;
        }

        .page-subtitle {
          margin: 10px 0 0;
          max-width: 620px;
          color: var(--text-secondary, #b0b0b8);
          line-height: 1.7;
        }

        .models-content { width: 100%; }

        .card {
          padding: 32px;
          border-radius: var(--radius-lg);
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          max-width: 860px;
        }

        .card p {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }

        .notice-banner {
          margin-bottom: 16px;
          max-width: 860px;
          padding: 12px 14px;
          border-radius: var(--radius-md, 10px);
          border: 1px solid #10a37f44;
          background: #10a37f14;
          color: #86efac;
          font-size: 13px;
        }

        .models-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 860px;
        }

        .model-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-radius: var(--radius-md, 10px);
          border: 1px solid var(--glass-border);
          background: var(--bg-card);
          text-decoration: none;
          transition: border-color 0.2s, background 0.2s;
          gap: 12px;
        }

        .model-row:hover {
          border-color: var(--accent-cyan, #67e8f9);
          background: color-mix(in srgb, var(--bg-card) 90%, var(--accent-cyan) 10%);
        }

        .model-row-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .model-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary, #fff);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .model-meta {
          font-size: 12px;
          color: var(--text-muted, #71717a);
          font-family: monospace;
        }

        .model-row-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .default-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--accent-cyan, #67e8f9);
          color: var(--accent-cyan, #67e8f9);
        }

        .provider-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--glass-border);
          color: var(--text-secondary, #a1a1aa);
        }

        .route-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #10a37f44;
          color: #34d399;
          background: #10a37f12;
        }

        .route-source-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #f59e0b44;
          color: #fbbf24;
          background: #f59e0b12;
        }

        .source-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #60a5fa33;
          color: #93c5fd;
          background: #1d4ed812;
        }

        .ctx-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #3b82f633;
          color: #60a5fa;
          font-family: monospace;
          cursor: help;
        }
      `}</style>
    </main>
  );
}
