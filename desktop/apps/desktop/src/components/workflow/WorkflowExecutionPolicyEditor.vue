<template>
  <section class="policy-editor" data-testid="workflow-execution-policy-editor">
    <label class="field">
      <span>Timeout (ms)</span>
      <input
        data-testid="workflow-node-editor-timeout-ms"
        type="number"
        inputmode="numeric"
        min="0"
        :value="timeoutMsValue"
        @input="handleTimeoutInput"
      />
    </label>

    <div class="retry-row">
      <label class="field">
        <span>Retry max attempts</span>
        <input
          data-testid="workflow-node-editor-retry-max-attempts"
          type="number"
          inputmode="numeric"
          min="1"
          :value="retryMaxAttemptsValue"
          @input="handleRetryMaxAttemptsInput"
        />
      </label>
      <label class="field">
        <span>Retry backoff (ms)</span>
        <input
          data-testid="workflow-node-editor-retry-backoff-ms"
          type="number"
          inputmode="numeric"
          min="0"
          :value="retryBackoffMsValue"
          @input="handleRetryBackoffMsInput"
        />
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowNodePolicy } from "@myclaw-desktop/shared";
import { computed } from "vue";

const props = defineProps<{
  policy?: WorkflowNodePolicy;
}>();

const emit = defineEmits<{
  (event: "update:policy", value: WorkflowNodePolicy | undefined): void;
}>();

/** 解析非负整数输入，避免 NaN 写入 definition。 */
function parseNumberInput(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
}

/** 仅保留 runtime validator 接受的 retry 结构。 */
function sanitizeRetryConfig(
  retry: WorkflowNodePolicy["retry"] | undefined,
): WorkflowNodePolicy["retry"] | undefined {
  if (!retry) {
    return undefined;
  }
  if (!Number.isFinite(retry.maxAttempts) || retry.maxAttempts < 1) {
    return undefined;
  }
  if (!Number.isFinite(retry.backoffMs) || retry.backoffMs < 0) {
    return undefined;
  }
  return {
    maxAttempts: Math.round(retry.maxAttempts),
    backoffMs: Math.round(retry.backoffMs),
  };
}

const timeoutMsValue = computed(() => props.policy?.timeoutMs ?? "");
const retryMaxAttemptsValue = computed(() => props.policy?.retry?.maxAttempts ?? "");
const retryBackoffMsValue = computed(() => props.policy?.retry?.backoffMs ?? "");

/** 更新 timeout 配置并向上同步。 */
function handleTimeoutInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const next = parseNumberInput(target?.value ?? "");
  const current = props.policy ?? {};
  const updated: WorkflowNodePolicy = { ...current };
  if (next === null) {
    delete updated.timeoutMs;
  } else {
    updated.timeoutMs = next;
  }
  console.info("[workflow] 更新节点 timeout 策略", { timeoutMs: updated.timeoutMs ?? null });
  emit("update:policy", Object.keys(updated).length ? updated : undefined);
}

/** 更新 retry.maxAttempts，并保证不会组装出无效 retry。 */
function handleRetryMaxAttemptsInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const next = parseNumberInput(target?.value ?? "");
  const current = props.policy ?? {};
  const updated: WorkflowNodePolicy = { ...current };
  if (next === null || next < 1) {
    delete updated.retry;
  } else {
    updated.retry = { maxAttempts: next, backoffMs: updated.retry?.backoffMs ?? 0 };
  }
  updated.retry = sanitizeRetryConfig(updated.retry);
  console.info("[workflow] 更新节点 retry.maxAttempts 策略", { retry: updated.retry ?? null });
  emit("update:policy", Object.keys(updated).length ? updated : undefined);
}

/** 更新 retry.backoffMs，并在 maxAttempts 无效时移除 retry。 */
function handleRetryBackoffMsInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const next = parseNumberInput(target?.value ?? "");
  const current = props.policy ?? {};
  const updated: WorkflowNodePolicy = { ...current };
  if (next === null) {
    delete updated.retry;
  } else {
    updated.retry = { maxAttempts: updated.retry?.maxAttempts ?? 0, backoffMs: next };
  }
  updated.retry = sanitizeRetryConfig(updated.retry);
  console.info("[workflow] 更新节点 retry.backoffMs 策略", { retry: updated.retry ?? null });
  emit("update:policy", Object.keys(updated).length ? updated : undefined);
}
</script>

<style scoped>
.policy-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.retry-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
}

input {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 8px 10px;
  font: inherit;
}
</style>
