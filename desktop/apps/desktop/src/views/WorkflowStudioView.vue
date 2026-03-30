<template>
  <div data-testid="workflow-studio-view" class="studio-layout">
    <!-- Top Toolbar -->
    <header class="studio-topbar">
      <div class="topbar-left">
        <RouterLink to="/workflows" class="back-link" title="返回工作流列表">
          <ChevronLeft class="icon-back" :size="20" />
        </RouterLink>
        <div class="divider"></div>
        <div class="title-group">
          <input 
            v-model="draft.name" 
            class="title-input" 
            placeholder="未命名工作流" 
            @blur="handleSave"
            data-testid="workflow-studio-name"
          />
          <span class="status-chip" :data-status="draft.status">{{ statusMap[draft.status] || draft.status }}</span>
        </div>
      </div>

      <div class="topbar-right">
        <div class="setting-group">
          <div class="setting-item">
            <span class="label">来源</span>
            <select
              v-model="draft.source"
              data-testid="workflow-studio-source"
              @change="handleSave"
              class="compact-select"
            >
              <option value="personal">个人</option>
              <option value="enterprise">企业</option>
              <option value="hub">hub</option>
            </select>
          </div>
          <div class="setting-item">
            <span class="label">状态</span>
            <select
              v-model="draft.status"
              data-testid="workflow-studio-status"
              @change="handleSave"
              class="compact-select"
            >
              <option value="draft">草稿</option>
              <option value="active">已启用</option>
              <option value="archived">已归档</option>
            </select>
          </div>
        </div>
        <button
          data-testid="workflow-studio-save"
          class="primary-save-btn"
          @click="handleSave"
          :disabled="isSaving"
        >
          <Save v-if="!isSaving" :size="16" />
          {{ isSaving ? '保存中...' : '提交保存' }}
        </button>
      </div>
    </header>

    <main class="studio-body">
      <!-- Main Canvas Area -->
      <section class="studio-canvas-area">
        <div v-if="saveError" class="top-banner error-banner">
          <AlertTriangle :size="16" />
          {{ saveError }}
        </div>
        
        <WorkflowCanvas
          v-if="workflowDefinition"
          class="canvas-impl flex-fill"
          :definition="workflowDefinition"
          :selected-node-id="selectedNodeId"
          :selected-edge-id="selectedEdgeId"
          :feedback-message="canvasFeedback"
          @select:node="handleNodeSelection"
          @select:edge="handleEdgeSelection"
          @add:node="handleCanvasAddNode"
          @connect:node="handleCanvasConnectNode"
          @delete:node="handleCanvasDeleteNode"
          @delete:edge="handleCanvasDeleteEdge"
          @update:editor="handleCanvasEditorUpdate"
        />
        <div v-else-if="definitionError" class="loading-state error-copy">
          {{ definitionError }}
        </div>
        <div v-else class="loading-state">
          <div class="spinner"></div>
          <p>正在加载工作流定义...</p>
        </div>

        <WorkflowRunPanel
          v-if="workflowDefinition"
          class="studio-run-panel"
          :workflow-id="workflowId"
          :definition="workflowDefinition"
        />
      </section>

      <aside class="studio-right-panel">
        <div class="inspector-content">
          <WorkflowGraphInspector
            v-if="workflowDefinition"
            :workflow-id="workflowId"
            :definition="workflowDefinition"
            :selected-node-id="selectedNodeId"
            :selected-edge-id="selectedEdgeId"
            :show-graph-list="false"
          />
          <p v-else-if="definitionError" class="error-copy" style="padding: 20px;">{{ definitionError }}</p>
          <p v-else class="subtitle" style="padding: 20px;">加载中...</p>
        </div>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowNodeKind } from "@myclaw-desktop/shared";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ChevronLeft, Save, AlertTriangle } from "lucide-vue-next";

import WorkflowCanvas from "@/components/workflow/WorkflowCanvas.vue";
import WorkflowGraphInspector from "@/components/workflow/WorkflowGraphInspector.vue";
import WorkflowRunPanel from "@/components/workflow/WorkflowRunPanel.vue";
import {
  cleanupNodeLayouts,
  computeNextNodePosition,
  type WorkflowCanvasNodeLayout,
} from "@/components/workflow/workflow-canvas-geometry";
import { createWorkflowNodeDraft } from "@/components/workflow/workflow-node-factory";
import { useWorkspaceStore } from "@/stores/workspace";

const route = useRoute();
const workspace = useWorkspaceStore();
const isSaving = ref(false);
const saveError = ref("");
const definitionError = ref("");
const selectedNodeId = ref<string | null>(null);
const selectedEdgeId = ref<string | null>(null);
const canvasFeedback = ref("");
const draft = reactive({
  name: "",
  description: "",
  status: "draft" as "draft" | "active" | "archived",
  source: "personal" as "personal" | "enterprise" | "hub",
});

const statusMap = {
  draft: "草稿",
  active: "已启用",
  archived: "已归档",
};

const workflowId = computed(() => String(route.params.id ?? ""));
const workflow = computed(() => workspace.workflows.find((item) => item.id === workflowId.value) ?? null);
const workflowDefinition = computed(() => workspace.workflowDefinitions[workflowId.value] ?? null);

function syncDraft() {
  if (!workflow.value) return;
  draft.name = workflow.value.name;
  draft.description = workflow.value.description;
  draft.status = workflow.value.status;
  draft.source = workflow.value.source;
}

watch(workflow, () => { syncDraft(); }, { immediate: true });

watch(
  workflowDefinition,
  (definition) => {
    if (!definition) {
      canvasFeedback.value = "";
      selectedNodeId.value = null;
      selectedEdgeId.value = null;
      return;
    }

    const hasSelectedNode = selectedNodeId.value
      ? definition.nodes.some((node) => node.id === selectedNodeId.value)
      : false;
    const hasSelectedEdge = selectedEdgeId.value
      ? definition.edges.some((edge) => edge.id === selectedEdgeId.value)
      : false;

    if (hasSelectedNode || hasSelectedEdge) return;

    selectedNodeId.value = definition.entryNodeId || definition.nodes[0]?.id || null;
    selectedEdgeId.value = null;
  },
  { immediate: true },
);

onMounted(async () => {
  if (!workflowId.value || workflowDefinition.value) return;
  definitionError.value = "";
  try {
    await workspace.loadWorkflowById(workflowId.value);
  } catch (error) {
    definitionError.value = error instanceof Error ? error.message : "加载工作流定义失败。";
  }
});

async function handleSave() {
  if (!workflowId.value) return;

  const name = draft.name.trim();
  const description = draft.description.trim() || " "; // fallback to space if cleared to pass validation
  saveError.value = "";

  if (!name) {
    saveError.value = "工作流名称不能为空。";
    return;
  }

  isSaving.value = true;
  try {
    await workspace.updateWorkflow(workflowId.value, {
      name,
      description,
      status: draft.status,
      source: draft.source,
    });
    // Remove temporary error/message after success
    setTimeout(() => { saveError.value = ""; }, 2000);
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "保存工作流失败。";
  } finally {
    isSaving.value = false;
  }
}

function handleNodeSelection(nodeId: string) {
  canvasFeedback.value = "";
  selectedNodeId.value = nodeId;
  selectedEdgeId.value = null;
}

function handleEdgeSelection(edgeId: string) {
  canvasFeedback.value = "";
  selectedEdgeId.value = edgeId;
  selectedNodeId.value = null;
}

function setCanvasFeedback(message: string) {
  canvasFeedback.value = message;
  setTimeout(() => { canvasFeedback.value = ""; }, 3000);
}

function cloneEditor(definition: WorkflowDefinition) {
  return {
    canvas: {
      viewport: {
        offsetX: definition.editor?.canvas.viewport.offsetX ?? 0,
        offsetY: definition.editor?.canvas.viewport.offsetY ?? 0,
      },
      nodes: (definition.editor?.canvas.nodes ?? []).map((layout) => ({
        nodeId: layout.nodeId,
        position: {
          x: layout.position.x,
          y: layout.position.y,
        },
      })),
    },
  };
}

/** 按 id 读取工作流节点，避免到处重复遍历节点列表。 */
function findWorkflowNode(definition: WorkflowDefinition, nodeId: string) {
  return definition.nodes.find((node) => node.id === nodeId) ?? null;
}

/** 返回节点当前所有出边，供条件路由和连线校验复用。 */
function findOutgoingEdges(definition: WorkflowDefinition, nodeId: string) {
  return definition.edges.filter((edge) => edge.fromNodeId === nodeId);
}

/** 清理 condition.route 中已经失效的目标节点引用。 */
function reconcileConditionNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return nodes.map((node) => {
    if (node.kind !== "condition") {
      return node;
    }

    const outgoingTargetIds = new Set(edges
      .filter((edge) => edge.fromNodeId === node.id)
      .map((edge) => edge.toNodeId));
    const trueNodeId = node.route?.trueNodeId;
    const falseNodeId = node.route?.falseNodeId;
    const nextRoute = {
      ...(trueNodeId && outgoingTargetIds.has(trueNodeId) ? { trueNodeId } : {}),
      ...(falseNodeId && outgoingTargetIds.has(falseNodeId) ? { falseNodeId } : {}),
    };

    if (!Object.keys(nextRoute).length) {
      const { route: _route, ...rest } = node;
      return rest as WorkflowNode;
    }

    return {
      ...node,
      route: nextRoute,
    };
  });
}

/** 校验桌面端画布连线是否合法，并在需要时同步修正 condition/join 的节点配置。 */
function buildConnectionPatch(
  definition: WorkflowDefinition,
  payload: { fromNodeId: string; toNodeId: string },
): { edge: WorkflowEdge; nodes: WorkflowNode[] } | null {
  const fromNode = findWorkflowNode(definition, payload.fromNodeId);
  const toNode = findWorkflowNode(definition, payload.toNodeId);
  if (!fromNode || !toNode) {
    setCanvasFeedback("连线节点不存在，请刷新后重试。");
    return null;
  }

  if (fromNode.id === toNode.id) {
    return null;
  }

  if (toNode.kind === "start") {
    setCanvasFeedback("开始节点不能作为下游节点。");
    return null;
  }

  if (fromNode.kind === "end") {
    setCanvasFeedback("结束节点不能继续向外连线。");
    return null;
  }

  if (definition.edges.some((edge) => edge.fromNodeId === payload.fromNodeId && edge.toNodeId === payload.toNodeId)) {
    return null;
  }

  let nextNodes = [...definition.nodes];
  if (fromNode.kind === "condition") {
    const outgoingEdges = findOutgoingEdges(definition, fromNode.id);
    const nextRoute = { ...(fromNode.route ?? {}) };
    const matchedBranch = nextRoute.trueNodeId === payload.toNodeId
      ? "true"
      : nextRoute.falseNodeId === payload.toNodeId
        ? "false"
        : null;

    if (!matchedBranch && outgoingEdges.length >= 2) {
      setCanvasFeedback("条件分支节点最多只能配置 True / False 两条出边。");
      return null;
    }

    if (!matchedBranch) {
      if (!nextRoute.trueNodeId) {
        nextRoute.trueNodeId = payload.toNodeId;
      } else if (!nextRoute.falseNodeId) {
        nextRoute.falseNodeId = payload.toNodeId;
      }
    }

    nextNodes = nextNodes.map((node) => (
      node.id === fromNode.id
        ? {
            ...fromNode,
            route: nextRoute,
          }
        : node
    ));
  }

  if (toNode.kind === "join") {
    const nextUpstreamNodeIds = Array.from(new Set([...toNode.join.upstreamNodeIds, payload.fromNodeId]));
    nextNodes = nextNodes.map((node) => (
      node.id === toNode.id
        ? {
            ...toNode,
            join: {
              ...toNode.join,
              upstreamNodeIds: nextUpstreamNodeIds,
            },
          }
        : node
    ));
  }

  return {
    edge: {
      id: `edge-${payload.fromNodeId}-${payload.toNodeId}`,
      fromNodeId: payload.fromNodeId,
      toNodeId: payload.toNodeId,
      kind: "normal",
    },
    nodes: nextNodes,
  };
}

/** 返回当前工作流中第一个可复用的状态字段键，供新节点默认绑定输出或人工输入结果。 */
function pickPreferredStateFieldKey(definition: WorkflowDefinition): string | null {
  return definition.stateSchema
    .map((field) => field.key.trim())
    .find((fieldKey) => fieldKey.length > 0) ?? null;
}

/** 选择一个真实可用的工具 ID，减少新增工具节点后出现随机占位值。 */
function pickDefaultToolId(): string | null {
  const builtinTool = workspace.builtinTools.find((tool) => tool.enabled);
  if (builtinTool) {
    return builtinTool.id;
  }
  const mcpTool = workspace.mcpTools.find((tool) => tool.enabled);
  return mcpTool?.id ?? null;
}

/** 选择一个可用的子工作流 ID，优先复用当前工作区已加载的其他工作流。 */
function pickDefaultWorkflowId(): string | null {
  const workflow = Object.values(workspace.workflowSummaries).find((item) => item.id !== workflowId.value);
  return workflow?.id ?? null;
}

/** 结合当前工作区上下文，为新节点补上更接近真实语义的默认配置。 */
function applyContextualNodeDefaults(definition: WorkflowDefinition, node: WorkflowNode): WorkflowNode {
  const preferredStateFieldKey = pickPreferredStateFieldKey(definition);

  if (node.kind === "tool") {
    const defaultToolId = pickDefaultToolId();
    return {
      ...node,
      label: node.label === "Tool" ? "工具调用" : node.label,
      tool: {
        ...node.tool,
        toolId: defaultToolId ?? node.tool.toolId,
      },
    };
  }

  if (node.kind === "human-input") {
    return {
      ...node,
      label: node.label === "Human Input" ? "人工输入" : node.label,
      humanInput: {
        ...node.humanInput,
        formKey: preferredStateFieldKey ?? node.humanInput.formKey,
      },
    };
  }

  if (node.kind === "subgraph") {
    const defaultWorkflowId = pickDefaultWorkflowId();
    return {
      ...node,
      label: node.label === "Subgraph" ? "子工作流" : node.label,
      subgraph: {
        ...node.subgraph,
        workflowId: defaultWorkflowId ?? node.subgraph.workflowId,
      },
    };
  }

  if (node.kind === "condition" && preferredStateFieldKey) {
    return {
      ...node,
      label: node.label === "Condition" ? "条件分支" : node.label,
      condition: {
        ...(node.condition ?? {}),
        operator: node.condition?.operator ?? "exists",
        leftPath:
          node.condition?.leftPath && node.condition.leftPath !== "$.state.result"
            ? node.condition.leftPath
            : `$.${preferredStateFieldKey}`,
      },
    };
  }

  if (node.kind === "llm") {
    return {
      ...node,
      label: node.label === "LLM" ? "对话处理" : node.label,
    };
  }

  if (node.kind === "join") {
    return {
      ...node,
      label: node.label === "Join" ? "汇聚结果" : node.label,
    };
  }

  if (node.kind === "start") {
    return { ...node, label: node.label === "Start" ? "开始" : node.label };
  }

  if (node.kind === "end") {
    return { ...node, label: node.label === "End" ? "结束" : node.label };
  }

  return node;
}

function buildCanvasGraphPatch(kind: WorkflowNodeKind) {
  const definition = workflowDefinition.value;
  if (!definition) return null;

  if (kind === "join" && !selectedNodeId.value) {
    setCanvasFeedback("请先选择一个上游节点，再新增汇聚节点。");
    return null;
  }

  const timestamp = Date.now();
  const nodeId = `node-${kind}-${timestamp}`;
  const nextPosition = computeNextNodePosition({
    layouts: definition.editor?.canvas.nodes ?? [],
    upstreamNodeId: selectedNodeId.value ?? undefined,
    fallbackIndex: definition.nodes.length,
  });
  const initialNodeDraft = createWorkflowNodeDraft({
    kind,
    nodeId,
    upstreamNodeId: selectedNodeId.value ?? undefined,
    position: nextPosition,
  });
  const nodeDraft = {
    ...initialNodeDraft,
    node: applyContextualNodeDefaults(definition, initialNodeDraft.node),
  };
  const nextNodes = [...definition.nodes, nodeDraft.node];
  const nextDefinition = {
    ...definition,
    nodes: nextNodes,
  };
  let nextEdges = [...definition.edges];
  let nextGraphNodes = nextNodes;

  if (selectedNodeId.value) {
    const connectionPatch = buildConnectionPatch(nextDefinition, {
      fromNodeId: selectedNodeId.value,
      toNodeId: nodeId,
    });
    if (!connectionPatch) {
      return null;
    }
    nextEdges = [...nextEdges, connectionPatch.edge];
    nextGraphNodes = connectionPatch.nodes;
  }

  return {
    node: nodeDraft.node,
    nodes: nextGraphNodes,
    edges: nextEdges,
    editor: {
      canvas: {
        viewport: cloneEditor(definition).canvas.viewport,
        nodes: [...cloneEditor(definition).canvas.nodes, nodeDraft.layout],
      },
    },
    entryNodeId: definition.entryNodeId || nodeDraft.node.id,
  };
}

function cleanupStateSchemaNodeReferences(nodeIds: Set<string>) {
  return (workflowDefinition.value?.stateSchema ?? []).map((field) => ({
    ...field,
    producerNodeIds: field.producerNodeIds.filter((nodeId) => !nodeIds.has(nodeId)),
    consumerNodeIds: field.consumerNodeIds.filter((nodeId) => !nodeIds.has(nodeId)),
  }));
}

type JoinReconcileResult = { nodes: WorkflowNode[]; blockedJoinIds: string[]; };

function reconcileJoinNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): JoinReconcileResult {
  const blockedJoinIds: string[] = [];
  const nextNodes = nodes.map((node) => {
    if (node.kind !== "join") return node;

    const incomingSources = new Set(edges
      .filter((edge) => edge.toNodeId === node.id)
      .map((edge) => edge.fromNodeId));
    const upstreamNodeIds = node.join.upstreamNodeIds.filter((nodeId) => incomingSources.has(nodeId));

    if (upstreamNodeIds.length === 0) {
      blockedJoinIds.push(node.id);
      return node;
    }

    return { ...node, join: { ...node.join, upstreamNodeIds } };
  });

  return {
    nodes: blockedJoinIds.length > 0 ? nodes : nextNodes,
    blockedJoinIds,
  };
}

async function handleCanvasAddNode(kind: WorkflowNodeKind) {
  if (!workflowId.value) return;
  canvasFeedback.value = "";
  const patch = buildCanvasGraphPatch(kind);
  if (!patch) return;

  try {
    await workspace.updateWorkflow(workflowId.value, {
      entryNodeId: patch.entryNodeId,
      nodes: patch.nodes,
      edges: patch.edges,
      editor: patch.editor,
    });
    selectedNodeId.value = patch.node.id;
    selectedEdgeId.value = null;
  } catch (e: any) {
    setCanvasFeedback(e.message || "新增节点失败。");
  }
}

async function handleCanvasConnectNode(payload: { fromNodeId: string; toNodeId: string }) {
  if (!workflowId.value || !workflowDefinition.value || payload.fromNodeId === payload.toNodeId) return;

  canvasFeedback.value = "";
  const connectionPatch = buildConnectionPatch(workflowDefinition.value, payload);
  if (!connectionPatch) {
    return;
  }

  try {
    await workspace.updateWorkflow(workflowId.value, {
      nodes: connectionPatch.nodes,
      edges: [...workflowDefinition.value.edges, connectionPatch.edge],
      editor: cloneEditor(workflowDefinition.value),
    });
    selectedNodeId.value = payload.toNodeId;
    selectedEdgeId.value = null;
  } catch (e: any) {
    setCanvasFeedback(e.message || "创建连线失败。");
  }
}

async function handleCanvasDeleteEdge(edgeId: string) {
  if (!workflowId.value || !workflowDefinition.value) return;

  const nextEdges = workflowDefinition.value.edges.filter((edge) => edge.id !== edgeId);
  const reconciledConditionNodes = reconcileConditionNodes(workflowDefinition.value.nodes, nextEdges);
  const { nodes: nextNodes, blockedJoinIds } = reconcileJoinNodes(reconciledConditionNodes, nextEdges);
  if (blockedJoinIds.length > 0) {
    setCanvasFeedback("汇聚节点至少要保留一个上游节点，无法删除这条连线。");
    return;
  }

  canvasFeedback.value = "";
  try {
    await workspace.updateWorkflow(workflowId.value, {
      edges: nextEdges,
      nodes: nextNodes,
      editor: cloneEditor(workflowDefinition.value),
    });
    selectedEdgeId.value = null;
    selectedNodeId.value = workflowDefinition.value.entryNodeId || workflowDefinition.value.nodes[0]?.id || null;
  } catch (e: any) {
    setCanvasFeedback(e.message || "删除连线失败。");
  }
}

async function handleCanvasDeleteNode(nodeId: string) {
  if (!workflowId.value || !workflowDefinition.value) return;

  if (workflowDefinition.value.entryNodeId === nodeId) {
    setCanvasFeedback("入口节点不能删除。");
    return;
  }

  const deletedNodeIds = new Set([nodeId]);
  const nextEdges = workflowDefinition.value.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId);
  const remainingNodes = workflowDefinition.value.nodes.filter((node) => node.id !== nodeId);
  const reconciledConditionNodes = reconcileConditionNodes(remainingNodes, nextEdges);
  const { nodes: nextNodes, blockedJoinIds } = reconcileJoinNodes(reconciledConditionNodes, nextEdges);
  
  if (blockedJoinIds.length > 0) {
    setCanvasFeedback("汇聚节点至少要保留一个上游节点，无法删除该节点。");
    return;
  }

  canvasFeedback.value = "";
  try {
    const nextEditor = {
      canvas: {
        viewport: cloneEditor(workflowDefinition.value).canvas.viewport,
        nodes: cleanupNodeLayouts(
          cloneEditor(workflowDefinition.value).canvas.nodes as WorkflowCanvasNodeLayout[],
          new Set(nextNodes.map((node) => node.id)),
        ),
      },
    };
    await workspace.updateWorkflow(workflowId.value, {
      nodes: nextNodes,
      edges: nextEdges,
      stateSchema: cleanupStateSchemaNodeReferences(deletedNodeIds),
      editor: nextEditor,
    });
    selectedNodeId.value = workflowDefinition.value.entryNodeId || nextNodes[0]?.id || null;
    selectedEdgeId.value = null;
  } catch (e: any) {
    setCanvasFeedback(e.message || "删除节点失败。");
  }
}

async function handleCanvasEditorUpdate(editor: NonNullable<WorkflowDefinition["editor"]>) {
  if (!workflowId.value) return;

  try {
    await workspace.updateWorkflow(workflowId.value, { editor });
  } catch (error: any) {
    setCanvasFeedback(error?.message || "更新画布布局失败。");
  }
}
</script>

<style scoped>
.studio-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  background-color: #0d0d0f;
  color: var(--text-primary, #ffffff);
  overflow: hidden;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.studio-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 24px;
  background: #161618;
  border-bottom: 1px solid #27272a;
  z-index: 100;
  flex-shrink: 0;
}

.topbar-left, .topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: #a1a1aa;
  transition: all 0.2s;
}

.back-link:hover {
  background: #27272a;
  color: #ffffff;
}

.divider {
  width: 1px;
  height: 16px;
  background: #3f3f46;
}

.title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-input {
  background: transparent;
  border: 1px solid transparent;
  color: #f4f4f5;
  font-size: 16px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  outline: none;
  min-width: 200px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.title-input:hover {
  background: rgba(255, 255, 255, 0.05);
}

.title-input:focus {
  background: #09090b;
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.status-chip {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.02em;
  background: #27272a;
  color: #a1a1aa;
  border: 1px solid #3f3f46;
}

.status-chip[data-status="active"] {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
}

.status-chip[data-status="draft"] {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.2);
}

.setting-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #71717a;
}

.compact-select {
  background: #161618;
  border: 1px solid #27272a;
  color: #d4d4d8;
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.primary-save-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: #3b82f6;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-save-btn:hover:not(:disabled) {
  background: #2563eb;
}

.primary-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.studio-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

.studio-canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  min-width: 0;
  background: #0d0d0f;
}

.studio-right-panel {
  width: 340px;
  border-left: 1px solid #27272a;
  background: #161618;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  z-index: 10;
  overflow-y: auto;
}

.inspector-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.studio-run-panel {
  flex-shrink: 0;
  border-top: 1px solid #27272a;
  background: #161618;
  max-height: 350px;
  z-index: 5;
}

.top-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(239, 68, 68, 0.9);
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
  backdrop-filter: blur(4px);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: #71717a;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #27272a;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1200px) {
  .studio-right-panel { width: 300px; }
}
</style>
