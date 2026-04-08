import React, { useState, useMemo } from "react";
import type { WorkflowInterruptPayload } from "@shared/contracts";
import { InterruptInputForm } from "./InterruptInputForm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowDebugPanelProps {
  runId: string;
  status: string;
  currentStep: number;
  state: Record<string, unknown>;
  events: Array<{ type: string; timestamp: number; [key: string]: unknown }>;
  interruptPayload?: WorkflowInterruptPayload;
  onResumeWithInput?: (value: unknown) => void;
  isResuming?: boolean;
}

type TabKey = "state" | "timeline" | "logs";

// ---------------------------------------------------------------------------
// Event type -> badge color mapping
// ---------------------------------------------------------------------------

const eventBadgeColors: Record<string, string> = {
  "run-start": "#3b82f6",
  "run-complete": "#10b981",
  "step-start": "#8b5cf6",
  "step-complete": "#a78bfa",
  "node-start": "#06b6d4",
  "node-streaming": "#14b8a6",
  "node-complete": "#22c55e",
  "node-error": "#ef4444",
  "state-updated": "#f59e0b",
  "interrupt-requested": "#ec4899",
  "interrupt-resumed": "#f97316",
  "checkpoint-saved": "#6366f1",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 将时间戳转为相对起始时间的秒数字符串，如 "+2.3s"。 */
function relativeTime(timestamp: number, origin: number): string {
  const delta = (timestamp - origin) / 1000;
  return `+${delta.toFixed(1)}s`;
}

/** 截断字符串至指定长度。 */
function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "..." : value;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** 工作流调试面板 -- 显示运行时状态、事件时间轴和原始日志。 */
export function WorkflowDebugPanel({
  runId,
  status,
  currentStep,
  state,
  events,
  interruptPayload,
  onResumeWithInput,
  isResuming,
}: WorkflowDebugPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("state");

  // Filter out internal state keys
  const visibleState = useMemo(() => {
    return Object.entries(state).filter(([key]) => !key.startsWith("__"));
  }, [state]);

  // Reverse chronological events for timeline
  const timelineEvents = useMemo(() => [...events].reverse(), [events]);

  // Origin timestamp for relative time display
  const originTs = useMemo(() => events[0]?.timestamp ?? Date.now(), [events]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "state", label: "状态" },
    { key: "timeline", label: "时间轴" },
    { key: "logs", label: "日志" },
  ];

  return (
    <div className="wf-debug-panel">
      {/* Panel header */}
      <div className="wf-debug-panel__header">
        <span className="wf-debug-panel__title">调试面板</span>
        <span className="wf-debug-panel__run-id" title={runId}>
          {runId.slice(0, 8)}
        </span>
        <span
          className="wf-debug-panel__status-pill"
          data-status={status}
        >
          {status}
        </span>
        <span className="wf-debug-panel__step">步骤 {currentStep}</span>
      </div>

      {/* Interrupt form */}
      {interruptPayload && onResumeWithInput && (
        <div className="wf-debug-panel__interrupt">
          <InterruptInputForm
            payload={interruptPayload}
            onSubmit={onResumeWithInput}
            isSubmitting={isResuming}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="wf-debug-panel__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`wf-debug-panel__tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="wf-debug-panel__body">
        {/* ── State tab ─────────────────────────────────────── */}
        {activeTab === "state" && (
          <div className="wf-debug-panel__state-list">
            {visibleState.length === 0 ? (
              <div className="wf-debug-panel__empty">暂无状态数据</div>
            ) : (
              visibleState.map(([key, value]) => (
                <StateEntry key={key} stateKey={key} value={value} />
              ))
            )}
          </div>
        )}

        {/* ── Timeline tab ──────────────────────────────────── */}
        {activeTab === "timeline" && (
          <div className="wf-debug-panel__timeline">
            {timelineEvents.length === 0 ? (
              <div className="wf-debug-panel__empty">暂无事件</div>
            ) : (
              timelineEvents.map((evt, idx) => (
                <div key={idx} className="wf-debug-panel__tl-row">
                  <span
                    className="wf-debug-panel__tl-badge"
                    style={{ background: eventBadgeColors[evt.type] ?? "#52525b" }}
                  >
                    {evt.type}
                  </span>
                  <span className="wf-debug-panel__tl-time">
                    {relativeTime(evt.timestamp, originTs)}
                  </span>
                  {typeof evt.nodeId === "string" && (
                    <span className="wf-debug-panel__tl-node" title={evt.nodeId}>
                      {evt.nodeId.slice(0, 12)}
                    </span>
                  )}
                  {typeof evt.error === "string" && (
                    <span className="wf-debug-panel__tl-error">
                      {truncate(evt.error, 60)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Logs tab ──────────────────────────────────────── */}
        {activeTab === "logs" && (
          <div className="wf-debug-panel__logs">
            {events.length === 0 ? (
              <div className="wf-debug-panel__empty">暂无日志</div>
            ) : (
              events.map((evt, idx) => (
                <div key={idx} className="wf-debug-panel__log-row">
                  <span className="wf-debug-panel__log-type">[{evt.type}]</span>
                  <pre className="wf-debug-panel__log-json">
                    {JSON.stringify(evt, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <style>{`
        .wf-debug-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          font-size: 12px;
          color: #a1a1aa;
        }

        .wf-debug-panel__header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid #27272a;
          flex-shrink: 0;
        }

        .wf-debug-panel__title {
          font-weight: 700;
          font-size: 13px;
          color: #f4f4f5;
        }

        .wf-debug-panel__run-id {
          font-family: monospace;
          font-size: 11px;
          color: #52525b;
        }

        .wf-debug-panel__status-pill {
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          background: #27272a;
          color: #a1a1aa;
        }
        .wf-debug-panel__status-pill[data-status="running"] {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
        }
        .wf-debug-panel__status-pill[data-status="waiting-input"] {
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
        }
        .wf-debug-panel__status-pill[data-status="succeeded"] {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
        }
        .wf-debug-panel__status-pill[data-status="failed"],
        .wf-debug-panel__status-pill[data-status="error"] {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
        }

        .wf-debug-panel__step {
          margin-left: auto;
          font-size: 11px;
          color: #71717a;
        }

        .wf-debug-panel__interrupt {
          padding: 8px 12px;
          border-bottom: 1px solid #27272a;
          flex-shrink: 0;
        }

        .wf-debug-panel__tabs {
          display: flex;
          border-bottom: 1px solid #27272a;
          flex-shrink: 0;
        }

        .wf-debug-panel__tab {
          flex: 1;
          padding: 6px 0;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: #71717a;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .wf-debug-panel__tab:hover { color: #a1a1aa; }
        .wf-debug-panel__tab.active {
          color: #f4f4f5;
          border-bottom-color: #3b82f6;
        }

        .wf-debug-panel__body {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }

        .wf-debug-panel__empty {
          padding: 24px;
          text-align: center;
          color: #52525b;
        }

        /* ── State tab ──────────────────────────────── */
        .wf-debug-panel__state-list {
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* ── Timeline tab ───────────────────────────── */
        .wf-debug-panel__timeline {
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .wf-debug-panel__tl-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 0;
          border-bottom: 1px solid #1c1c1f;
          flex-wrap: wrap;
        }

        .wf-debug-panel__tl-badge {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
        }

        .wf-debug-panel__tl-time {
          font-family: monospace;
          font-size: 11px;
          color: #52525b;
          min-width: 52px;
        }

        .wf-debug-panel__tl-node {
          font-family: monospace;
          font-size: 11px;
          color: #71717a;
        }

        .wf-debug-panel__tl-error {
          font-size: 11px;
          color: #f87171;
          word-break: break-all;
        }

        /* ── Logs tab ───────────────────────────────── */
        .wf-debug-panel__logs {
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .wf-debug-panel__log-row {
          border-bottom: 1px solid #1c1c1f;
          padding: 4px 0;
        }

        .wf-debug-panel__log-type {
          font-family: monospace;
          font-size: 11px;
          font-weight: 600;
          color: #71717a;
        }

        .wf-debug-panel__log-json {
          margin: 4px 0 0;
          padding: 6px 8px;
          background: #0d0d0f;
          border-radius: 4px;
          font-size: 10px;
          color: #a1a1aa;
          overflow-x: auto;
          max-height: 120px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State entry sub-component
// ---------------------------------------------------------------------------

function StateEntry({ stateKey, value }: { stateKey: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false);

  const isString = typeof value === "string";
  const isLongString = isString && value.length > 100;
  const isObject = typeof value === "object" && value !== null;
  const displayValue = isString
    ? (isLongString && !expanded ? truncate(value, 100) : value)
    : JSON.stringify(value, null, 2);

  return (
    <div style={{
      borderBottom: "1px solid #1c1c1f",
      paddingBottom: "6px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "#71717a", fontWeight: 600, fontSize: "11px", minWidth: "80px" }}>
          {stateKey}
        </span>
        {isLongString && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "transparent", border: "none", color: "#3b82f6",
              fontSize: "10px", cursor: "pointer", padding: 0,
            }}
          >
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>
      {isObject ? (
        <pre style={{
          margin: "4px 0 0", padding: "6px 8px", background: "#0d0d0f",
          borderRadius: "4px", fontSize: "10px", color: "#a1a1aa",
          overflow: "auto", maxHeight: "100px", whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}>
          {displayValue}
        </pre>
      ) : (
        <div style={{ fontSize: "12px", color: "#d4d4d8", marginTop: "2px", wordBreak: "break-all" }}>
          {displayValue}
        </div>
      )}
    </div>
  );
}
