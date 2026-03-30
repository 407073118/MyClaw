<template>
  <section data-testid="workflow-checkpoint-timeline" class="timeline">
    <header class="timeline-header">
      <h4>Checkpoint Timeline</h4>
      <span class="count">{{ checkpoints.length }} events</span>
    </header>

    <p v-if="checkpoints.length === 0" class="empty">No checkpoints yet.</p>

    <ol v-else class="items">
      <li v-for="checkpoint in orderedCheckpoints" :key="checkpoint.id" class="item">
        <div class="item-top">
          <span class="status">{{ checkpoint.status }}</span>
          <strong>{{ resolveNodeLabel(checkpoint.nodeId) }}</strong>
          <time>{{ checkpoint.createdAt }}</time>
        </div>
        <p v-if="checkpoint.error" class="error">{{ checkpoint.error }}</p>
        <p v-if="checkpoint.retryAt" class="meta">Retry at {{ checkpoint.retryAt }}</p>
        <pre v-if="hasState(checkpoint.state)" class="state">{{ formatValue(checkpoint.state) }}</pre>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { computed } from "vue";

import type { WorkflowRunCheckpoint } from "@/services/runtime-client";

const props = defineProps<{
  checkpoints: WorkflowRunCheckpoint[];
  definition: WorkflowDefinition;
}>();

const nodeLabels = computed(() => new Map(props.definition.nodes.map((node) => [node.id, node.label] as const)));
const orderedCheckpoints = computed(() => [...props.checkpoints].reverse());

function resolveNodeLabel(nodeId: string): string {
  return nodeLabels.value.get(nodeId) ?? nodeId;
}

function hasState(state: Record<string, unknown>): boolean {
  return Object.keys(state).length > 0;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
</script>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 15px;
}

.count,
.meta,
.empty,
time {
  color: var(--text-secondary);
  font-size: 12px;
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-top {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.status {
  border-radius: 999px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  color: var(--text-primary);
  font-size: 12px;
}

strong {
  color: var(--text-primary);
  font-size: 13px;
}

.error {
  margin: 0;
  color: #b83333;
  font-size: 12px;
}

.state {
  margin: 0;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-base) 88%, #0d1520);
  padding: 10px;
  color: var(--text-primary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
