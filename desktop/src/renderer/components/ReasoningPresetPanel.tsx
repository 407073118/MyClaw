import React from "react";

import type { ReasoningControlSpec } from "../utils/reasoning-controls";

export type ReasoningEffortLevel = "low" | "medium" | "high" | "xhigh";

const REASONING_PRESETS: Array<{
  level: ReasoningEffortLevel;
  label: string;
  title: string;
  description: string;
}> = [
  { level: "low", label: "快速", title: "快速回答", description: "低延迟响应，适合直接执行与简短确认。" },
  { level: "medium", label: "思考", title: "默认思考", description: "默认推理深度，平衡速度、成本与质量。" },
  { level: "high", label: "深度", title: "深度推理", description: "展开更多中间推理，适合复杂拆解和多步判断。" },
  { level: "xhigh", label: "极深", title: "极深推理（最大 thinking budget）", description: "拉满思考预算，优先处理高复杂度任务与难题。" },
];

const REASONING_KIND_BADGE: Record<ReasoningControlSpec["kind"], string> = {
  effort: "4 档推理",
  budget: "预算模式",
  boolean: "开关模式",
  always_on: "始终开启",
  unsupported: "不可调",
};

/** 把推理控制类型映射到规范的 .tag 变体颜色。 */
function badgeTagVariant(kind: ReasoningControlSpec["kind"]): "accent" | "green" | "muted" {
  switch (kind) {
    case "effort":
    case "budget":
      return "accent";
    case "always_on":
      return "green";
    case "boolean":
    case "unsupported":
    default:
      return "muted";
  }
}

type ReasoningPresetPanelProps = {
  spec: ReasoningControlSpec;
  enabled: boolean;
  effort: ReasoningEffortLevel;
  onEnabledChange: (enabled: boolean) => void;
  onEffortChange: (effort: ReasoningEffortLevel) => void;
  variant?: "full" | "compact";
  panelTestId?: string;
  effortTestId?: string;
};

/** 统一渲染硅基员工的推理控制面板，让创建页与工作台页保持同一套推理体验。 */
export default function ReasoningPresetPanel({
  spec,
  enabled,
  effort,
  onEnabledChange,
  onEffortChange,
  variant = "full",
  panelTestId,
  effortTestId,
}: ReasoningPresetPanelProps) {
  const compact = variant === "compact";

  return (
    <div className={`reasoning-panel${compact ? " reasoning-panel--compact" : ""}`} data-testid={panelTestId}>
      {!compact && (
        <div className="reasoning-panel__header">
          <div className="reasoning-panel__header-copy">
            <span className="reasoning-panel__eyebrow">{spec.title}</span>
            <p className="reasoning-panel__description">{spec.description}</p>
          </div>
          <span className={`tag tag--${badgeTagVariant(spec.kind)}`}>
            {REASONING_KIND_BADGE[spec.kind]}
          </span>
        </div>
      )}

      {!compact && spec.supportsToggle && (
        <div className="reasoning-panel__toggle" role="group" aria-label="thinking 开关">
          <button
            type="button"
            className={`reasoning-panel__toggle-btn${enabled ? " active" : ""}`}
            aria-pressed={enabled}
            onClick={() => onEnabledChange(true)}
          >
            开启 thinking
          </button>
          <button
            type="button"
            className={`reasoning-panel__toggle-btn${!enabled ? " active" : ""}`}
            aria-pressed={!enabled}
            onClick={() => onEnabledChange(false)}
          >
            关闭 thinking
          </button>
        </div>
      )}

      {!compact && spec.kind === "always_on" && (
        <div className="reasoning-panel__note reasoning-panel__note--success">
          当前模型始终开启 thinking，无需额外配置。
        </div>
      )}

      {!compact && spec.kind === "unsupported" && (
        <div className="reasoning-panel__note">
          当前模型不支持手动调节 thinking，系统会按普通回答处理。
        </div>
      )}

      {!compact && spec.supportsToggle && !enabled && spec.supportsEffort && (
        <div className="reasoning-panel__note">
          当前已关闭 thinking，重新开启后会按你选择的档位生效。
        </div>
      )}

      <div className="reasoning-panel__grid" data-testid={effortTestId}>
        {REASONING_PRESETS.map((preset) => (
          <button
            key={preset.level}
            type="button"
            aria-label={preset.label}
            title={preset.title}
            disabled={!spec.supportsEffort}
            className={`reasoning-panel__option${effort === preset.level ? " active" : ""}${!spec.supportsEffort ? " is-disabled" : ""}`}
            onClick={() => onEffortChange(preset.level)}
          >
            <span className="reasoning-panel__option-label">{preset.label}</span>
            {!compact && <span className="reasoning-panel__option-title">{preset.title}</span>}
            {!compact && <span className="reasoning-panel__option-description">{preset.description}</span>}
          </button>
        ))}
      </div>

      <style>{`
        .reasoning-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          border-radius: var(--radius-xl);
          border: 1px solid rgba(255, 255, 255, 0.08);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }

        .reasoning-panel--compact {
          padding: 0;
          border: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
        }

        .reasoning-panel__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .reasoning-panel__header-copy {
          min-width: 0;
        }

        .reasoning-panel__eyebrow {
          display: inline-flex;
          align-items: center;
          min-height: 22px;
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }

        .reasoning-panel__description {
          margin: 6px 0 0;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.6;
        }

        .reasoning-panel__toggle {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .reasoning-panel__toggle-btn,
        .reasoning-panel__option {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }

        .reasoning-panel__toggle-btn {
          min-height: 38px;
          padding: 0 14px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .reasoning-panel__toggle-btn:hover,
        .reasoning-panel__option:hover:not(:disabled) {
          border-color: var(--glass-border-hover);
          color: var(--text-primary);
        }

        .reasoning-panel__toggle-btn.active,
        .reasoning-panel__option.active {
          border-color: rgba(16, 163, 127, 0.3);
          background: rgba(16, 163, 127, 0.11);
          color: var(--accent-cyan);
        }

        .reasoning-panel__note {
          padding: 10px 12px;
          border-radius: var(--radius-md);
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.6;
        }

        .reasoning-panel__note--success {
          color: var(--status-green);
          border-color: rgba(34, 197, 94, 0.18);
          background: rgba(34, 197, 94, 0.08);
        }

        .reasoning-panel__grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .reasoning-panel--compact .reasoning-panel__grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }

        .reasoning-panel__option {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          min-height: 92px;
          padding: 12px 13px;
          border-radius: var(--radius-lg);
          text-align: left;
          cursor: pointer;
        }

        .reasoning-panel--compact .reasoning-panel__option {
          min-height: 36px;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          border-radius: var(--radius-md);
          text-align: center;
        }

        .reasoning-panel__option.is-disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .reasoning-panel__option-label {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        .reasoning-panel__option-title {
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 700;
          line-height: 1.4;
        }

        .reasoning-panel__option.active .reasoning-panel__option-title {
          color: rgba(218, 255, 244, 0.86);
        }

        .reasoning-panel__option-description {
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.55;
        }

        .reasoning-panel__option.active .reasoning-panel__option-description {
          color: rgba(226, 255, 247, 0.72);
        }

        @media (max-width: 760px) {
          .reasoning-panel__header {
            flex-direction: column;
          }

          .reasoning-panel__grid {
            grid-template-columns: 1fr;
          }

          .reasoning-panel--compact .reasoning-panel__grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
      `}</style>
    </div>
  );
}
