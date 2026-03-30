<template>
  <section class="schema-editor" data-testid="workflow-state-schema-editor">
    <header class="header">
      <h4 class="title">State Schema</h4>
      <button data-testid="workflow-state-schema-add-field" type="button" class="ghost" @click="handleAddField">
        Add field
      </button>
    </header>

    <p v-if="errorText" data-testid="workflow-state-schema-error" class="error">{{ errorText }}</p>

    <div v-for="(field, index) in modelValue" :key="field.key + ':' + index" class="row">
      <label class="field">
        <span>Key</span>
        <input
          :data-testid="`workflow-state-schema-key-${index}`"
          type="text"
          :value="field.key"
          @input="(e) => handleFieldPatch(index, { key: (e.target as HTMLInputElement | null)?.value ?? '' })"
        />
      </label>

      <label class="field">
        <span>Label</span>
        <input
          :data-testid="`workflow-state-schema-label-${index}`"
          type="text"
          :value="field.label"
          @input="(e) => handleFieldPatch(index, { label: (e.target as HTMLInputElement | null)?.value ?? '' })"
        />
      </label>

      <label class="field">
        <span>Description</span>
        <input
          :data-testid="`workflow-state-schema-description-${index}`"
          type="text"
          :value="field.description"
          @input="(e) => handleFieldPatch(index, { description: (e.target as HTMLInputElement | null)?.value ?? '' })"
        />
      </label>

      <label class="field">
        <span>Value type</span>
        <select
          :data-testid="`workflow-state-schema-valueType-${index}`"
          :value="field.valueType"
          @change="(e) => handleValueTypeChange(index, e)"
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="object">object</option>
          <option value="array">array</option>
          <option value="null">null</option>
          <option value="unknown">unknown</option>
        </select>
      </label>

      <label class="field">
        <span>Merge strategy</span>
        <select
          :data-testid="`workflow-state-schema-mergeStrategy-${index}`"
          :value="field.mergeStrategy"
          @change="(e) => handleMergeStrategyChange(index, e)"
        >
          <option value="replace">replace</option>
          <option value="append">append</option>
          <option value="union">union</option>
          <option value="object-merge">object-merge</option>
          <option value="custom">custom</option>
        </select>
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowMergeStrategy, WorkflowStateSchemaField, WorkflowStateValueType } from "@myclaw-desktop/shared";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  modelValue: WorkflowStateSchemaField[];
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: WorkflowStateSchemaField[]): void;
  (event: "validation", value: { errors: string[] }): void;
}>();

/** 创建默认字段，保证后续编辑结构稳定。 */
function createDefaultField(): WorkflowStateSchemaField {
  return {
    key: "",
    label: "",
    description: "",
    valueType: "string",
    mergeStrategy: "replace",
    required: false,
    producerNodeIds: [],
    consumerNodeIds: [],
  };
}

/** 校验 stateSchema（UI 层），用于禁用保存并提示用户。 */
function validateStateSchema(fields: WorkflowStateSchemaField[]): string[] {
  const errors: string[] = [];
  const keyCount = new Map<string, number>();

  for (const field of fields) {
    const key = field.key.trim();
    if (!key) {
      errors.push("key: required");
      continue;
    }
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);

    if (!field.label.trim()) {
      errors.push("label: required");
    }

    if (!field.description.trim()) {
      errors.push("description: required");
    }

    // 最小实现：object-merge 只能用于 object。
    if (field.mergeStrategy === "object-merge" && field.valueType !== "object") {
      errors.push("mergeStrategy: object-merge requires valueType=object");
    }
  }

  for (const [key, count] of keyCount.entries()) {
    if (count > 1) {
      errors.push(`key: duplicate "${key}"`);
    }
  }

  return errors;
}

const localErrors = ref<string[]>([]);
const errorText = computed(() => (localErrors.value.length ? localErrors.value.join("; ") : ""));

watch(
  () => props.modelValue,
  (next) => {
    localErrors.value = validateStateSchema(next);
    emit("validation", { errors: localErrors.value });
  },
  { immediate: true, deep: true },
);

/** 新增 schema field。 */
function handleAddField() {
  console.info("[workflow] 新增 state schema 字段");
  const next = [...props.modelValue, createDefaultField()];
  localErrors.value = validateStateSchema(next);
  emit("update:modelValue", next);
  emit("validation", { errors: localErrors.value });
}

/** 更新字段片段，避免整行重写。 */
function handleFieldPatch(index: number, patch: Partial<WorkflowStateSchemaField>) {
  const next = props.modelValue.map((field, idx) => (idx === index ? { ...field, ...patch } : field));
  console.info("[workflow] 更新 state schema 字段", { index, patch });
  localErrors.value = validateStateSchema(next);
  emit("update:modelValue", next);
  emit("validation", { errors: localErrors.value });
}

function handleValueTypeChange(index: number, event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const value = target?.value as WorkflowStateValueType | undefined;
  const nextValue: WorkflowStateValueType =
    value === "number" ||
    value === "boolean" ||
    value === "object" ||
    value === "array" ||
    value === "null" ||
    value === "unknown"
      ? value
      : "string";
  handleFieldPatch(index, { valueType: nextValue });
}

function handleMergeStrategyChange(index: number, event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const value = target?.value as WorkflowMergeStrategy | undefined;
  const nextValue: WorkflowMergeStrategy =
    value === "append" || value === "union" || value === "object-merge" || value === "custom" ? value : "replace";
  handleFieldPatch(index, { mergeStrategy: nextValue });
}
</script>

<style scoped>
.schema-editor {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.ghost {
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--bg-base) 86%, transparent);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}

.row {
  display: grid;
  grid-template-columns: 1.1fr 1.1fr 1.3fr 1fr 1fr;
  gap: 10px;
}

@media (max-width: 1100px) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
}

input,
select {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 8px 10px;
  font: inherit;
}

.error {
  margin: 0;
  color: #b83333;
}
</style>
