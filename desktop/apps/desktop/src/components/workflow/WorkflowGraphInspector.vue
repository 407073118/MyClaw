<template>
  <section data-testid="workflow-graph-inspector" class="inspector">
    <header class="inspector-header">
      <div>
        <h3 class="title">工作流图检查器</h3>
        <p class="subtitle">结构化编辑：节点、连线、状态 Schema、策略</p>
      </div>
      <div class="actions">
        <span v-if="graphErrorText" data-testid="workflow-graph-inspector-graph-error" class="error">
          {{ graphErrorText }}
        </span>
        <span v-if="saveError" class="error">{{ saveError }}</span>
        <button
          data-testid="workflow-graph-inspector-save"
          type="button"
          class="primary"
          :disabled="!canSave"
          @click="handleSave"
        >
          保存图定义
        </button>
      </div>
    </header>

    <section class="grid" :class="{ 'grid--single': !showGraphList }">
      <section v-if="showGraphList" class="panel">
        <h4 class="panel-title">节点列表</h4>
        <ul class="list">
          <li v-for="node in draft.nodes" :key="node.id">
            <button
              type="button"
              class="row"
              :data-testid="`workflow-graph-node-row-${node.id}`"
              :data-active="node.id === selectedNodeId ? 'true' : 'false'"
              @click="selectNode(node.id)"
            >
              <strong :data-testid="`workflow-graph-node-label-${node.id}`">{{ node.label }}</strong>
              <span class="muted">{{ node.kind }}</span>
            </button>
          </li>
        </ul>

        <h4 class="panel-title">连线列表</h4>
        <ul class="list">
          <li v-for="edge in draft.edges" :key="edge.id">
            <button
              type="button"
              class="row"
              :data-testid="`workflow-graph-edge-row-${edge.id}`"
              :data-active="edge.id === selectedEdgeId ? 'true' : 'false'"
              @click="selectEdge(edge.id)"
            >
              <span class="edge-label">{{ edge.fromNodeId }} → {{ edge.toNodeId }}</span>
              <span :data-testid="`workflow-graph-edge-kind-${edge.id}`" class="muted">{{ edge.kind }}</span>
            </button>
          </li>
        </ul>
      </section>

      <section class="panel">
        <h4 class="panel-title">配置编辑器</h4>
        <WorkflowNodeEditor
          v-if="selectedNode"
          :node="selectedNode"
          :upstream-candidate-node-ids="joinUpstreamCandidates"
          :route-candidate-node-ids="conditionRouteCandidates"
          :tool-candidate-options="toolCandidateOptions"
          :workflow-candidate-options="workflowCandidateOptions"
          :state-field-key-options="stateFieldKeyOptions"
          @update:node="handleNodeUpdate"
        />
        <WorkflowEdgeEditor v-else-if="selectedEdge" :edge="selectedEdge" @update:edge="handleEdgeUpdate" />
        <p v-else class="placeholder">请在左侧侧栏或画布中选择一个节点或连线开始编辑。</p>

        <WorkflowStateSchemaEditor
          class="schema"
          :model-value="draft.stateSchema"
          @update:modelValue="handleStateSchemaUpdate"
          @validation="handleSchemaValidation"
        />
      </section>
    </section>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@myclaw-desktop/shared";
import { computed, reactive, ref, watch } from "vue";

import WorkflowEdgeEditor from "@/components/workflow/WorkflowEdgeEditor.vue";
import WorkflowNodeEditor from "@/components/workflow/WorkflowNodeEditor.vue";
import WorkflowStateSchemaEditor from "@/components/workflow/WorkflowStateSchemaEditor.vue";
import { useWorkspaceStore } from "@/stores/workspace";

const props = withDefaults(defineProps<{
  workflowId: string;
  definition: WorkflowDefinition;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  showGraphList?: boolean;
}>(), {
  selectedNodeId: null,
  selectedEdgeId: null,
  showGraphList: true,
});

const workspace = useWorkspaceStore();
const selectedNodeId = ref<string | null>(null);
const selectedEdgeId = ref<string | null>(null);
const isSaving = ref(false);
const saveError = ref("");
const schemaErrors = ref<string[]>([]);

function cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
}

const draft = reactive<WorkflowDefinition>(cloneDefinition(props.definition));

watch(
  () => props.definition,
  (next) => {
    // 外部刷新 definition 时同步本地草稿。最小实现：直接覆盖。
    const cloned = cloneDefinition(next);
    Object.assign(draft, cloned);
    console.info("[workflow] 同步 workflow definition 草稿", { workflowId: props.workflowId });
  },
  { immediate: true, deep: true },
);

const selectedNode = computed<WorkflowNode | null>(() => {
  if (!selectedNodeId.value) return null;
  return draft.nodes.find((node) => node.id === selectedNodeId.value) ?? null;
});

const selectedEdge = computed<WorkflowEdge | null>(() => {
  if (!selectedEdgeId.value) return null;
  return draft.edges.find((edge) => edge.id === selectedEdgeId.value) ?? null;
});

type WorkflowEditorOption = {
  value: string;
  label: string;
  hint?: string;
};

const joinUpstreamCandidates = computed<string[]>(() => {
  if (!selectedNode.value || selectedNode.value.kind !== "join") {
    return [];
  }
  const incoming = draft.edges.filter((edge) => edge.toNodeId === selectedNode.value?.id);
  const ids = incoming.map((edge) => edge.fromNodeId);
  return Array.from(new Set(ids));
});

const conditionRouteCandidates = computed<string[]>(() => {
  if (!selectedNode.value || selectedNode.value.kind !== "condition") {
    return [];
  }
  return draft.nodes
    .filter((node) => node.id !== selectedNode.value?.id)
    .map((node) => node.id);
});

const toolCandidateOptions = computed<WorkflowEditorOption[]>(() => {
  const optionMap = new Map<string, WorkflowEditorOption>();
  for (const tool of workspace.builtinTools) {
    if (!tool.enabled) {
      continue;
    }
    optionMap.set(tool.id, {
      value: tool.id,
      label: tool.name,
      hint: `内置工具 / ${tool.group}`,
    });
  }
  for (const tool of workspace.mcpTools) {
    if (!tool.enabled) {
      continue;
    }
    optionMap.set(tool.id, {
      value: tool.id,
      label: tool.name,
      hint: tool.serverId ? `MCP / ${tool.serverId}` : "MCP 工具",
    });
  }
  return [...optionMap.values()];
});

const workflowCandidateOptions = computed<WorkflowEditorOption[]>(() => {
  return Object.values(workspace.workflowSummaries)
    .filter((workflow) => workflow.id !== props.workflowId)
    .map((workflow) => ({
      value: workflow.id,
      label: workflow.name,
      hint: `${workflow.status} / v${workflow.version}`,
    }));
});

const stateFieldKeyOptions = computed<string[]>(() => {
  return draft.stateSchema
    .map((field) => field.key.trim())
    .filter((key, index, list) => Boolean(key) && list.indexOf(key) === index);
});

/** 校验 workflow graph 的引用合法性（entryNodeId/edges/join upstream）。 */
function validateGraph(definition: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(definition.nodes.map((node) => node.id));

  if (definition.entryNodeId && !nodeIds.has(definition.entryNodeId)) {
    errors.push(`entryNodeId: missing "${definition.entryNodeId}"`);
  }

  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      errors.push(`edge: "${edge.id}" references missing node`);
    }
  }

  for (const node of definition.nodes) {
    if (node.kind !== "join") continue;
    const incoming = definition.edges.filter((edge) => edge.toNodeId === node.id);
    const candidates = new Set(incoming.map((edge) => edge.fromNodeId));
    const invalidUpstreams = node.join.upstreamNodeIds.filter((id) => !candidates.has(id));
    if (invalidUpstreams.length) {
      errors.push(`join: "${node.id}" upstream missing ${invalidUpstreams.join(", ")}`);
    }
  }

  for (const node of definition.nodes) {
    if (node.kind !== "condition") continue;
    const outgoing = definition.edges.filter((edge) => edge.fromNodeId === node.id);
    const hasInlineRule = Boolean(
      node.condition &&
      typeof node.condition.operator === "string" &&
      typeof node.condition.leftPath === "string" &&
      node.condition.leftPath.trim(),
    );
    const hasConditionalEdgeRule = outgoing.some((edge) => (
      edge.kind === "conditional" &&
      edge.condition &&
      typeof edge.condition.operator === "string" &&
      typeof edge.condition.leftPath === "string" &&
      edge.condition.leftPath.trim()
    ));

    if (!hasInlineRule && !hasConditionalEdgeRule) {
      errors.push(`condition: "${node.id}" requires rule config`);
    }
    if (node.route?.trueNodeId && !nodeIds.has(node.route.trueNodeId)) {
      errors.push(`condition: "${node.id}" true route missing "${node.route.trueNodeId}"`);
    }
    if (node.route?.falseNodeId && !nodeIds.has(node.route.falseNodeId)) {
      errors.push(`condition: "${node.id}" false route missing "${node.route.falseNodeId}"`);
    }
    if (node.route?.trueNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.trueNodeId)) {
      errors.push(`condition: "${node.id}" true route edge missing`);
    }
    if (node.route?.falseNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.falseNodeId)) {
      errors.push(`condition: "${node.id}" false route edge missing`);
    }
  }

  return errors;
}

const graphErrors = computed(() => validateGraph(draft));
const graphErrorText = computed(() => (graphErrors.value.length ? graphErrors.value.join("; ") : ""));
const showGraphList = computed(() => props.showGraphList);

const canSave = computed(() => !isSaving.value && schemaErrors.value.length === 0 && graphErrors.value.length === 0);

watch(
  () => [props.selectedNodeId, props.selectedEdgeId],
  ([nextNodeId, nextEdgeId]) => {
    if (nextNodeId && draft.nodes.some((node) => node.id === nextNodeId)) {
      selectedNodeId.value = nextNodeId;
      selectedEdgeId.value = null;
      console.info("[workflow] 同步外部节点选中", { workflowId: props.workflowId, nodeId: nextNodeId });
      return;
    }

    if (nextEdgeId && draft.edges.some((edge) => edge.id === nextEdgeId)) {
      selectedEdgeId.value = nextEdgeId;
      selectedNodeId.value = null;
      console.info("[workflow] 同步外部连线选中", { workflowId: props.workflowId, edgeId: nextEdgeId });
    }
  },
  { immediate: true },
);

/** 选择 node 并切换到 node editor。 */
function selectNode(nodeId: string) {
  console.info("[workflow] 选择节点", { workflowId: props.workflowId, nodeId });
  selectedNodeId.value = nodeId;
  selectedEdgeId.value = null;
}

/** 选择 edge 并切换到 edge editor。 */
function selectEdge(edgeId: string) {
  console.info("[workflow] 选择连线", { workflowId: props.workflowId, edgeId });
  selectedEdgeId.value = edgeId;
  selectedNodeId.value = null;
}

/** 接收 node 更新并写回草稿 definition。 */
function handleNodeUpdate(nextNode: WorkflowNode) {
  const index = draft.nodes.findIndex((node) => node.id === nextNode.id);
  if (index < 0) return;
  draft.nodes.splice(index, 1, nextNode);
  console.info("[workflow] 更新草稿节点", { workflowId: props.workflowId, nodeId: nextNode.id });
}

/** 接收 edge 更新并写回草稿 definition。 */
function handleEdgeUpdate(nextEdge: WorkflowEdge) {
  const index = draft.edges.findIndex((edge) => edge.id === nextEdge.id);
  if (index < 0) return;
  draft.edges.splice(index, 1, nextEdge);
  console.info("[workflow] 更新草稿连线", { workflowId: props.workflowId, edgeId: nextEdge.id });
}

/** 更新 state schema 草稿。 */
function handleStateSchemaUpdate(nextSchema: WorkflowDefinition["stateSchema"]) {
  draft.stateSchema = nextSchema as never;
  console.info("[workflow] 更新草稿 state schema", { workflowId: props.workflowId, fields: nextSchema.length });
}

/** 接收 schema 校验结果，用于禁用保存。 */
function handleSchemaValidation(payload: { errors: string[] }) {
  schemaErrors.value = payload.errors;
  if (schemaErrors.value.length) {
    console.info("[workflow] state schema 校验失败", { workflowId: props.workflowId, errors: schemaErrors.value });
  }
}

/** 乐观保存：本地草稿已变更，保存仅同步到 runtime 全量 definition API。 */
async function handleSave() {
  if (!canSave.value) {
    if (graphErrors.value.length) {
      console.info("[workflow] graph 引用校验失败，禁止保存", { workflowId: props.workflowId, errors: graphErrors.value });
    }
    return;
  }
  saveError.value = "";
  isSaving.value = true;
  console.info("[workflow] 开始保存 workflow definition", {
    workflowId: props.workflowId,
    nodes: draft.nodes.length,
    edges: draft.edges.length,
    stateSchema: draft.stateSchema.length,
  });
  try {
    await workspace.updateWorkflow(props.workflowId, {
      entryNodeId: draft.entryNodeId,
      nodes: draft.nodes,
      edges: draft.edges,
      stateSchema: draft.stateSchema,
      editor: draft.editor,
      defaults: draft.defaults,
    });
    console.info("[workflow] 保存 workflow definition 成功", { workflowId: props.workflowId });
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Save definition failed.";
    console.info("[workflow] 保存 workflow definition 失败", { workflowId: props.workflowId, error: saveError.value });
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.inspector-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
}

.subtitle {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.primary {
  border: none;
  border-radius: 999px;
  padding: 10px 14px;
  background: var(--accent-primary);
  color: var(--accent-text);
  font: inherit;
  cursor: pointer;
}

.primary[disabled] {
  cursor: not-allowed;
  opacity: 0.55;
}

.error {
  color: #b83333;
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.1fr);
  gap: 14px;
  align-items: start;
}

.grid--single {
  grid-template-columns: 1fr;
}

.panel {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: var(--bg-base);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  text-align: left;
}

.row[data-active="true"] {
  border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--glass-border));
}

.muted {
  color: var(--text-secondary);
  font-size: 12px;
}

.edge-label {
  font-size: 12px;
  color: var(--text-primary);
}

.placeholder {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.schema {
  margin-top: 6px;
}

@media (max-width: 960px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
