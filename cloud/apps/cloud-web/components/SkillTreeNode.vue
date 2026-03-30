<script setup lang="ts">
import type { SkillTreeNode } from "~/types/skills";

const props = defineProps<{
  node: SkillTreeNode;
  activePath: string;
  depth?: number;
}>();

const emit = defineEmits<{
  select: [path: string];
}>();

const depth = computed(() => props.depth ?? 0);
const isActive = computed(() => props.node.type === "file" && props.activePath === props.node.path);
const isAncestor = computed(
  () => props.node.type === "directory" && props.activePath.startsWith(`${props.node.path}/`)
);
const expanded = ref(depth.value < 1 || isAncestor.value);

watch(
  () => props.activePath,
  () => {
    if (isAncestor.value) {
      expanded.value = true;
    }
  }
);

function handleToggle() {
  if (props.node.type === "file") {
    emit("select", props.node.path);
    return;
  }

  expanded.value = !expanded.value;
}
</script>

<template>
  <div class="tree-node" :class="{ 'tree-node--file': node.type === 'file' }">
    <button
      type="button"
      class="tree-node__button"
      :class="{
        'tree-node__button--active': isActive,
        'tree-node__button--directory': node.type === 'directory'
      }"
      @click="handleToggle"
    >
      <span class="tree-node__caret" aria-hidden="true">
        {{ node.type === "directory" ? (expanded ? "v" : ">") : "." }}
      </span>
      <span class="tree-node__label">{{ node.name }}</span>
    </button>

    <div v-if="node.type === 'directory' && expanded" class="tree-node__children">
      <SkillTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
