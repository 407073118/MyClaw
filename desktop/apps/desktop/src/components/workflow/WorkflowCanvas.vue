<template>
  <section
    data-testid="workflow-canvas"
    class="canvas-container"
    tabindex="0"
    @keydown="handleCanvasKeydown"
  >
    <aside class="palette" data-testid="workflow-canvas-palette">
      <ul class="palette-list">
        <li v-for="kind in paletteKinds" :key="kind">
          <button
            :data-testid="`workflow-canvas-add-node-${kind}`"
            type="button"
            class="palette-item"
            :disabled="isAddDisabled(kind)"
            @click="handleAddNode(kind)"
            :title="nodeKindMap[kind] || kind"
          >
            <component :is="nodeIconMap[kind]" class="kind-icon-svg" :data-kind="kind" :size="20" />
            <span class="kind-label">{{ nodeKindMap[kind] || kind }}</span>
          </button>
        </li>
      </ul>
    </aside>

    <div class="graph-stage-wrapper">
      <header class="stage-header">
        <div class="graph-stats">
          <span class="stat-tag">{{ definition.nodes.length }} 节点</span>
          <span class="stat-tag">{{ definition.edges.length }} 连线</span>
          <span
            v-if="graphIssues.length"
            data-testid="workflow-canvas-graph-status"
            class="stat-tag stat-tag--warn"
          >
            {{ graphIssues.length }} 问题
          </span>
        </div>
        <div class="stage-actions">
          <button
            v-if="selectedEdgeId"
            data-testid="workflow-canvas-delete-edge"
            type="button"
            class="btn-danger-sm"
            @click="handleDeleteEdge"
          >
            删除连线
          </button>
          <button
            v-if="selectedNodeId"
            data-testid="workflow-canvas-delete-node"
            type="button"
            class="btn-danger-sm"
            :disabled="isDeleteNodeDisabled"
            @click="handleDeleteNode"
          >
            删除节点
          </button>
        </div>
      </header>

      <div class="graph-stage-shell">
        <div
          ref="stageRef"
          data-testid="workflow-canvas-stage"
          class="graph-stage"
          @mousedown="handleStagePointerDown"
        >
          <div
            data-testid="workflow-canvas-stage-layer"
            class="graph-stage-layer"
            :style="stageLayerStyle"
          >
            <svg class="edge-overlay" :width="canvasWidth" :height="canvasHeight">
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10" markerHeight="8"
                  refX="9" refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 10 4 L 0 8 Z" fill="rgba(96,165,250,0.55)" />
                </marker>
                <marker
                  id="arrowhead-active"
                  markerWidth="10" markerHeight="8"
                  refX="9" refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 10 4 L 0 8 Z" fill="#60a5fa" />
                </marker>
                <marker
                  id="arrowhead-conditional-true"
                  markerWidth="10" markerHeight="8"
                  refX="9" refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 10 4 L 0 8 Z" fill="rgba(16,185,129,0.7)" />
                </marker>
                <marker
                  id="arrowhead-conditional-false"
                  markerWidth="10" markerHeight="8"
                  refX="9" refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 10 4 L 0 8 Z" fill="rgba(239,68,68,0.7)" />
                </marker>
              </defs>
              <g
                v-for="edge in renderedEdges"
                :key="edge.edge.id"
                :data-testid="`workflow-canvas-edge-${edge.edge.id}`"
                :data-edge-id="edge.edge.id"
                class="edge-hit-group"
                @click.stop="handleEdgeSelect(edge.edge.id)"
              >
                <path
                  class="edge-path"
                  :class="{
                    active: edge.edge.id === selectedEdgeId,
                    'edge-true': edge.conditionBranch === 'true',
                    'edge-false': edge.conditionBranch === 'false',
                  }"
                  :d="edge.path"
                  :marker-end="edgeMarker(edge)"
                />
                <path class="edge-hit" :d="edge.path" />
                <text
                  v-if="edge.conditionBranch"
                  class="edge-label-text"
                  :x="edge.labelPos.x"
                  :y="edge.labelPos.y"
                  text-anchor="middle"
                >
                  {{ edge.conditionBranch === 'true' ? 'True' : 'False' }}
                </text>
              </g>
              <path
                v-if="previewEdgePath"
                data-testid="workflow-canvas-preview-edge"
                class="edge-path edge-path--preview"
                :d="previewEdgePath"
                marker-end="url(#arrowhead)"
              />
            </svg>

            <!-- Node cards -->
            <article
              v-for="renderedNode in renderedNodes"
              :key="renderedNode.node.id"
              :data-testid="`workflow-canvas-node-${renderedNode.node.id}`"
              :data-node-id="renderedNode.node.id"
              :data-kind="renderedNode.node.kind"
              class="workflow-node-card"
              :class="{
                active: renderedNode.node.id === selectedNodeId,
                dragging: dragState?.nodeId === renderedNode.node.id,
                'is-terminal': renderedNode.node.kind === 'start' || renderedNode.node.kind === 'end',
              }"
              :style="getNodeStyle(renderedNode)"
              @click.stop="handleNodeSelect(renderedNode.node.id)"
              @mousedown="handleNodePointerDown(renderedNode.node.id, $event)"
            >
              <!-- Top handle (target) -->
              <button
                v-if="renderedNode.node.kind !== 'start'"
                :data-testid="`workflow-canvas-target-handle-${renderedNode.node.id}`"
                type="button"
                class="node-handle node-handle--target"
                :class="{ ready: isConnectionTarget(renderedNode.node.id) }"
                @mousedown.stop
                @mouseup.stop="handleConnectionComplete(renderedNode.node.id)"
              >
                <span class="visually-hidden">Target handle</span>
              </button>

              <div class="node-header">
                <span class="node-kind-badge" :data-kind="renderedNode.node.kind">
                  <component :is="nodeIconMap[renderedNode.node.kind]" :size="12" />
                  {{ nodeKindMap[renderedNode.node.kind] || renderedNode.node.kind }}
                </span>
                <span
                  v-if="renderedNode.node.id === definition.entryNodeId"
                  class="entry-star"
                  title="入口节点"
                >
                  <component :is="nodeIconMap['start']" :size="10" />
                </span>
              </div>
              <div class="node-content">
                <h4 class="node-label">{{ renderedNode.node.label }}</h4>
                <p
                  v-if="renderedNode.node.kind !== 'start' && renderedNode.node.kind !== 'end'"
                  class="node-summary"
                  :data-testid="`workflow-canvas-node-summary-${renderedNode.node.id}`"
                >
                  {{ nodeSummary(renderedNode.node) }}
                </p>
              </div>

              <!-- Bottom handle (source) -->
              <button
                v-if="renderedNode.node.kind !== 'end'"
                :data-testid="`workflow-canvas-source-handle-${renderedNode.node.id}`"
                type="button"
                class="node-handle node-handle--source"
                :class="{ active: connectionState?.fromNodeId === renderedNode.node.id }"
                @mousedown.stop="handleConnectionStart(renderedNode.node.id, $event)"
              >
                <span class="visually-hidden">Source handle</span>
              </button>
            </article>
          </div>
        </div>
      </div>

      <div
        v-if="graphIssues.length"
        data-testid="workflow-canvas-graph-issues"
        class="graph-issues-banner"
      >
        {{ graphIssues.join("; ") }}
      </div>

      <div v-if="actionHint" data-testid="workflow-canvas-action-hint" class="hint-toast">
        {{ actionHint }}
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeKind } from "@myclaw-desktop/shared";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Play, MessageCircle, Wrench, User, GitBranch, Network, Merge, Square } from "lucide-vue-next";

import {
  buildFallbackNodeLayouts,
  computeEdgeAnchorPoints,
  findNodeLayout,
  type WorkflowCanvasNodeLayout,
  type WorkflowCanvasPoint,
} from "@/components/workflow/workflow-canvas-geometry";
import {
  getWorkflowNodeKindLabel,
  isGeneratedScopedReference,
} from "@/components/workflow/workflow-node-factory";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const TERMINAL_NODE_WIDTH = 120;
const TERMINAL_NODE_HEIGHT = 48;
const MIN_CANVAS_WIDTH = 1200;
const MIN_CANVAS_HEIGHT = 800;
const EDGE_CURVE_OFFSET = 60;

type WorkflowEditorMetadata = NonNullable<WorkflowDefinition["editor"]>;

type DragState = {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  origin: WorkflowCanvasPoint;
};

type PanState = {
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
};

type ConnectionState = {
  fromNodeId: string;
  pointer: WorkflowCanvasPoint;
};

type WorkflowConditionCarrier = WorkflowNode & {
  condition?: {
    operator?: string;
    leftPath?: string;
    rightValue?: string | number | boolean | null | string[];
  };
  route?: {
    trueNodeId?: string;
    falseNodeId?: string;
  };
};

type RenderedEdge = {
  edge: WorkflowDefinition["edges"][number];
  path: string;
  conditionBranch: "true" | "false" | null;
  labelPos: WorkflowCanvasPoint;
};

const props = defineProps<{
  definition: WorkflowDefinition;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  feedbackMessage?: string | null;
}>();

const emit = defineEmits<{
  (event: "select:node", nodeId: string): void;
  (event: "select:edge", edgeId: string): void;
  (event: "add:node", kind: WorkflowNodeKind): void;
  (event: "connect:node", payload: { fromNodeId: string; toNodeId: string }): void;
  (event: "delete:node", nodeId: string): void;
  (event: "delete:edge", edgeId: string): void;
  (event: "update:editor", editor: WorkflowEditorMetadata): void;
}>();

const stageRef = ref<HTMLDivElement | null>(null);
const dragState = ref<DragState | null>(null);
const panState = ref<PanState | null>(null);
const connectionState = ref<ConnectionState | null>(null);
const localEditor = ref<WorkflowEditorMetadata>(createResolvedEditor(props.definition));

const selectedNodeId = computed(() => props.selectedNodeId ?? null);
const selectedEdgeId = computed(() => props.selectedEdgeId ?? null);
const isDeleteNodeDisabled = computed(() => selectedNodeId.value === props.definition.entryNodeId);
const paletteKinds = computed<WorkflowNodeKind[]>(() => [
  "start",
  "llm",
  "tool",
  "human-input",
  "condition",
  "subgraph",
  "join",
  "end",
]);
const nodeKindMap: Record<string, string> = Object.fromEntries(
  paletteKinds.value.map((kind) => [kind, getWorkflowNodeKindLabel(kind)]),
);

const nodeIconMap: Record<string, any> = {
  start: Play,
  llm: MessageCircle,
  tool: Wrench,
  "human-input": User,
  condition: GitBranch,
  subgraph: Network,
  join: Merge,
  end: Square,
};

watch(
  () => props.definition,
  (definition) => {
    localEditor.value = createResolvedEditor(definition);
    dragState.value = null;
    panState.value = null;
    connectionState.value = null;
  },
  { immediate: true, deep: true },
);

function getNodeDimensions(kind: string) {
  if (kind === "start" || kind === "end") {
    return { width: TERMINAL_NODE_WIDTH, height: TERMINAL_NODE_HEIGHT };
  }
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

const renderedNodes = computed(() => props.definition.nodes.map((node) => ({
  node,
  position: getNodePosition(node.id),
  ...getNodeDimensions(node.kind),
})));

const renderedEdges = computed<RenderedEdge[]>(() => props.definition.edges.flatMap((edge) => {
  const fromNode = props.definition.nodes.find((n) => n.id === edge.fromNodeId);
  const toNode = props.definition.nodes.find((n) => n.id === edge.toNodeId);
  const fromPosition = getNodePosition(edge.fromNodeId);
  const toPosition = getNodePosition(edge.toNodeId);
  if (!fromPosition || !toPosition || !fromNode || !toNode) {
    return [];
  }

  const fromDim = getNodeDimensions(fromNode.kind);
  const toDim = getNodeDimensions(toNode.kind);

  const anchors = computeEdgeAnchorPoints(
    { x: fromPosition.x, y: fromPosition.y, width: fromDim.width, height: fromDim.height },
    { x: toPosition.x, y: toPosition.y, width: toDim.width, height: toDim.height },
  );

  // Detect condition branch
  let conditionBranch: "true" | "false" | null = null;
  if (fromNode?.kind === "condition") {
    const carrier = fromNode as WorkflowConditionCarrier;
    if (carrier.route?.trueNodeId === edge.toNodeId) conditionBranch = "true";
    else if (carrier.route?.falseNodeId === edge.toNodeId) conditionBranch = "false";
  }

  const path = buildEdgePath(anchors.start, anchors.end);
  const labelPos = {
    x: (anchors.start.x + anchors.end.x) / 2,
    y: (anchors.start.y + anchors.end.y) / 2 - 8,
  };

  return [{ edge, path, conditionBranch, labelPos }];
}));

function edgeMarker(edge: RenderedEdge) {
  if (edge.edge.id === selectedEdgeId.value) return "url(#arrowhead-active)";
  if (edge.conditionBranch === "true") return "url(#arrowhead-conditional-true)";
  if (edge.conditionBranch === "false") return "url(#arrowhead-conditional-false)";
  return "url(#arrowhead)";
}

const canvasWidth = computed(() => renderedNodes.value.reduce((maxX, rn) => (
  Math.max(maxX, rn.position.x + rn.width + 240)
), MIN_CANVAS_WIDTH));

const canvasHeight = computed(() => renderedNodes.value.reduce((maxY, rn) => (
  Math.max(maxY, rn.position.y + rn.height + 240)
), MIN_CANVAS_HEIGHT));

const stageLayerStyle = computed(() => ({
  width: `${canvasWidth.value}px`,
  height: `${canvasHeight.value}px`,
  transform: `translate(${localEditor.value.canvas.viewport.offsetX}px, ${localEditor.value.canvas.viewport.offsetY}px)`,
}));

const previewEdgePath = computed(() => {
  if (!connectionState.value) {
    return "";
  }

  const fromNode = props.definition.nodes.find((n) => n.id === connectionState.value?.fromNodeId);
  const fromPosition = getNodePosition(connectionState.value.fromNodeId);
  if (!fromPosition || !fromNode) {
    return "";
  }

  const fromDim = getNodeDimensions(fromNode.kind);
  const anchors = computeEdgeAnchorPoints(
    { x: fromPosition.x, y: fromPosition.y, width: fromDim.width, height: fromDim.height },
    {
      x: connectionState.value.pointer.x - NODE_WIDTH / 2,
      y: connectionState.value.pointer.y,
      width: NODE_WIDTH,
      height: 0,
    },
  );
  return buildEdgePath(anchors.start, anchors.end);
});

const graphIssues = computed(() => {
  const issues: string[] = [];
  const nodeIds = new Set(props.definition.nodes.map((node) => node.id));

  if (!nodeIds.has(props.definition.entryNodeId)) {
    issues.push(`entryNodeId: missing "${props.definition.entryNodeId}"`);
  }

  for (const edge of props.definition.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      issues.push(`edge: "${edge.id}" references missing node`);
    }
  }

  for (const node of props.definition.nodes) {
    if (node.kind !== "join") {
      continue;
    }
    const incoming = new Set(props.definition.edges
      .filter((edge) => edge.toNodeId === node.id)
      .map((edge) => edge.fromNodeId));
    const invalidUpstreams = node.join.upstreamNodeIds.filter((nodeId) => !incoming.has(nodeId));
    if (invalidUpstreams.length) {
      issues.push(`join: "${node.id}" upstream missing ${invalidUpstreams.join(", ")}`);
    }
  }

  for (const node of props.definition.nodes) {
    if (node.kind !== "condition") {
      continue;
    }

    const outgoing = props.definition.edges.filter((edge) => edge.fromNodeId === node.id);
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
      issues.push(`condition: "${node.id}" requires rule config`);
    }
    if (node.route?.trueNodeId && !nodeIds.has(node.route.trueNodeId)) {
      issues.push(`condition: "${node.id}" true route missing "${node.route.trueNodeId}"`);
    }
    if (node.route?.falseNodeId && !nodeIds.has(node.route.falseNodeId)) {
      issues.push(`condition: "${node.id}" false route missing "${node.route.falseNodeId}"`);
    }
    if (node.route?.trueNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.trueNodeId)) {
      issues.push(`condition: "${node.id}" true route edge missing`);
    }
    if (node.route?.falseNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.falseNodeId)) {
      issues.push(`condition: "${node.id}" false route edge missing`);
    }
  }

  return issues;
});

const actionHint = computed(() => {
  if (props.feedbackMessage) {
    return props.feedbackMessage;
  }
  if (connectionState.value) {
    return "拖到目标节点顶部端口即可创建连线";
  }
  if (!selectedNodeId.value) {
    return "先选择一个节点，再添加 Join 或拖出新连线";
  }
  if (isDeleteNodeDisabled.value) {
    return "入口节点不能删除";
  }
  return "";
});

function createResolvedEditor(definition: WorkflowDefinition): WorkflowEditorMetadata {
  const layouts = definition.editor?.canvas.nodes?.length
    ? definition.editor.canvas.nodes.map((layout) => ({
      nodeId: layout.nodeId,
      position: { x: layout.position.x, y: layout.position.y },
    }))
    : buildFallbackNodeLayouts(definition.nodes.map((node) => node.id));

  return {
    canvas: {
      viewport: {
        offsetX: definition.editor?.canvas.viewport.offsetX ?? 0,
        offsetY: definition.editor?.canvas.viewport.offsetY ?? 0,
      },
      nodes: layouts,
    },
  };
}

function cloneEditor(editor: WorkflowEditorMetadata): WorkflowEditorMetadata {
  return {
    canvas: {
      viewport: {
        offsetX: editor.canvas.viewport.offsetX,
        offsetY: editor.canvas.viewport.offsetY,
      },
      nodes: editor.canvas.nodes.map((layout) => ({
        nodeId: layout.nodeId,
        position: { x: layout.position.x, y: layout.position.y },
      })),
    },
  };
}

function getNodePosition(nodeId: string): WorkflowCanvasPoint {
  const existingLayout = findNodeLayout(localEditor.value.canvas.nodes, nodeId);
  if (existingLayout) {
    return existingLayout.position;
  }

  const fallbackLayout = buildFallbackNodeLayouts(props.definition.nodes.map((node) => node.id))
    .find((layout) => layout.nodeId === nodeId);
  return fallbackLayout?.position ?? { x: 300, y: 60 };
}

/** 读取节点当前出边数量，供连线约束和画布提示复用。 */
function countOutgoingEdges(nodeId: string) {
  return props.definition.edges.filter((edge) => edge.fromNodeId === nodeId).length;
}

/** 按 id 读取节点定义，统一画布上的语义判断逻辑。 */
function findWorkflowNode(nodeId: string) {
  return props.definition.nodes.find((node) => node.id === nodeId) ?? null;
}

function updateNodePosition(nodeId: string, position: WorkflowCanvasPoint) {
  const layouts = localEditor.value.canvas.nodes;
  const layoutIndex = layouts.findIndex((layout) => layout.nodeId === nodeId);
  const nextLayout: WorkflowCanvasNodeLayout = {
    nodeId,
    position: { x: position.x, y: position.y },
  };

  if (layoutIndex >= 0) {
    layouts.splice(layoutIndex, 1, nextLayout);
    return;
  }

  layouts.push(nextLayout);
}

function buildEdgePath(start: WorkflowCanvasPoint, end: WorkflowCanvasPoint): string {
  const controlOffset = Math.max(EDGE_CURVE_OFFSET, Math.abs(end.y - start.y) * 0.35);
  return [
    `M ${start.x} ${start.y}`,
    `C ${start.x} ${start.y + controlOffset}, ${end.x} ${end.y - controlOffset}, ${end.x} ${end.y}`,
  ].join(" ");
}

function getNodeStyle(renderedNode: { position: WorkflowCanvasPoint; width: number; height: number }) {
  return {
    width: `${renderedNode.width}px`,
    transform: `translate(${renderedNode.position.x}px, ${renderedNode.position.y}px)`,
  };
}

/** 截断节点摘要文本，避免卡片信息溢出。 */
function clipSummary(text: string, maxLength = 38) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

/** 生成 condition 节点摘要，突出条件表达式与路由含义。 */
function conditionNodeSummary(node: WorkflowConditionCarrier) {
  const config = node.condition ?? {};
  const operator = typeof config.operator === "string" && config.operator.trim() ? config.operator : "exists";
  const leftPath = typeof config.leftPath === "string" && config.leftPath.trim() ? config.leftPath : "$.state.result";
  const rightValue = Array.isArray(config.rightValue)
    ? config.rightValue.join(", ")
    : config.rightValue === null
      ? "null"
      : config.rightValue === undefined
        ? ""
        : String(config.rightValue);
  const trueNodeId = typeof node.route?.trueNodeId === "string" ? node.route.trueNodeId : "";
  const falseNodeId = typeof node.route?.falseNodeId === "string" ? node.route.falseNodeId : "";
  const expression = operator === "exists" || rightValue === ""
    ? `${leftPath} ${operator}`
    : `${leftPath} ${operator} ${rightValue}`;
  if (!trueNodeId && !falseNodeId) {
    return clipSummary(expression);
  }
  return clipSummary(`${expression} | T:${trueNodeId || "-"} F:${falseNodeId || "-"}`, 72);
}

/** 根据节点类型输出卡片摘要，让画布直接反映节点语义差异。 */
function nodeSummary(node: WorkflowNode) {
  if (node.kind === "start") {
    return "入口节点";
  }
  if (node.kind === "end") {
    return "结束节点";
  }
  if (node.kind === "llm") {
    if (!node.llm.prompt || node.llm.prompt.includes("请补充") || node.llm.prompt.includes("请根据当前状态")) {
      return "待配置提示词";
    }
    return clipSummary(node.llm.prompt || "未配置提示词");
  }
  if (node.kind === "tool") {
    if (isGeneratedScopedReference("tool", node.id, node.tool.toolId)) {
      return "待选择工具";
    }
    return clipSummary(node.tool.toolId || "未配置工具");
  }
  if (node.kind === "human-input") {
    if (isGeneratedScopedReference("form", node.id, node.humanInput.formKey)) {
      return "待配置人工输入结果字段";
    }
    return clipSummary(`结果字段:${node.humanInput.formKey || "-"}`);
  }
  if (node.kind === "subgraph") {
    if (isGeneratedScopedReference("workflow", node.id, node.subgraph.workflowId)) {
      return "待选择子工作流";
    }
    return clipSummary(`子流:${node.subgraph.workflowId || "-"}`);
  }
  if (node.kind === "join") {
    return clipSummary(`${node.join.mode === "all" ? "等待全部" : "任一即可"} | ${node.join.upstreamNodeIds.length} 个上游`);
  }
  if (node.kind === "condition") {
    return conditionNodeSummary(node as WorkflowConditionCarrier);
  }
  return clipSummary(node.kind);
}

function handleNodeSelect(nodeId: string) {
  emit("select:node", nodeId);
}

function handleEdgeSelect(edgeId: string) {
  emit("select:edge", edgeId);
}

function handleAddNode(kind: WorkflowNodeKind) {
  if (isAddDisabled(kind)) {
    return;
  }
  emit("add:node", kind);
}

function handleDeleteNode() {
  if (selectedNodeId.value) {
    emit("delete:node", selectedNodeId.value);
  }
}

function handleDeleteEdge() {
  if (selectedEdgeId.value) {
    emit("delete:edge", selectedEdgeId.value);
  }
}

function handleCanvasKeydown(event: KeyboardEvent) {
  if (event.key !== "Delete" && event.key !== "Backspace") {
    return;
  }

  if (selectedEdgeId.value) {
    event.preventDefault();
    handleDeleteEdge();
    return;
  }

  if (selectedNodeId.value && !isDeleteNodeDisabled.value) {
    event.preventDefault();
    handleDeleteNode();
  }
}

function isAddDisabled(kind: WorkflowNodeKind) {
  if (kind === "start" && props.definition.nodes.some((node) => node.kind === "start")) {
    return true;
  }
  if (kind === "join" && !selectedNodeId.value) {
    return true;
  }
  return false;
}

function canConnectToNode(nodeId: string) {
  if (!connectionState.value || connectionState.value.fromNodeId === nodeId) {
    return false;
  }
  const fromNode = findWorkflowNode(connectionState.value.fromNodeId);
  const toNode = findWorkflowNode(nodeId);
  if (!fromNode || !toNode) {
    return false;
  }
  if (toNode.kind === "start" || fromNode.kind === "end") {
    return false;
  }
  if (fromNode.kind === "condition" && countOutgoingEdges(fromNode.id) >= 2) {
    return false;
  }
  return !props.definition.edges.some((edge) => (
    edge.fromNodeId === connectionState.value?.fromNodeId && edge.toNodeId === nodeId
  ));
}

function isConnectionTarget(nodeId: string) {
  return Boolean(connectionState.value) && canConnectToNode(nodeId);
}

function extractClientPoint(event: MouseEvent) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function resolveCanvasPoint(clientPoint: WorkflowCanvasPoint): WorkflowCanvasPoint {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) {
    return clientPoint;
  }

  return {
    x: clientPoint.x - rect.left - localEditor.value.canvas.viewport.offsetX,
    y: clientPoint.y - rect.top - localEditor.value.canvas.viewport.offsetY,
  };
}

function attachWindowListeners() {
  window.addEventListener("mousemove", handleWindowPointerMove);
  window.addEventListener("mouseup", handleWindowPointerUp);
}

function detachWindowListeners() {
  window.removeEventListener("mousemove", handleWindowPointerMove);
  window.removeEventListener("mouseup", handleWindowPointerUp);
}

function beginInteraction() {
  detachWindowListeners();
  attachWindowListeners();
}

function finishInteraction(shouldEmit: boolean) {
  const hadDrag = Boolean(dragState.value || panState.value);
  dragState.value = null;
  panState.value = null;
  connectionState.value = null;
  detachWindowListeners();

  if (shouldEmit && hadDrag) {
    emit("update:editor", cloneEditor(localEditor.value));
  }
}

function handleNodePointerDown(nodeId: string, event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }
  if ((event.target as HTMLElement | null)?.closest(".node-handle")) {
    return;
  }

  const point = extractClientPoint(event);
  dragState.value = {
    nodeId,
    startClientX: point.x,
    startClientY: point.y,
    origin: { ...getNodePosition(nodeId) },
  };
  emit("select:node", nodeId);
  beginInteraction();
}

function handleStagePointerDown(event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }
  if ((event.target as HTMLElement | null)?.closest("[data-node-id], [data-edge-id], .edge-item")) {
    return;
  }

  const point = extractClientPoint(event);
  panState.value = {
    startClientX: point.x,
    startClientY: point.y,
    offsetX: localEditor.value.canvas.viewport.offsetX,
    offsetY: localEditor.value.canvas.viewport.offsetY,
  };
  beginInteraction();
}

function handleConnectionStart(nodeId: string, event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }
  const node = findWorkflowNode(nodeId);
  if (!node || node.kind === "end") {
    return;
  }

  connectionState.value = {
    fromNodeId: nodeId,
    pointer: resolveCanvasPoint(extractClientPoint(event)),
  };
  emit("select:node", nodeId);
  beginInteraction();
}

function handleConnectionComplete(nodeId: string) {
  if (!connectionState.value || !canConnectToNode(nodeId)) {
    connectionState.value = null;
    detachWindowListeners();
    return;
  }

  emit("connect:node", {
    fromNodeId: connectionState.value.fromNodeId,
    toNodeId: nodeId,
  });
  connectionState.value = null;
  detachWindowListeners();
}

function handleWindowPointerMove(event: MouseEvent) {
  const point = extractClientPoint(event);

  if (dragState.value) {
    updateNodePosition(dragState.value.nodeId, {
      x: dragState.value.origin.x + point.x - dragState.value.startClientX,
      y: dragState.value.origin.y + point.y - dragState.value.startClientY,
    });
    return;
  }

  if (panState.value) {
    localEditor.value.canvas.viewport = {
      offsetX: panState.value.offsetX + point.x - panState.value.startClientX,
      offsetY: panState.value.offsetY + point.y - panState.value.startClientY,
    };
    return;
  }

  if (connectionState.value) {
    connectionState.value = {
      ...connectionState.value,
      pointer: resolveCanvasPoint(point),
    };
  }
}

function handleWindowPointerUp() {
  finishInteraction(true);
}

onBeforeUnmount(() => {
  detachWindowListeners();
});
</script>

<style scoped>
.canvas-container {
  display: flex;
  height: 100%;
  width: 100%;
  min-width: 0;
  min-height: 0;
  background: #0d0d0f;
  outline: none;
}

/* ── Palette ────────────────────────────────── */

.palette {
  width: 64px;
  background: #121214;
  border-right: 1px solid #27272a;
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  z-index: 20;
}

.palette-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.palette-item {
  background: transparent;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0px;
  padding: 4px;
  cursor: pointer;
  width: 100%;
  transition: all 0.2s;
}

.palette-item:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.kind-icon-svg {
  color: #a1a1aa;
  transition: color 0.2s;
  display: block;
}

.kind-icon-svg[data-kind="llm"] { color: #10b981; }
.kind-icon-svg[data-kind="tool"] { color: #3b82f6; }
.kind-icon-svg[data-kind="start"] { color: #f59e0b; }
.kind-icon-svg[data-kind="condition"] { color: #8b5cf6; }
.kind-icon-svg[data-kind="human-input"] { color: #f97316; }
.kind-icon-svg[data-kind="subgraph"] { color: #14b8a6; }
.kind-icon-svg[data-kind="join"] { color: #eab308; }
.kind-icon-svg[data-kind="end"] { color: #ef4444; }

.palette-item:hover .kind-icon-svg,
.palette-item:active .kind-icon-svg {
  color: #f4f4f5;
  transform: scale(1.05);
}

.kind-label {
  font-size: 10px;
  color: #52525b;
  font-weight: 500;
}

.palette-item:hover .kind-label {
  color: #a1a1aa;
}

/* ── Stage layout ────────────────────────────── */

.graph-stage-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  min-width: 0;
}

.stage-header {
  height: 40px;
  background: #161618;
  border-bottom: 1px solid #27272a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 15;
}

.graph-stats {
  display: flex;
  gap: 12px;
}

.stat-tag {
  font-size: 11px;
  color: #71717a;
  background: #09090b;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #27272a;
}

.stat-tag--warn {
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.08);
}

.btn-danger-sm {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-danger-sm:hover:not(:disabled) {
  background: #ef4444;
  color: white;
}

.btn-danger-sm:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.graph-stage-shell {
  flex: 1;
  display: flex;
  min-height: 0;
}

.graph-stage {
  position: relative;
  flex: 1;
  overflow: hidden;
  background-image: radial-gradient(#1f1f23 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: grab;
}

.graph-stage:active {
  cursor: grabbing;
}

.graph-stage-layer {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
}

/* ── Edges ────────────────────────────── */

.edge-overlay {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.edge-hit-group {
  pointer-events: auto;
}

.edge-path {
  fill: none;
  stroke: rgba(96, 165, 250, 0.55);
  stroke-width: 2px;
  transition: stroke 0.2s;
}

.edge-path.active {
  stroke: #60a5fa;
  stroke-width: 2.5px;
}

.edge-path.edge-true {
  stroke: rgba(16, 185, 129, 0.7);
}

.edge-path.edge-false {
  stroke: rgba(239, 68, 68, 0.7);
}

.edge-path--preview {
  stroke-dasharray: 8 6;
}

.edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 18px;
}

.edge-label-text {
  fill: #a1a1aa;
  font-size: 10px;
  font-weight: 600;
  pointer-events: none;
}

/* ── Node cards ────────────────────────────── */

.workflow-node-card {
  min-height: 48px;
  background: #161618;
  border: 1px solid #27272a;
  border-radius: 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease;
  position: absolute;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

/* Terminal nodes (start/end) - pill shape */
.workflow-node-card.is-terminal {
  border-radius: 24px;
  text-align: center;
}

.workflow-node-card.is-terminal .node-header {
  justify-content: center;
  border-bottom: none;
  padding: 6px 12px;
}

.workflow-node-card.is-terminal .node-content {
  padding: 0 12px 6px;
  align-items: center;
}

/* Kind-specific top accent */
.workflow-node-card[data-kind="llm"] { border-top: 2px solid #10b981; }
.workflow-node-card[data-kind="tool"] { border-top: 2px solid #3b82f6; }
.workflow-node-card[data-kind="human-input"] { border-top: 2px solid #f97316; }
.workflow-node-card[data-kind="condition"] { border-top: 2px solid #8b5cf6; }
.workflow-node-card[data-kind="subgraph"] { border-top: 2px solid #14b8a6; }
.workflow-node-card[data-kind="join"] { border-top: 2px solid #eab308; }
.workflow-node-card[data-kind="start"] { border-top: 2px solid #f59e0b; }
.workflow-node-card[data-kind="end"] { border-top: 2px solid #ef4444; }

.workflow-node-card:hover {
  border-color: #3b82f6;
  background: #1a1a1d;
}

.workflow-node-card.active {
  border-color: #3b82f6;
  background: #0f172a;
  box-shadow: 0 0 0 1px #3b82f6, 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}

.workflow-node-card.dragging {
  box-shadow: 0 0 0 1px #60a5fa, 0 18px 30px -12px rgba(15, 23, 42, 0.7);
}

.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(39, 39, 42, 0.6);
}

.node-kind-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
}

.node-kind-badge[data-kind="llm"] { color: #10b981; }
.node-kind-badge[data-kind="tool"] { color: #3b82f6; }
.node-kind-badge[data-kind="start"] { color: #f59e0b; }
.node-kind-badge[data-kind="condition"] { color: #8b5cf6; }
.node-kind-badge[data-kind="human-input"] { color: #f97316; }
.node-kind-badge[data-kind="subgraph"] { color: #14b8a6; }
.node-kind-badge[data-kind="join"] { color: #eab308; }
.node-kind-badge[data-kind="end"] { color: #ef4444; }

.entry-star {
  color: #f59e0b;
  font-size: 10px;
}

.node-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 12px 8px;
}

.node-label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #f4f4f5;
  line-height: 1.3;
}

.node-summary {
  margin: 0;
  font-size: 11px;
  line-height: 1.3;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Handles (top/bottom for vertical flow) ────── */

.node-handle {
  position: absolute;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid #3f3f46;
  background: #18181b;
  transform: translateX(-50%);
  cursor: crosshair;
  transition: all 0.15s;
  z-index: 5;
}

.node-handle--target {
  top: -7px;
}

.node-handle--source {
  bottom: -7px;
}

.node-handle.ready {
  border-color: #10b981;
  background: #065f46;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  width: 18px;
  height: 18px;
  top: -9px;
}

.node-handle.active,
.workflow-node-card:hover .node-handle {
  border-color: #60a5fa;
  background: #1d4ed8;
}

/* ── Issues & hints ────────────────────────────── */

.graph-issues-banner {
  position: absolute;
  top: 52px;
  left: 84px;
  right: 20px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.22);
  color: #fbbf24;
  font-size: 12px;
  z-index: 30;
}

.hint-toast {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(22, 22, 24, 0.95);
  border: 1px solid #3b82f6;
  color: #93c5fd;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
  z-index: 100;
  white-space: nowrap;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
