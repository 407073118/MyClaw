<template>
  <article
    v-if="directoryTree"
    :data-testid="`tool-directory-tree-${messageId}`"
    class="tool-directory-tree"
  >
    <header class="tool-directory-root">
      <strong>{{ directoryTree.root }}</strong>
      <span>{{ directoryTree.entries.length }} items</span>
    </header>

    <ul class="tool-directory-entries">
      <li
        v-for="entry in directoryTree.entries"
        :key="`${entry.kind}-${entry.name}-${entry.modifiedAt}`"
        class="tool-directory-entry"
      >
        <span class="tool-directory-kind">{{ entry.kind }}</span>
        <span class="tool-directory-name">{{ entry.name }}</span>
        <span v-if="entry.size" class="tool-directory-meta">{{ entry.size }} B</span>
        <span class="tool-directory-meta">{{ entry.modifiedAt }}</span>
      </li>
    </ul>
  </article>

  <span v-else class="tool-log-text">{{ content }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { parsePowerShellDirectoryTree } from "@/utils/tool-output";

const props = defineProps<{
  content: string;
  messageId: string;
}>();

const directoryTree = computed(() => parsePowerShellDirectoryTree(props.content));
</script>

<style scoped>
.tool-log-text {
  word-break: break-all;
}

.tool-directory-tree {
  width: 100%;
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background:
    linear-gradient(135deg, rgba(14, 116, 144, 0.12), rgba(15, 23, 42, 0.08)),
    rgba(15, 23, 42, 0.18);
}

.tool-directory-root {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}

.tool-directory-root strong {
  color: var(--text-primary);
  font-size: 13px;
}

.tool-directory-root span,
.tool-directory-meta {
  color: var(--text-muted);
  font-size: 11px;
}

.tool-directory-entries {
  list-style: none;
  margin: 0;
  padding: 0 0 0 14px;
  display: grid;
  gap: 8px;
  border-left: 1px solid rgba(148, 163, 184, 0.25);
}

.tool-directory-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  position: relative;
  min-height: 22px;
}

.tool-directory-entry::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 10px;
  width: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
}

.tool-directory-kind {
  min-width: 34px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.45);
  color: #cbd5e1;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
}

.tool-directory-name {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-word;
}
</style>
