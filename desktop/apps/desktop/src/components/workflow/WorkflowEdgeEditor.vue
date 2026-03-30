<template>
  <section class="edge-editor" data-testid="workflow-edge-editor">
    <h4 class="title">Edge</h4>
    <p class="meta">From {{ edge.fromNodeId }} to {{ edge.toNodeId }}</p>

    <label class="field">
      <span>Kind</span>
      <select data-testid="workflow-edge-editor-kind" :value="edge.kind" @change="handleKindChange">
        <option value="normal">normal</option>
        <option value="parallel">parallel</option>
        <option value="conditional">conditional</option>
      </select>
    </label>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowEdge, WorkflowEdgeKind } from "@myclaw-desktop/shared";

const props = defineProps<{
  edge: WorkflowEdge;
}>();

const emit = defineEmits<{
  (event: "update:edge", value: WorkflowEdge): void;
}>();

/** 更新 edge.kind，并保持 payload 结构合法。 */
function handleKindChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const value = target?.value as WorkflowEdgeKind | undefined;
  const kind = value === "parallel" || value === "conditional" ? value : "normal";

  if (kind === props.edge.kind) {
    return;
  }

  console.info("[workflow] 更新连线类型", { edgeId: props.edge.id, kind });

  if (kind === "conditional") {
    emit("update:edge", {
      id: props.edge.id,
      fromNodeId: props.edge.fromNodeId,
      toNodeId: props.edge.toNodeId,
      kind: "conditional",
      condition: {
        operator: "exists",
        leftPath: "$.state",
      },
    });
    return;
  }

  emit("update:edge", {
    id: props.edge.id,
    fromNodeId: props.edge.fromNodeId,
    toNodeId: props.edge.toNodeId,
    kind,
  } as WorkflowEdge);
}
</script>

<style scoped>
.edge-editor {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.meta {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
}

select {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 8px 10px;
  font: inherit;
}
</style>

