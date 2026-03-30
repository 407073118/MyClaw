<template>
  <form class="workflow-library-filters" @submit.prevent>
    <label class="field">
      <span class="label">搜索</span>
      <input
        :value="modelValue.query"
        data-testid="workflow-library-filter-query"
        type="search"
        placeholder="搜索工作流..."
        @input="handleQueryInput"
      />
    </label>

    <label class="field">
      <span class="label">状态</span>
      <select
        :value="modelValue.status"
        data-testid="workflow-library-filter-status"
        @change="handleStatusChange"
      >
        <option value="all">全部</option>
        <option value="draft">草稿</option>
        <option value="active">已启用</option>
        <option value="archived">已归档</option>
      </select>
    </label>

    <label class="field">
      <span class="label">排序</span>
      <select
        :value="modelValue.sort"
        data-testid="workflow-library-filter-sort"
        @change="handleSortChange"
      >
        <option value="updated-desc">最后修改</option>
        <option value="name-asc">名称</option>
        <option value="nodes-desc">节点数</option>
      </select>
    </label>
  </form>
</template>

<script setup lang="ts">
export type WorkflowLibraryFilterState = {
  query: string;
  status: "all" | "draft" | "active" | "archived";
  sort: "updated-desc" | "name-asc" | "nodes-desc";
};

const props = defineProps<{
  modelValue: WorkflowLibraryFilterState;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: WorkflowLibraryFilterState): void;
}>();

function handleQueryInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  emit("update:modelValue", {
    ...props.modelValue,
    query: target?.value ?? "",
  });
}

function handleStatusChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const value = target?.value;
  emit("update:modelValue", {
    ...props.modelValue,
    status: value === "draft" || value === "active" || value === "archived" ? value : "all",
  });
}

function handleSortChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const value = target?.value;
  emit("update:modelValue", {
    ...props.modelValue,
    sort: value === "name-asc" || value === "nodes-desc" ? value : "updated-desc",
  });
}
</script>

<style scoped>
.workflow-library-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px 160px;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.label {
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

input,
select {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  padding: 8px 10px;
  font: inherit;
}

@media (max-width: 900px) {
  .workflow-library-filters {
    grid-template-columns: 1fr;
  }
}
</style>

