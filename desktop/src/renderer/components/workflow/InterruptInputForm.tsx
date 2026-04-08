import React, { useState } from "react";
import type { WorkflowInterruptPayload } from "@shared/contracts";

interface InterruptInputFormProps {
  payload: WorkflowInterruptPayload;
  onSubmit: (value: unknown) => void;
  isSubmitting?: boolean;
}

/** 工作流中断输入表单 -- 在 waiting-input 状态下渲染，供用户提供输入或审批。 */
export function InterruptInputForm({ payload, onSubmit, isSubmitting }: InterruptInputFormProps) {
  const [input, setInput] = useState("");

  return (
    <div style={{
      padding: "16px",
      background: "var(--color-surface, #1e1e2e)",
      border: "1px solid var(--color-warning, #f59e0b)",
      borderRadius: "8px",
      marginTop: "8px",
    }}>
      {/* Header */}
      <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--color-warning, #f59e0b)" }}>
        需要您的输入
      </div>

      {/* Prompt */}
      <div style={{ marginBottom: "12px", fontSize: "13px", color: "var(--color-text-secondary, #a0a0a0)" }}>
        {payload.prompt}
      </div>

      {/* Input type: approval vs free input */}
      {payload.type === "approval" ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => onSubmit("rejected")}
            disabled={isSubmitting}
            style={{
              padding: "6px 16px", borderRadius: "6px", border: "1px solid #ef4444",
              background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: "13px",
            }}
          >
            拒绝
          </button>
          <button
            onClick={() => onSubmit("approved")}
            disabled={isSubmitting}
            style={{
              padding: "6px 16px", borderRadius: "6px", border: "none",
              background: "#22c55e", color: "#fff", cursor: "pointer", fontSize: "13px",
            }}
          >
            批准
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="请输入..."
            rows={3}
            style={{
              width: "100%", padding: "8px", borderRadius: "6px",
              border: "1px solid var(--color-border, #333)",
              background: "var(--color-bg, #111)", color: "var(--color-text, #eee)",
              fontSize: "13px", resize: "vertical", marginBottom: "8px",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => { onSubmit(input); setInput(""); }}
            disabled={!input.trim() || isSubmitting}
            style={{
              padding: "6px 16px", borderRadius: "6px", border: "none",
              background: input.trim() ? "#3b82f6" : "#555",
              color: "#fff", cursor: input.trim() ? "pointer" : "not-allowed", fontSize: "13px",
            }}
          >
            {isSubmitting ? "提交中..." : "提交"}
          </button>
        </>
      )}

      {/* Current state preview (collapsible) */}
      {payload.currentState && Object.keys(payload.currentState).length > 0 && (
        <details style={{ marginTop: "12px", fontSize: "12px" }}>
          <summary style={{ cursor: "pointer", color: "var(--color-text-secondary, #888)" }}>
            当前状态
          </summary>
          <pre style={{
            marginTop: "4px", padding: "8px", borderRadius: "4px",
            background: "var(--color-bg, #111)", overflow: "auto", maxHeight: "120px",
            fontSize: "11px", color: "var(--color-text-secondary, #aaa)",
          }}>
            {JSON.stringify(payload.currentState, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
