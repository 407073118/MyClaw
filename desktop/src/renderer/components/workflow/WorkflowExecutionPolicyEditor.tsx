import React from "react";
import type { WorkflowNodePolicy } from "@shared/contracts";

interface WorkflowExecutionPolicyEditorProps {
  policy?: WorkflowNodePolicy;
  onUpdatePolicy: (value: WorkflowNodePolicy | undefined) => void;
}

export default function WorkflowExecutionPolicyEditor({ policy, onUpdatePolicy }: WorkflowExecutionPolicyEditorProps) {
  const timeoutMsValue = policy?.timeoutMs ?? "";
  const retryMaxAttemptsValue = policy?.retry?.maxAttempts ?? "";
  const retryBackoffMsValue = policy?.retry?.backoffMs ?? "";

  /** 解析非负整数输入，避免 NaN 写入 definition。 */
  function parseNumberInput(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed);
  }

  /** 仅保留 runtime validator 接受的 retry 结构。 */
  function sanitizeRetryConfig(
    retry: WorkflowNodePolicy["retry"] | undefined,
  ): WorkflowNodePolicy["retry"] | undefined {
    if (!retry) return undefined;
    if (!Number.isFinite(retry.maxAttempts) || retry.maxAttempts < 1) return undefined;
    if (!Number.isFinite(retry.backoffMs) || retry.backoffMs < 0) return undefined;
    return {
      maxAttempts: Math.round(retry.maxAttempts),
      backoffMs: Math.round(retry.backoffMs),
    };
  }

  /** 更新 timeout 配置并向上同步。 */
  function handleTimeoutInput(event: React.ChangeEvent<HTMLInputElement>) {
    const next = parseNumberInput(event.target.value);
    const current = policy ?? {};
    const updated: WorkflowNodePolicy = { ...current };
    if (next === null) {
      delete updated.timeoutMs;
    } else {
      updated.timeoutMs = next;
    }
    console.info("[workflow] 更新节点 timeout 策略", { timeoutMs: updated.timeoutMs ?? null });
    onUpdatePolicy(Object.keys(updated).length ? updated : undefined);
  }

  /** 更新 retry.maxAttempts，并保证不会组装出无效 retry。 */
  function handleRetryMaxAttemptsInput(event: React.ChangeEvent<HTMLInputElement>) {
    const next = parseNumberInput(event.target.value);
    const current = policy ?? {};
    const updated: WorkflowNodePolicy = { ...current };
    if (next === null || next < 1) {
      delete updated.retry;
    } else {
      updated.retry = { maxAttempts: next, backoffMs: updated.retry?.backoffMs ?? 0 };
    }
    updated.retry = sanitizeRetryConfig(updated.retry);
    console.info("[workflow] 更新节点 retry.maxAttempts 策略", { retry: updated.retry ?? null });
    onUpdatePolicy(Object.keys(updated).length ? updated : undefined);
  }

  /** 更新 retry.backoffMs，并在 maxAttempts 无效时移除 retry。 */
  function handleRetryBackoffMsInput(event: React.ChangeEvent<HTMLInputElement>) {
    const next = parseNumberInput(event.target.value);
    const current = policy ?? {};
    const updated: WorkflowNodePolicy = { ...current };
    if (next === null) {
      delete updated.retry;
    } else {
      updated.retry = { maxAttempts: updated.retry?.maxAttempts ?? 0, backoffMs: next };
    }
    updated.retry = sanitizeRetryConfig(updated.retry);
    console.info("[workflow] 更新节点 retry.backoffMs 策略", { retry: updated.retry ?? null });
    onUpdatePolicy(Object.keys(updated).length ? updated : undefined);
  }

  return (
    <section className="policy-editor" data-testid="workflow-execution-policy-editor">
      <label className="field">
        <span>Timeout (ms)</span>
        <input
          data-testid="workflow-node-editor-timeout-ms"
          type="number"
          inputMode="numeric"
          min={0}
          value={timeoutMsValue}
          onChange={handleTimeoutInput}
        />
      </label>

      <div className="retry-row">
        <label className="field">
          <span>Retry max attempts</span>
          <input
            data-testid="workflow-node-editor-retry-max-attempts"
            type="number"
            inputMode="numeric"
            min={1}
            value={retryMaxAttemptsValue}
            onChange={handleRetryMaxAttemptsInput}
          />
        </label>
        <label className="field">
          <span>Retry backoff (ms)</span>
          <input
            data-testid="workflow-node-editor-retry-backoff-ms"
            type="number"
            inputMode="numeric"
            min={0}
            value={retryBackoffMsValue}
            onChange={handleRetryBackoffMsInput}
          />
        </label>
      </div>

      <style>{`
        .policy-editor {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .policy-editor .retry-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .policy-editor .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--text-secondary);
        }
        .policy-editor input {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 8px 10px;
          font: inherit;
        }
      `}</style>
    </section>
  );
}
