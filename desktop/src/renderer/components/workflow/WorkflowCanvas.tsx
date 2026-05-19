import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeKind } from "@shared/contracts";
import { Play, MessageCircle, Wrench, Globe, User, GitBranch, Network, Merge, Square, Check, AlertCircle, Loader, Pause, Trash2 } from "lucide-react";
import type { DebugNodeStatus } from "../../pages/WorkflowStudioPage";

import {
  buildFallbackNodeLayouts,
  computeEdgeAnchorPoints,
  findNodeLayout,
  type WorkflowCanvasNodeLayout,
  type WorkflowCanvasPoint,
} from "./workflow-canvas-geometry";
import { WORKFLOW_CREATABLE_NODE_KINDS, getWorkflowNodeKindLabel, isGeneratedScopedReference } from "./workflow-node-factory";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 88;
const TERMINAL_NODE_WIDTH = 120;
const TERMINAL_NODE_HEIGHT = 48;
const MIN_CANVAS_WIDTH = 1200;
const MIN_CANVAS_HEIGHT = 800;
const EDGE_CURVE_OFFSET = 60;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.75;
const ZOOM_WHEEL_FACTOR = 1.12;
const MINIMAP_WIDTH = 184;
const MINIMAP_BODY_HEIGHT = 104;
const MINIMAP_PADDING = 8;

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

type EdgeRunPhase = "idle" | "flowing" | "completed" | "error";

interface WorkflowCanvasProps {
  definition: WorkflowDefinition;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  feedbackMessage?: string | null;
  headerLeading?: React.ReactNode;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAddNode: (kind: WorkflowNodeKind) => void;
  onConnectNode: (payload: { fromNodeId: string; toNodeId: string }) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onUpdateEditor: (editor: WorkflowEditorMetadata) => void;
  debugMode?: boolean;
  debugNodeStatuses?: Map<string, DebugNodeStatus>;
}

const NODE_KIND_LIST: WorkflowNodeKind[] = WORKFLOW_CREATABLE_NODE_KINDS;

const nodeKindMap: Record<string, string> = Object.fromEntries(
  NODE_KIND_LIST.map((kind) => [kind, getWorkflowNodeKindLabel(kind)]),
);

const nodeIconMap: Record<string, React.ElementType> = {
  start: Play,
  llm: MessageCircle,
  tool: Wrench,
  "http-request": Globe,
  "human-input": User,
  condition: GitBranch,
  subgraph: Network,
  join: Merge,
  end: Square,
};

/** 根据节点类型返回画布节点的默认尺寸。*/
function getNodeDimensions(kind: string) {
  if (kind === "start" || kind === "end") {
    return { width: TERMINAL_NODE_WIDTH, height: TERMINAL_NODE_HEIGHT };
  }
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

/** 解析工作流定义中的 editor 字段，缺省时生成回退布局。*/
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

/** 深拷贝 editor 数据，避免拖拽过程直接污染上游状态。*/
function cloneEditor(editor: WorkflowEditorMetadata): WorkflowEditorMetadata {
  return {
    canvas: {
      viewport: { offsetX: editor.canvas.viewport.offsetX, offsetY: editor.canvas.viewport.offsetY },
      nodes: editor.canvas.nodes.map((layout) => ({
        nodeId: layout.nodeId,
        position: { x: layout.position.x, y: layout.position.y },
      })),
    },
  };
}

/** 为连线生成三次贝塞尔曲线路径。*/
function buildEdgePath(start: WorkflowCanvasPoint, end: WorkflowCanvasPoint): string {
  const controlOffset = Math.max(EDGE_CURVE_OFFSET, Math.abs(end.y - start.y) * 0.35);
  return [
    `M ${start.x} ${start.y}`,
    `C ${start.x} ${start.y + controlOffset}, ${end.x} ${end.y - controlOffset}, ${end.x} ${end.y}`,
  ].join(" ");
}

/** 裁剪节点摘要长度，避免画布卡片被长文本撑爆。*/
function clipSummary(text: string, maxLength = 64) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/** 限制画布缩放比例，保证节点内容仍然可读且全景视图稳定。 */
function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** 生成条件节点摘要，方便在画布上快速浏览。*/
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
  const expression =
    operator === "exists" || rightValue === ""
      ? `${leftPath} ${operator}`
      : `${leftPath} ${operator} ${rightValue}`;
  if (!trueNodeId && !falseNodeId) return clipSummary(expression);
  return clipSummary(`${expression} | T:${trueNodeId || "-"} F:${falseNodeId || "-"}`, 72);
}

/** 生成节点摘要，按节点类型展示最关键的配置。*/
function nodeSummary(node: WorkflowNode): string {
  if (node.kind === "start") return "入口节点";
  if (node.kind === "end") return "结束节点";
  if (node.kind === "llm") {
    const llm = node.llm ?? { prompt: "", outputKey: undefined };
    if (!llm.prompt || llm.prompt.includes("请补充")) {
      return "待配置对话";
    }
    return clipSummary(llm.prompt || "未配置对话");
  }
  if (node.kind === "tool") {
    const tool = node.tool ?? { toolId: "" };
    if (isGeneratedScopedReference("tool", node.id, tool.toolId)) return "待选择工具";
    return clipSummary(tool.toolId || "未配置工具");
  }
  if (node.kind === "human-input") {
    const humanInput = node.humanInput ?? { formKey: "" };
    if (isGeneratedScopedReference("form", node.id, humanInput.formKey)) return "待配置人工输入结果字段";
    return clipSummary(`结果字段:${humanInput.formKey || "-"}`);
  }
  if (node.kind === "subgraph") {
    const subgraph = node.subgraph ?? { workflowId: "" };
    if (isGeneratedScopedReference("workflow", node.id, subgraph.workflowId)) return "待选择子工作流";
    return clipSummary(`子流:${subgraph.workflowId || "-"}`);
  }
  if (node.kind === "join") {
    const join = node.join ?? { mode: "all", upstreamNodeIds: [] };
    return clipSummary(`${join.mode === "all" ? "等待全部" : "任一即可"} | ${join.upstreamNodeIds.length} 个上游`);
  }
  if (node.kind === "condition") return conditionNodeSummary(node as WorkflowConditionCarrier);
  return clipSummary((node as WorkflowNode).kind);
}

/** 渲染工作流画布，处理拖拽、连线、平移等交互。*/
export default function WorkflowCanvas({
  definition,
  selectedNodeId: propSelectedNodeId = null,
  selectedEdgeId: propSelectedEdgeId = null,
  feedbackMessage = null,
  headerLeading = null,
  onSelectNode,
  onSelectEdge,
  onAddNode,
  onConnectNode,
  onDeleteNode,
  onDeleteEdge,
  onUpdateEditor,
  debugMode = false,
  debugNodeStatuses,
}: WorkflowCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [localEditor, setLocalEditor] = useState<WorkflowEditorMetadata>(() => createResolvedEditor(definition));
  const [zoom, setZoom] = useState(1);

  const dragStateRef = useRef(dragState);
  const panStateRef = useRef(panState);
  const connectionStateRef = useRef(connectionState);
  const localEditorRef = useRef(localEditor);
  const zoomRef = useRef(zoom);
  const definitionIdRef = useRef(definition.id);
  dragStateRef.current = dragState;
  panStateRef.current = panState;
  connectionStateRef.current = connectionState;
  localEditorRef.current = localEditor;
  zoomRef.current = zoom;

  const selectedNodeId = propSelectedNodeId ?? null;
  const selectedEdgeId = propSelectedEdgeId ?? null;
  const isDeleteNodeDisabled = selectedNodeId === definition.entryNodeId;

  useEffect(() => {
    setLocalEditor(createResolvedEditor(definition));
    if (definitionIdRef.current !== definition.id) {
      setZoom(1);
      definitionIdRef.current = definition.id;
    }
    setDragState(null);
    setPanState(null);
    setConnectionState(null);
  }, [definition]);

  function getNodePosition(nodeId: string): WorkflowCanvasPoint {
    const existingLayout = findNodeLayout(localEditor.canvas.nodes, nodeId);
    if (existingLayout) return existingLayout.position;
    const fallbackLayout = buildFallbackNodeLayouts(definition.nodes.map((node) => node.id)).find(
      (layout) => layout.nodeId === nodeId,
    );
    return fallbackLayout?.position ?? { x: 300, y: 60 };
  }

  function countOutgoingEdges(nodeId: string) {
    return definition.edges.filter((edge) => edge.fromNodeId === nodeId).length;
  }

  function findWorkflowNode(nodeId: string) {
    return definition.nodes.find((node) => node.id === nodeId) ?? null;
  }

  /** 将内部节点 ID 转成画布上可读的节点名称，错误提示不直接暴露实现标识。 */
  function getReadableNodeName(nodeId: string) {
    return findWorkflowNode(nodeId)?.label || "已删除节点";
  }

  function updateNodePosition(nodeId: string, position: WorkflowCanvasPoint) {
    setLocalEditor((prev) => {
      const layouts = [...prev.canvas.nodes];
      const layoutIndex = layouts.findIndex((layout) => layout.nodeId === nodeId);
      const nextLayout: WorkflowCanvasNodeLayout = { nodeId, position: { x: position.x, y: position.y } };
      if (layoutIndex >= 0) {
        layouts.splice(layoutIndex, 1, nextLayout);
      } else {
        layouts.push(nextLayout);
      }
      return { ...prev, canvas: { ...prev.canvas, nodes: layouts } };
    });
  }

  const renderedNodes = useMemo(
    () =>
      definition.nodes.map((node) => ({
        node,
        position: getNodePosition(node.id),
        ...getNodeDimensions(node.kind),
      })),
    [definition.nodes, localEditor.canvas.nodes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const renderedEdges = useMemo<RenderedEdge[]>(() => {
    return definition.edges.flatMap((edge) => {
      const fromNode = definition.nodes.find((n) => n.id === edge.fromNodeId);
      const toNode = definition.nodes.find((n) => n.id === edge.toNodeId);
      const fromPosition = getNodePosition(edge.fromNodeId);
      const toPosition = getNodePosition(edge.toNodeId);
      if (!fromPosition || !toPosition || !fromNode || !toNode) return [];

      const fromDim = getNodeDimensions(fromNode.kind);
      const toDim = getNodeDimensions(toNode.kind);
      const anchors = computeEdgeAnchorPoints(
        { x: fromPosition.x, y: fromPosition.y, width: fromDim.width, height: fromDim.height },
        { x: toPosition.x, y: toPosition.y, width: toDim.width, height: toDim.height },
      );

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
    });
  }, [definition.edges, definition.nodes, localEditor.canvas.nodes]); // eslint-disable-line react-hooks/exhaustive-deps


  function edgeMarker(edge: RenderedEdge): string {
    if (edge.edge.id === selectedEdgeId) return "url(#arrowhead-active)";
    if (edge.conditionBranch === "true") return "url(#arrowhead-conditional-true)";
    if (edge.conditionBranch === "false") return "url(#arrowhead-conditional-false)";
    return "url(#arrowhead)";
  }

  /** 根据两端节点的调试状态推导连线运行态，让图执行路径在画布上可见。 */
  function getEdgeRunPhase(edge: RenderedEdge): EdgeRunPhase {
    if (!debugMode || !debugNodeStatuses) return "idle";
    const fromStatus = debugNodeStatuses.get(edge.edge.fromNodeId);
    const toStatus = debugNodeStatuses.get(edge.edge.toNodeId);
    const fromPhase = fromStatus?.phase;
    const toPhase = toStatus?.phase;
    if (fromPhase === "error" || toPhase === "error") return "error";
    if (fromPhase === "completed" && toPhase === "completed") return "completed";
    if (
      fromPhase === "completed" ||
      toPhase === "running" ||
      toPhase === "streaming" ||
      fromPhase === "running" ||
      fromPhase === "streaming"
    ) {
      return "flowing";
    }
    return "idle";
  }

  /** 把节点输出压缩成画布卡片上的一行摘要，避免用户打开日志才看到 LLM 结果。 */
  function summarizeDebugOutputs(outputs: Record<string, unknown> | undefined): string {
    if (!outputs) return "";
    const preferred = outputs.content ?? outputs.output ?? outputs.body;
    const value = preferred ?? Object.values(outputs)[0];
    if (value === undefined) return "";
    return clipSummary(typeof value === "string" ? value : JSON.stringify(value), 80);
  }

  const canvasWidth = useMemo(
    () => renderedNodes.reduce((maxX, rn) => Math.max(maxX, rn.position.x + rn.width + 240), MIN_CANVAS_WIDTH),
    [renderedNodes],
  );

  const canvasHeight = useMemo(
    () => renderedNodes.reduce((maxY, rn) => Math.max(maxY, rn.position.y + rn.height + 240), MIN_CANVAS_HEIGHT),
    [renderedNodes],
  );

  const minimapScale = useMemo(() => {
    const availableWidth = MINIMAP_WIDTH - MINIMAP_PADDING * 2;
    const availableHeight = MINIMAP_BODY_HEIGHT - MINIMAP_PADDING * 2;
    return Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);
  }, [canvasWidth, canvasHeight]);

  const minimapViewport = useMemo(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    const stageWidth = rect?.width && rect.width > 0 ? rect.width : 640;
    const stageHeight = rect?.height && rect.height > 0 ? rect.height : 360;
    const visibleWidth = (stageWidth / zoom) * minimapScale;
    const visibleHeight = (stageHeight / zoom) * minimapScale;
    const rawX = (-localEditor.canvas.viewport.offsetX / zoom) * minimapScale + MINIMAP_PADDING;
    const rawY = (-localEditor.canvas.viewport.offsetY / zoom) * minimapScale + MINIMAP_PADDING;
    const width = Math.min(MINIMAP_WIDTH - MINIMAP_PADDING * 2, Math.max(14, visibleWidth));
    const height = Math.min(MINIMAP_BODY_HEIGHT - MINIMAP_PADDING * 2, Math.max(14, visibleHeight));
    return {
      x: Math.max(MINIMAP_PADDING, Math.min(MINIMAP_WIDTH - MINIMAP_PADDING - width, rawX)),
      y: Math.max(MINIMAP_PADDING, Math.min(MINIMAP_BODY_HEIGHT - MINIMAP_PADDING - height, rawY)),
      width,
      height,
    };
  }, [canvasWidth, canvasHeight, localEditor.canvas.viewport.offsetX, localEditor.canvas.viewport.offsetY, minimapScale, zoom]);

  const previewEdgePath = useMemo(() => {
    if (!connectionState) return "";
    const fromNode = definition.nodes.find((n) => n.id === connectionState.fromNodeId);
    const fromPosition = getNodePosition(connectionState.fromNodeId);
    if (!fromPosition || !fromNode) return "";
    const fromDim = getNodeDimensions(fromNode.kind);
    const anchors = computeEdgeAnchorPoints(
      { x: fromPosition.x, y: fromPosition.y, width: fromDim.width, height: fromDim.height },
      {
        x: connectionState.pointer.x - NODE_WIDTH / 2,
        y: connectionState.pointer.y,
        width: NODE_WIDTH,
        height: 0,
      },
    );
    return buildEdgePath(anchors.start, anchors.end);
  }, [connectionState, definition.nodes, localEditor.canvas.nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const graphIssues = useMemo(() => {
    const issues: string[] = [];
    const nodeIds = new Set(definition.nodes.map((node) => node.id));

    if (!nodeIds.has(definition.entryNodeId)) {
      issues.push("入口节点已不存在，请重新指定开始节点");
    }

    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        issues.push("连线引用了已删除节点，请重新连线");
      }
    }

    for (const node of definition.nodes) {
      if (node.kind !== "join") continue;
      const incoming = new Set(
        definition.edges.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.fromNodeId),
      );
      const invalidUpstreams = node.join.upstreamNodeIds.filter((nodeId) => !incoming.has(nodeId));
      if (invalidUpstreams.length) {
        const labels = invalidUpstreams.map(getReadableNodeName).join("、");
        issues.push(`${node.label || "汇聚节点"} 的上游节点不可达：${labels}`);
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
      const hasConditionalEdgeRule = outgoing.some(
        (edge) =>
          edge.kind === "conditional" &&
          edge.condition &&
          typeof edge.condition.operator === "string" &&
          typeof edge.condition.leftPath === "string" &&
          edge.condition.leftPath.trim(),
      );
      if (!hasInlineRule && !hasConditionalEdgeRule) {
        issues.push(`${node.label || "条件分支"} 需要配置判断条件`);
      }
      if (node.route?.trueNodeId && !nodeIds.has(node.route.trueNodeId)) {
        issues.push(`${node.label || "条件分支"} 的 True 路由目标已不存在`);
      }
      if (node.route?.falseNodeId && !nodeIds.has(node.route.falseNodeId)) {
        issues.push(`${node.label || "条件分支"} 的 False 路由目标已不存在`);
      }
      if (node.route?.trueNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.trueNodeId)) {
        issues.push(`${node.label || "条件分支"} 的 True 路由还没有连线`);
      }
      if (node.route?.falseNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.falseNodeId)) {
        issues.push(`${node.label || "条件分支"} 的 False 路由还没有连线`);
      }
    }

    return issues;
  }, [definition]);

  const actionHint = useMemo(() => {
    if (feedbackMessage) return feedbackMessage;
    if (connectionState) return "点击目标端口完成连线，点击空白区域或按 Esc 取消。";
    if (selectedEdgeId) return "已选中连线，可点击垃圾桶删除，或按 Delete 直接删除。";
    if (selectedNodeId) {
      return isDeleteNodeDisabled
        ? "入口节点不能删除。"
        : "已选中节点，可点击垃圾桶删除，或按 Delete 直接删除。";
    }
    return "点击节点开始编辑，拖出端口连线；滚轮缩放，拖动画布平移。";
  }, [feedbackMessage, connectionState, selectedEdgeId, selectedNodeId, isDeleteNodeDisabled]);

  /** 清理当前连线状态，避免连接模式悬挂。 */
  function clearConnectionState() {
    setConnectionState(null);
  }

  /** 判断键盘事件目标是否为可编辑控件，避免误触删除。 */
  function isEditableElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  }

  /** 删除当前选中的节点。 */
  function handleDeleteSelectedNode() {
    if (!selectedNodeId) return;
    clearConnectionState();
    onDeleteNode(selectedNodeId);
  }

  /** 删除当前选中的连线。 */
  function handleDeleteSelectedEdge() {
    if (!selectedEdgeId) return;
    clearConnectionState();
    onDeleteEdge(selectedEdgeId);
  }

  function canConnectToNode(nodeId: string) {
    const cs = connectionStateRef.current;
    if (!cs || cs.fromNodeId === nodeId) return false;
    const fromNode = findWorkflowNode(cs.fromNodeId);
    const toNode = findWorkflowNode(nodeId);
    if (!fromNode || !toNode) return false;
    if (toNode.kind === "start" || fromNode.kind === "end") return false;
    if (fromNode.kind === "condition" && countOutgoingEdges(fromNode.id) >= 2) return false;
    return !definition.edges.some((edge) => edge.fromNodeId === cs.fromNodeId && edge.toNodeId === nodeId);
  }

  function isConnectionTarget(nodeId: string) {
    return Boolean(connectionState) && canConnectToNode(nodeId);
  }

  function isAddDisabled(kind: WorkflowNodeKind) {
    if (kind === "start" && definition.nodes.some((node) => node.kind === "start")) return true;
    if (kind === "join" && !selectedNodeId) return true;
    return false;
  }

  function extractClientPoint(event: MouseEvent): WorkflowCanvasPoint {
    return { x: event.clientX, y: event.clientY };
  }

  function resolveCanvasPoint(clientPoint: WorkflowCanvasPoint): WorkflowCanvasPoint {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return clientPoint;
    const editor = localEditorRef.current;
    const currentZoom = zoomRef.current;
    return {
      x: (clientPoint.x - rect.left - editor.canvas.viewport.offsetX) / currentZoom,
      y: (clientPoint.y - rect.top - editor.canvas.viewport.offsetY) / currentZoom,
    };
  }

  const handleWindowPointerMove = useCallback((event: MouseEvent) => {
    const point = extractClientPoint(event);
    const ds = dragStateRef.current;
    const ps = panStateRef.current;
    const cs = connectionStateRef.current;

    if (ds) {
      const currentZoom = zoomRef.current;
      updateNodePosition(ds.nodeId, {
        x: ds.origin.x + (point.x - ds.startClientX) / currentZoom,
        y: ds.origin.y + (point.y - ds.startClientY) / currentZoom,
      });
      return;
    }

    if (ps) {
      setLocalEditor((prev) => ({
        ...prev,
        canvas: {
          ...prev.canvas,
          viewport: {
            offsetX: ps.offsetX + point.x - ps.startClientX,
            offsetY: ps.offsetY + point.y - ps.startClientY,
          },
        },
      }));
      return;
    }

    if (cs) {
      setConnectionState({ fromNodeId: cs.fromNodeId, pointer: resolveCanvasPoint(point) });
    }
  }, []);

  const handleWindowPointerUp = useCallback(() => {
    if (dragStateRef.current) {
      setDragState(null);
      onUpdateEditor(cloneEditor(localEditorRef.current));
    }
    if (panStateRef.current) {
      setPanState(null);
      onUpdateEditor(cloneEditor(localEditorRef.current));
    }
  }, [onUpdateEditor]);

  /** 绑定全局快捷键：Esc 取消连线，Delete/Backspace 删除选中节点或边。 */
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) return;

      if (event.key === "Escape") {
        if (connectionStateRef.current) {
          event.preventDefault();
          clearConnectionState();
        }
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();

      if (connectionStateRef.current) {
        clearConnectionState();
        return;
      }

      if (selectedEdgeId) {
        handleDeleteSelectedEdge();
        return;
      }

      if (selectedNodeId) {
        handleDeleteSelectedNode();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    window.addEventListener("mousemove", handleWindowPointerMove);
    window.addEventListener("mouseup", handleWindowPointerUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowPointerMove);
      window.removeEventListener("mouseup", handleWindowPointerUp);
    };
  }, [handleWindowPointerMove, handleWindowPointerUp]);

  function handleNodePointerDown(nodeId: string, event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (connectionStateRef.current) {
      clearConnectionState();
      return;
    }
    const point = extractClientPoint(event.nativeEvent);
    setDragState({
      nodeId,
      startClientX: point.x,
      startClientY: point.y,
      origin: getNodePosition(nodeId),
    });
  }

  function handleConnectionStart(nodeId: string, event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const point = extractClientPoint(event.nativeEvent);
    setConnectionState({ fromNodeId: nodeId, pointer: resolveCanvasPoint(point) });
  }

  function handleConnectionComplete(targetNodeId: string) {
    const cs = connectionStateRef.current;
    if (!cs || !canConnectToNode(targetNodeId)) {
      setConnectionState(null);
      return;
    }
    onConnectNode({ fromNodeId: cs.fromNodeId, toNodeId: targetNodeId });
    setConnectionState(null);
  }

  function handleStageMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(".workflow-node-card") ||
      target?.closest(".edge-hit-group") ||
      target?.closest(".selection-delete-btn") ||
      target?.closest(".canvas-minimap")
    ) {
      return;
    }
    if (connectionStateRef.current) {
      clearConnectionState();
      return;
    }
    setPanState({
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: localEditor.canvas.viewport.offsetX,
      offsetY: localEditor.canvas.viewport.offsetY,
    });
  }

  /** 处理画布滚轮缩放，并保持鼠标所在画布点不漂移。 */
  function handleStageWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const currentZoom = zoomRef.current;
    const nextZoom = clampZoom(currentZoom * (event.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR));
    if (Math.abs(nextZoom - currentZoom) < 0.001) return;

    const editor = localEditorRef.current;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const canvasX = (pointerX - editor.canvas.viewport.offsetX) / currentZoom;
    const canvasY = (pointerY - editor.canvas.viewport.offsetY) / currentZoom;
    const nextEditor: WorkflowEditorMetadata = {
      ...editor,
      canvas: {
        ...editor.canvas,
        viewport: {
          offsetX: pointerX - canvasX * nextZoom,
          offsetY: pointerY - canvasY * nextZoom,
        },
      },
    };

    setZoom(nextZoom);
    setLocalEditor(nextEditor);
    onUpdateEditor(cloneEditor(nextEditor));
    console.info("[workflow] 画布滚轮缩放", {
      zoom: Number(nextZoom.toFixed(2)),
      offsetX: Math.round(nextEditor.canvas.viewport.offsetX),
      offsetY: Math.round(nextEditor.canvas.viewport.offsetY),
    });
  }

  function handleStageDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".workflow-node-card") || target.closest(".edge-hit-group") || target.closest(".canvas-minimap")) return;
    clearConnectionState();
  }

  function handleSelectNode(nodeId: string) {
    if (connectionStateRef.current) {
      clearConnectionState();
      return;
    }
    onSelectNode(nodeId);
  }

  function handleSelectEdge(edgeId: string) {
    if (connectionStateRef.current) {
      clearConnectionState();
      return;
    }
    onSelectEdge(edgeId);
  }

  return (
    <section className="canvas-container" data-testid="workflow-canvas">
      <aside className="palette">
        <ul className="palette-list">
          {NODE_KIND_LIST.map((kind) => {
            const Icon = nodeIconMap[kind];
            const disabled = isAddDisabled(kind);
            return (
              <li key={kind}>
                <button
                  type="button"
                  className="palette-item"
                  disabled={disabled}
                  onClick={() => onAddNode(kind)}
                  title={getWorkflowNodeKindLabel(kind)}
                >
                  {Icon && <Icon className="kind-icon-svg" data-kind={kind} size={18} />}
                  <span className="kind-label">{nodeKindMap[kind] || kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="graph-stage-wrapper">
        <header className="stage-header">
          <div className="stage-header-main">
            {headerLeading && (
              <div className="stage-header-leading">
                {headerLeading}
              </div>
            )}
            <div className="graph-stats">
              <span className="stat-tag">{definition.nodes.length} 个节点</span>
              <span className="stat-tag">{definition.edges.length} 条连线</span>
            </div>
          </div>
        </header>

        <div className="graph-stage-shell">
          <div
            ref={stageRef}
            className="graph-stage"
            data-testid="workflow-canvas-stage"
            onMouseDown={handleStageMouseDown}
            onWheel={handleStageWheel}
            onDoubleClick={handleStageDoubleClick}
          >
            <div
              className="graph-stage-layer"
              data-testid="workflow-canvas-layer"
              style={{
                width: `${canvasWidth}px`,
                height: `${canvasHeight}px`,
                transform: `translate(${localEditor.canvas.viewport.offsetX}px, ${localEditor.canvas.viewport.offsetY}px) scale(${zoom})`,
              }}
            >
              <svg className="edge-overlay" width={canvasWidth} height={canvasHeight}>
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#60a5fa" />
                  </marker>
                  <marker id="arrowhead-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#60a5fa" />
                  </marker>
                  <marker id="arrowhead-conditional-true" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#10b981" />
                  </marker>
                  <marker id="arrowhead-conditional-false" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#ef4444" />
                  </marker>
                </defs>

                {renderedEdges.map((re) => (
                  <g key={re.edge.id} className="edge-hit-group" data-testid={`workflow-canvas-edge-${re.edge.id}`}>
                    <path
                      className={[
                        "edge-path",
                        re.edge.id === selectedEdgeId ? "active" : "",
                        re.conditionBranch ? `edge-${re.conditionBranch}` : "",
                        debugMode ? `edge-run-${getEdgeRunPhase(re)}` : "",
                      ].filter(Boolean).join(" ")}
                      d={re.path}
                      markerEnd={edgeMarker(re)}
                    />
                    <path
                      className="edge-hit"
                      d={re.path}
                      onClick={(e) => { e.stopPropagation(); handleSelectEdge(re.edge.id); }}
                    />
                    {re.edge.kind === "conditional" && (
                      <text className="edge-label-text" x={re.labelPos.x} y={re.labelPos.y} textAnchor="middle">
                        {re.conditionBranch === "true" ? "True" : "False"}
                      </text>
                    )}

                    {re.edge.id === selectedEdgeId && (
                      <foreignObject
                        x={re.labelPos.x - 16}
                        y={re.labelPos.y - 16}
                        width="32"
                        height="32"
                      >
                        <button
                          type="button"
                          data-testid={`workflow-canvas-edge-delete-${re.edge.id}`}
                          className="selection-delete-btn selection-delete-btn--edge"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSelectedEdge();
                          }}
                          aria-label="删除连线"
                          title="删除连线"
                        >
                          <Trash2 size={12} />
                        </button>
                      </foreignObject>
                    )}
                  </g>
                ))}

                {previewEdgePath && (
                  <path
                    data-testid="workflow-canvas-preview-edge"
                    className="edge-path edge-path--preview"
                    d={previewEdgePath}
                    markerEnd="url(#arrowhead)"
                  />
                )}
              </svg>

              {renderedNodes.map((rn) => {
                const Icon = nodeIconMap[rn.node.kind];
                const isTerminal = rn.node.kind === "start" || rn.node.kind === "end";
                const debugStatus = debugMode ? debugNodeStatuses?.get(rn.node.id) : undefined;
                const debugPhase = debugStatus?.phase;
                return (
                  <article
                    key={rn.node.id}
                    data-testid={`workflow-canvas-node-${rn.node.id}`}
                    data-node-id={rn.node.id}
                    data-kind={rn.node.kind}
                    data-debug-phase={debugPhase || undefined}
                    className={[
                      "workflow-node-card",
                      rn.node.id === selectedNodeId ? "active" : "",
                      dragState?.nodeId === rn.node.id ? "dragging" : "",
                      isTerminal ? "is-terminal" : "",
                      debugPhase ? `debug-${debugPhase}` : "",
                    ].filter(Boolean).join(" ")}
                    style={{
                      width: `${rn.width}px`,
                      height: `${rn.height}px`,
                      transform: `translate(${rn.position.x}px, ${rn.position.y}px)`,
                    }}
                    onClick={(e) => { e.stopPropagation(); handleSelectNode(rn.node.id); }}
                    onMouseDown={(e) => handleNodePointerDown(rn.node.id, e)}
                  >
                    {rn.node.kind !== "start" && (
                      <button
                        data-testid={`workflow-canvas-target-handle-${rn.node.id}`}
                        type="button"
                        className={`node-handle node-handle--target${isConnectionTarget(rn.node.id) ? " ready" : ""}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => { e.stopPropagation(); handleConnectionComplete(rn.node.id); }}
                      >
                        <span className="visually-hidden">目标端口</span>
                      </button>
                    )}

                    <div className="node-header">
                      <span className="node-kind-badge" data-kind={rn.node.kind}>
                        {Icon && <Icon size={12} />}
                        {nodeKindMap[rn.node.kind] || rn.node.kind}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        {rn.node.id === definition.entryNodeId && (
                          <span className="entry-star" title="入口节点">
                            <Play size={10} />
                          </span>
                        )}
                        {debugPhase === "running" && (
                          <span className="debug-badge debug-badge--running" title="运行中">
                            <Loader size={10} />
                          </span>
                        )}
                        {debugPhase === "streaming" && (
                          <span className="debug-badge debug-badge--streaming" title="流式输出中">
                            <Loader size={10} />
                          </span>
                        )}
                        {debugPhase === "completed" && (
                          <span className="debug-badge debug-badge--completed" title={`已完成${debugStatus?.durationMs ? ` (${debugStatus.durationMs}ms)` : ""}`}>
                            <Check size={10} />
                          </span>
                        )}
                        {debugPhase === "error" && (
                          <span className="debug-badge debug-badge--error" title={debugStatus?.error || "错误"}>
                            <AlertCircle size={10} />
                          </span>
                        )}
                        {debugPhase === "interrupted" && (
                          <span className="debug-badge debug-badge--interrupted" title="已中断">
                            <Pause size={10} />
                          </span>
                        )}
                      </span>
                    </div>

                    {rn.node.id === selectedNodeId && (
                      <button
                        type="button"
                        data-testid={`workflow-canvas-node-delete-${rn.node.id}`}
                        className="selection-delete-btn selection-delete-btn--node"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSelectedNode();
                        }}
                        aria-label="删除节点"
                        title={isDeleteNodeDisabled ? "入口节点不能删除" : "删除节点"}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}

                    <div className="node-content">
                      <h4 className="node-label">{rn.node.label}</h4>
                      {rn.node.kind !== "start" && rn.node.kind !== "end" && (
                        <p
                          className="node-summary"
                          data-testid={`workflow-canvas-node-summary-${rn.node.id}`}
                        >
                          {debugPhase === "streaming" && debugStatus?.content
                            ? clipSummary(debugStatus.content, 80)
                            : debugPhase === "completed" && debugStatus?.outputs
                              ? summarizeDebugOutputs(debugStatus.outputs) || nodeSummary(rn.node)
                            : debugPhase === "error" && debugStatus?.error
                              ? clipSummary(debugStatus.error, 80)
                              : nodeSummary(rn.node)}
                        </p>
                      )}
                    </div>

                    {rn.node.kind !== "end" && (
                      <button
                        data-testid={`workflow-canvas-source-handle-${rn.node.id}`}
                        type="button"
                        className={`node-handle node-handle--source${connectionState?.fromNodeId === rn.node.id ? " active" : ""}`}
                        onMouseDown={(e) => { e.stopPropagation(); handleConnectionStart(rn.node.id, e); }}
                      >
                        <span className="visually-hidden">源端口</span>
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            <aside
              className="canvas-minimap"
              data-testid="workflow-canvas-minimap"
              aria-label="全景视图"
            >
              <div className="minimap-header">
                <span>全景视图</span>
                <span data-testid="workflow-canvas-zoom-label">{Math.round(zoom * 100)}%</span>
              </div>
              <div className="minimap-body">
                {renderedNodes.map((rn) => (
                  <span
                    key={rn.node.id}
                    className={`minimap-node${rn.node.id === selectedNodeId ? " active" : ""}`}
                    style={{
                      left: `${MINIMAP_PADDING + rn.position.x * minimapScale}px`,
                      top: `${MINIMAP_PADDING + rn.position.y * minimapScale}px`,
                      width: `${Math.max(8, rn.width * minimapScale)}px`,
                      height: `${Math.max(6, rn.height * minimapScale)}px`,
                    }}
                  />
                ))}
                <span
                  className="minimap-viewport"
                  style={{
                    left: `${minimapViewport.x}px`,
                    top: `${minimapViewport.y}px`,
                    width: `${minimapViewport.width}px`,
                    height: `${minimapViewport.height}px`,
                  }}
                />
              </div>
            </aside>
          </div>
        </div>

        {graphIssues.length > 0 && (
          <div data-testid="workflow-canvas-graph-issues" className="graph-issues-banner">
            {graphIssues.join("; ")}
          </div>
        )}

        {actionHint && (
          <div data-testid="workflow-canvas-action-hint" className="hint-toast">
            {actionHint}
          </div>
        )}
      </div>

      <style>{`
        .canvas-container {
          display: flex;
          height: 100%;
          width: 100%;
          min-width: 0;
          min-height: 0;
          background: #0d0d0f;
          outline: none;
        }
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
          justify-content: flex-start;
          padding: 0 16px;
          z-index: 15;
        }
        .stage-header-main {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .stage-header-leading {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
        }
        .graph-stats {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .stat-tag {
          font-size: 12px;
          color: #71717a;
          background: #09090b;
          padding: 3px 9px;
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
        .btn-danger-sm:hover:not(:disabled) { background: #ef4444; color: white; }
        .btn-danger-sm:disabled { opacity: 0.3; cursor: not-allowed; }
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
        .graph-stage:active { cursor: grabbing; }
        .graph-stage-layer {
          position: absolute;
          top: 0;
          left: 0;
          transform-origin: top left;
        }
        .canvas-minimap {
          position: absolute;
          right: 16px;
          bottom: 16px;
          width: ${MINIMAP_WIDTH}px;
          border: 1px solid rgba(82, 82, 91, 0.82);
          border-radius: 8px;
          background: rgba(18, 18, 20, 0.92);
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.32);
          z-index: 80;
          overflow: hidden;
          user-select: none;
        }
        .minimap-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 28px;
          padding: 0 9px;
          color: #d4d4d8;
          font-size: 12px;
          font-weight: 700;
          border-bottom: 1px solid rgba(82, 82, 91, 0.62);
        }
        .minimap-header [data-testid="workflow-canvas-zoom-label"] {
          color: #93c5fd;
          font-variant-numeric: tabular-nums;
        }
        .minimap-body {
          position: relative;
          width: ${MINIMAP_WIDTH}px;
          height: ${MINIMAP_BODY_HEIGHT}px;
          background: #0a0a0b;
        }
        .minimap-node {
          position: absolute;
          border-radius: 3px;
          background: rgba(96, 165, 250, 0.5);
          border: 1px solid rgba(147, 197, 253, 0.75);
          box-sizing: border-box;
        }
        .minimap-node.active {
          background: rgba(16, 185, 129, 0.68);
          border-color: rgba(110, 231, 183, 0.95);
        }
        .minimap-viewport {
          position: absolute;
          border: 1px solid #f8fafc;
          background: rgba(248, 250, 252, 0.08);
          box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.68);
          box-sizing: border-box;
        }
        .edge-overlay {
          position: absolute;
          inset: 0;
          overflow: visible;
          pointer-events: none;
        }
        .edge-hit-group { pointer-events: auto; }
        .edge-path {
          fill: none;
          stroke: rgba(113, 113, 122, 0.44);
          stroke-width: 2px;
          transition: stroke 0.2s, stroke-width 0.2s, opacity 0.2s;
        }
        .edge-path.active { stroke: #60a5fa; stroke-width: 2.5px; }
        .edge-path.edge-true { stroke: rgba(16, 185, 129, 0.7); }
        .edge-path.edge-false { stroke: rgba(239, 68, 68, 0.7); }
        .edge-path--preview { stroke-dasharray: 8 6; }
        .edge-path.edge-run-idle {
          stroke: rgba(82, 82, 91, 0.48);
          stroke-dasharray: 7 7;
          opacity: 0.72;
        }
        .edge-path.edge-run-flowing {
          stroke: #60a5fa;
          stroke-width: 2.6px;
          stroke-dasharray: 8 7;
          animation: workflow-edge-flow 0.9s linear infinite;
          filter: drop-shadow(0 0 5px rgba(96, 165, 250, 0.42));
        }
        .edge-path.edge-run-completed {
          stroke: #10b981;
          stroke-width: 2.5px;
          stroke-dasharray: none;
          filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.28));
        }
        .edge-path.edge-run-error {
          stroke: #ef4444;
          stroke-width: 2.8px;
          stroke-dasharray: 5 5;
          filter: drop-shadow(0 0 5px rgba(239, 68, 68, 0.36));
        }
        @keyframes workflow-edge-flow {
          to { stroke-dashoffset: -15; }
        }
        .edge-hit { fill: none; stroke: transparent; stroke-width: 18px; }
        .edge-label-text {
          fill: #a1a1aa;
          font-size: 10px;
          font-weight: 600;
          pointer-events: none;
        }
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
          overflow: visible;
        }
        .workflow-node-card.is-terminal { border-radius: 24px; text-align: center; }
        .workflow-node-card.is-terminal .node-header { justify-content: center; border-bottom: none; padding: 6px 12px; }
        .workflow-node-card.is-terminal .node-content { padding: 0 12px 6px; align-items: center; }
        .workflow-node-card[data-kind="llm"] { border-top: 2px solid #10b981; }
        .workflow-node-card[data-kind="tool"] { border-top: 2px solid #3b82f6; }
        .workflow-node-card[data-kind="human-input"] { border-top: 2px solid #f97316; }
        .workflow-node-card[data-kind="condition"] { border-top: 2px solid #8b5cf6; }
        .workflow-node-card[data-kind="subgraph"] { border-top: 2px solid #14b8a6; }
        .workflow-node-card[data-kind="join"] { border-top: 2px solid #eab308; }
        .workflow-node-card[data-kind="start"] { border-top: 2px solid #f59e0b; }
        .workflow-node-card[data-kind="end"] { border-top: 2px solid #ef4444; }
        .workflow-node-card:hover { border-color: #3b82f6; background: #1a1a1d; }
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
        .entry-star { color: #f59e0b; font-size: 10px; }
        .node-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px 12px 8px;
        }
        .selection-delete-btn {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid rgba(239, 68, 68, 0.35);
          background: rgba(17, 17, 19, 0.95);
          color: #f87171;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          z-index: 20;
        }
        .workflow-node-card.active .selection-delete-btn,
        .edge-hit-group .selection-delete-btn {
          opacity: 1;
          pointer-events: auto;
        }
        .selection-delete-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          pointer-events: none;
        }
        .selection-delete-btn:hover {
          background: #7f1d1d;
          color: #fff;
          border-color: #ef4444;
        }
        .selection-delete-btn--edge {
          position: relative;
          top: auto;
          right: auto;
        }
        .node-label {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: #f4f4f5;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .node-summary {
          margin: 0;
          font-size: 11px;
          line-height: 1.4;
          color: #71717a;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          word-break: break-all;
        }
        .node-handle {
          position: absolute;
          left: 50%;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 2px solid #3f3f46;
          background: #18181b;
          transform: translateX(-50%);
          cursor: crosshair;
          transition: all 0.15s;
          z-index: 5;
          box-sizing: border-box;
        }
        .node-handle--target { top: -10px; }
        .node-handle--source { bottom: -10px; }
        .node-handle.ready {
          border-color: #10b981;
          background: #065f46;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
          width: 18px;
          height: 18px;
          top: -10px;
        }
        .node-handle.active,
        .workflow-node-card:hover .node-handle {
          border-color: #60a5fa;
          background: #1d4ed8;
        }
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
        .stage-actions {
          display: flex;
          gap: 8px;
        }

        .workflow-node-card.debug-running {
          border-color: #3b82f6;
          box-shadow: 0 0 0 1px #3b82f6, 0 0 12px rgba(59, 130, 246, 0.3);
          animation: debug-node-pulse 2s ease-in-out infinite;
        }

        .workflow-node-card.debug-streaming {
          border-color: #8b5cf6;
          box-shadow: 0 0 0 1px #8b5cf6, 0 0 12px rgba(139, 92, 246, 0.3);
          animation: debug-node-pulse 1.5s ease-in-out infinite;
        }

        .workflow-node-card.debug-completed {
          border-color: #10b981;
          box-shadow: 0 0 0 1px #10b981, 0 0 8px rgba(16, 185, 129, 0.2);
        }

        .workflow-node-card.debug-error {
          border-color: #ef4444;
          box-shadow: 0 0 0 1px #ef4444, 0 0 8px rgba(239, 68, 68, 0.3);
        }

        .workflow-node-card.debug-interrupted {
          border-color: #f59e0b;
          box-shadow: 0 0 0 1px #f59e0b, 0 0 8px rgba(245, 158, 11, 0.2);
        }

        @keyframes debug-node-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.75; }
        }

        .debug-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .debug-badge--running {
          color: #3b82f6;
          animation: debug-spin 1.2s linear infinite;
        }

        .debug-badge--streaming {
          color: #8b5cf6;
          animation: debug-spin 1s linear infinite;
        }

        .debug-badge--completed {
          color: #10b981;
        }

        .debug-badge--error {
          color: #ef4444;
        }

        .debug-badge--interrupted {
          color: #f59e0b;
        }

        @keyframes debug-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}
