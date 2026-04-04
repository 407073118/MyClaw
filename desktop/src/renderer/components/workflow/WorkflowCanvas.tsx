import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeKind } from "@shared/contracts";
import { Play, MessageCircle, Wrench, User, GitBranch, Network, Merge, Square } from "lucide-react";

import {
  buildFallbackNodeLayouts,
  computeEdgeAnchorPoints,
  findNodeLayout,
  type WorkflowCanvasNodeLayout,
  type WorkflowCanvasPoint,
} from "./workflow-canvas-geometry";
import { getWorkflowNodeKindLabel, isGeneratedScopedReference } from "./workflow-node-factory";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 88;
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

interface WorkflowCanvasProps {
  definition: WorkflowDefinition;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  feedbackMessage?: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAddNode: (kind: WorkflowNodeKind) => void;
  onConnectNode: (payload: { fromNodeId: string; toNodeId: string }) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onUpdateEditor: (editor: WorkflowEditorMetadata) => void;
}

const NODE_KIND_LIST: WorkflowNodeKind[] = ["start", "llm", "tool", "human-input", "condition", "subgraph", "join", "end"];

const nodeKindMap: Record<string, string> = Object.fromEntries(
  NODE_KIND_LIST.map((kind) => [kind, getWorkflowNodeKindLabel(kind)]),
);

const nodeIconMap: Record<string, React.ElementType> = {
  start: Play,
  llm: MessageCircle,
  tool: Wrench,
  "human-input": User,
  condition: GitBranch,
  subgraph: Network,
  join: Merge,
  end: Square,
};

/** 根据节点类型返回画布节点的默认尺寸。 */
function getNodeDimensions(kind: string) {
  if (kind === "start" || kind === "end") {
    return { width: TERMINAL_NODE_WIDTH, height: TERMINAL_NODE_HEIGHT };
  }
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

/** 解析工作流定义中的 editor 字段，缺省时生成回退布局。 */
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

/** 深拷贝 editor 数据，避免拖拽过程直接污染上游状态。 */
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

/** 为连线生成三次贝塞尔曲线路径。 */
function buildEdgePath(start: WorkflowCanvasPoint, end: WorkflowCanvasPoint): string {
  const controlOffset = Math.max(EDGE_CURVE_OFFSET, Math.abs(end.y - start.y) * 0.35);
  return [
    `M ${start.x} ${start.y}`,
    `C ${start.x} ${start.y + controlOffset}, ${end.x} ${end.y - controlOffset}, ${end.x} ${end.y}`,
  ].join(" ");
}

/** 裁剪节点摘要长度，避免画布卡片被长文本撑爆。 */
function clipSummary(text: string, maxLength = 64) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

/** 生成条件节点的摘要文案，方便在画布上快速浏览。 */
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

/** 生成节点摘要文案，按节点种类展示最关键配置。 */
function nodeSummary(node: WorkflowNode): string {
  if (node.kind === "start") return "入口节点";
  if (node.kind === "end") return "结束节点";
  if (node.kind === "llm") {
    if (!node.llm.prompt || node.llm.prompt.includes("请补充") || node.llm.prompt.includes("请根据当前状态")) {
      return "待配置个性";
    }
    return clipSummary(node.llm.prompt || "未配置个性");
  }
  if (node.kind === "tool") {
    if (isGeneratedScopedReference("tool", node.id, node.tool.toolId)) return "待选择工具";
    return clipSummary(node.tool.toolId || "未配置工具");
  }
  if (node.kind === "human-input") {
    if (isGeneratedScopedReference("form", node.id, node.humanInput.formKey)) return "待配置人工输入结果字段";
    return clipSummary(`结果字段:${node.humanInput.formKey || "-"}`);
  }
  if (node.kind === "subgraph") {
    if (isGeneratedScopedReference("workflow", node.id, node.subgraph.workflowId)) return "待选择子工作流";
    return clipSummary(`子流:${node.subgraph.workflowId || "-"}`);
  }
  if (node.kind === "join") {
    return clipSummary(`${node.join.mode === "all" ? "等待全部" : "任一即可"} | ${node.join.upstreamNodeIds.length} 个上游`);
  }
  if (node.kind === "condition") return conditionNodeSummary(node as WorkflowConditionCarrier);
  return clipSummary((node as WorkflowNode).kind);
}

/** 渲染工作流画布，并处理拖拽、连线、平移等交互。 */
export default function WorkflowCanvas({
  definition,
  selectedNodeId: propSelectedNodeId = null,
  selectedEdgeId: propSelectedEdgeId = null,
  feedbackMessage = null,
  onSelectNode,
  onSelectEdge,
  onAddNode,
  onConnectNode,
  onDeleteNode,
  onDeleteEdge,
  onUpdateEditor,
}: WorkflowCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [localEditor, setLocalEditor] = useState<WorkflowEditorMetadata>(() => createResolvedEditor(definition));

  // 为事件处理器保留可变引用，避免闭包拿到过期状态。
  const dragStateRef = useRef(dragState);
  const panStateRef = useRef(panState);
  const connectionStateRef = useRef(connectionState);
  const localEditorRef = useRef(localEditor);
  dragStateRef.current = dragState;
  panStateRef.current = panState;
  connectionStateRef.current = connectionState;
  localEditorRef.current = localEditor;

  const selectedNodeId = propSelectedNodeId ?? null;
  const selectedEdgeId = propSelectedEdgeId ?? null;
  const isDeleteNodeDisabled = selectedNodeId === definition.entryNodeId;

  // 工作流定义变化后，重建本地 editor 状态并清空交互上下文。
  useEffect(() => {
    setLocalEditor(createResolvedEditor(definition));
    setDragState(null);
    setPanState(null);
    setConnectionState(null);
  }, [definition]);

  /** 获取指定节点在画布中的当前位置，缺省时退回到稳定默认值。 */
  function getNodePosition(nodeId: string): WorkflowCanvasPoint {
    const existingLayout = findNodeLayout(localEditor.canvas.nodes, nodeId);
    if (existingLayout) return existingLayout.position;
    const fallbackLayout = buildFallbackNodeLayouts(definition.nodes.map((node) => node.id)).find(
      (layout) => layout.nodeId === nodeId,
    );
    return fallbackLayout?.position ?? { x: 300, y: 60 };
  }

  /** 统计节点的出边数量。 */
  function countOutgoingEdges(nodeId: string) {
    return definition.edges.filter((edge) => edge.fromNodeId === nodeId).length;
  }

  /** 按节点 ID 查询工作流节点。 */
  function findWorkflowNode(nodeId: string) {
    return definition.nodes.find((node) => node.id === nodeId) ?? null;
  }

  /** 更新节点在画布中的位置，并同步 editor 草稿。 */
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

  const canvasWidth = useMemo(
    () => renderedNodes.reduce((maxX, rn) => Math.max(maxX, rn.position.x + rn.width + 240), MIN_CANVAS_WIDTH),
    [renderedNodes],
  );

  const canvasHeight = useMemo(
    () => renderedNodes.reduce((maxY, rn) => Math.max(maxY, rn.position.y + rn.height + 240), MIN_CANVAS_HEIGHT),
    [renderedNodes],
  );

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
      issues.push(`entryNodeId: missing "${definition.entryNodeId}"`);
    }

    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        issues.push(`edge: "${edge.id}" references missing node`);
      }
    }

    for (const node of definition.nodes) {
      if (node.kind !== "join") continue;
      const incoming = new Set(
        definition.edges.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.fromNodeId),
      );
      const invalidUpstreams = node.join.upstreamNodeIds.filter((nodeId) => !incoming.has(nodeId));
      if (invalidUpstreams.length) {
        issues.push(`join: "${node.id}" upstream missing ${invalidUpstreams.join(", ")}`);
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
  }, [definition]);

  const actionHint = useMemo(() => {
    if (feedbackMessage) return feedbackMessage;
    if (connectionState) return "拖到目标节点顶部端口即可创建连线";
    if (!selectedNodeId) return "先选择一个节点，再添加 Join 或拖出新连线";
    if (isDeleteNodeDisabled) return "入口节点不能删除";
    return "";
  }, [feedbackMessage, connectionState, selectedNodeId, isDeleteNodeDisabled]);

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
    return {
      x: clientPoint.x - rect.left - editor.canvas.viewport.offsetX,
      y: clientPoint.y - rect.top - editor.canvas.viewport.offsetY,
    };
  }

  const handleWindowPointerMove = useCallback((event: MouseEvent) => {
    const point = extractClientPoint(event);
    const ds = dragStateRef.current;
    const ps = panStateRef.current;
    const cs = connectionStateRef.current;

    if (ds) {
      updateNodePosition(ds.nodeId, {
        x: ds.origin.x + point.x - ds.startClientX,
        y: ds.origin.y + point.y - ds.startClientY,
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
      const rect = stageRef.current?.getBoundingClientRect();
      const editor = localEditorRef.current;
      const canvasPoint = rect
        ? {
            x: point.x - rect.left - editor.canvas.viewport.offsetX,
            y: point.y - rect.top - editor.canvas.viewport.offsetY,
          }
        : point;
      setConnectionState((prev) => (prev ? { ...prev, pointer: canvasPoint } : null));
    }
  }, []);

  const handleWindowPointerUp = useCallback(() => {
    const hadDrag = Boolean(dragStateRef.current || panStateRef.current);
    setDragState(null);
    setPanState(null);
    setConnectionState(null);
    window.removeEventListener("mousemove", handleWindowPointerMove);
    window.removeEventListener("mouseup", handleWindowPointerUp);

    if (hadDrag) {
      onUpdateEditor(cloneEditor(localEditorRef.current));
    }
  }, [handleWindowPointerMove, onUpdateEditor]);

  function beginInteraction() {
    window.removeEventListener("mousemove", handleWindowPointerMove);
    window.removeEventListener("mouseup", handleWindowPointerUp);
    window.addEventListener("mousemove", handleWindowPointerMove);
    window.addEventListener("mouseup", handleWindowPointerUp);
  }

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleWindowPointerMove);
      window.removeEventListener("mouseup", handleWindowPointerUp);
    };
  }, [handleWindowPointerMove, handleWindowPointerUp]);

  function handleNodePointerDown(nodeId: string, event: React.MouseEvent) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest(".node-handle")) return;
    const point = { x: event.clientX, y: event.clientY };
    setDragState({
      nodeId,
      startClientX: point.x,
      startClientY: point.y,
      origin: { ...getNodePosition(nodeId) },
    });
    onSelectNode(nodeId);
    beginInteraction();
  }

  function handleStagePointerDown(event: React.MouseEvent) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("[data-node-id], [data-edge-id], .edge-item")) return;
    const point = { x: event.clientX, y: event.clientY };
    setPanState({
      startClientX: point.x,
      startClientY: point.y,
      offsetX: localEditor.canvas.viewport.offsetX,
      offsetY: localEditor.canvas.viewport.offsetY,
    });
    beginInteraction();
  }

  function handleConnectionStart(nodeId: string, event: React.MouseEvent) {
    if (event.button !== 0) return;
    const node = findWorkflowNode(nodeId);
    if (!node || node.kind === "end") return;
    const rect = stageRef.current?.getBoundingClientRect();
    const canvasPoint = rect
      ? {
          x: event.clientX - rect.left - localEditor.canvas.viewport.offsetX,
          y: event.clientY - rect.top - localEditor.canvas.viewport.offsetY,
        }
      : { x: event.clientX, y: event.clientY };
    setConnectionState({ fromNodeId: nodeId, pointer: canvasPoint });
    onSelectNode(nodeId);
    beginInteraction();
  }

  function handleConnectionComplete(nodeId: string) {
    const cs = connectionStateRef.current;
    if (!cs || !canConnectToNode(nodeId)) {
      setConnectionState(null);
      window.removeEventListener("mousemove", handleWindowPointerMove);
      window.removeEventListener("mouseup", handleWindowPointerUp);
      return;
    }
    onConnectNode({ fromNodeId: cs.fromNodeId, toNodeId: nodeId });
    setConnectionState(null);
    window.removeEventListener("mousemove", handleWindowPointerMove);
    window.removeEventListener("mouseup", handleWindowPointerUp);
  }

  function handleCanvasKeydown(event: React.KeyboardEvent) {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (selectedEdgeId) {
      event.preventDefault();
      onDeleteEdge(selectedEdgeId);
      return;
    }
    if (selectedNodeId && !isDeleteNodeDisabled) {
      event.preventDefault();
      onDeleteNode(selectedNodeId);
    }
  }

  const stageLayerStyle: React.CSSProperties = {
    width: `${canvasWidth}px`,
    height: `${canvasHeight}px`,
    transform: `translate(${localEditor.canvas.viewport.offsetX}px, ${localEditor.canvas.viewport.offsetY}px)`,
  };

  return (
    <section
      data-testid="workflow-canvas"
      className="canvas-container"
      tabIndex={0}
      onKeyDown={handleCanvasKeydown}
    >
      <aside className="palette" data-testid="workflow-canvas-palette">
        <ul className="palette-list">
          {NODE_KIND_LIST.map((kind) => {
            const Icon = nodeIconMap[kind];
            return (
              <li key={kind}>
                <button
                  data-testid={`workflow-canvas-add-node-${kind}`}
                  type="button"
                  className="palette-item"
                  disabled={isAddDisabled(kind)}
                  onClick={() => !isAddDisabled(kind) && onAddNode(kind)}
                  title={nodeKindMap[kind] || kind}
                >
                  <Icon className="kind-icon-svg" data-kind={kind} size={20} />
                  <span className="kind-label">{nodeKindMap[kind] || kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="graph-stage-wrapper">
        <header className="stage-header">
          <div className="graph-stats">
            <span className="stat-tag">{definition.nodes.length} 节点</span>
            <span className="stat-tag">{definition.edges.length} 连线</span>
            {graphIssues.length > 0 && (
              <span data-testid="workflow-canvas-graph-status" className="stat-tag stat-tag--warn">
                {graphIssues.length} 问题
              </span>
            )}
          </div>
          <div className="stage-actions">
            {selectedEdgeId && (
              <button
                data-testid="workflow-canvas-delete-edge"
                type="button"
                className="btn-danger-sm"
                onClick={() => onDeleteEdge(selectedEdgeId)}
              >
                删除连线
              </button>
            )}
            {selectedNodeId && (
              <button
                data-testid="workflow-canvas-delete-node"
                type="button"
                className="btn-danger-sm"
                disabled={isDeleteNodeDisabled}
                onClick={() => onDeleteNode(selectedNodeId)}
              >
                删除节点
              </button>
            )}
          </div>
        </header>

        <div className="graph-stage-shell">
          <div
            ref={stageRef}
            data-testid="workflow-canvas-stage"
            className="graph-stage"
            onMouseDown={handleStagePointerDown}
          >
            <div data-testid="workflow-canvas-stage-layer" className="graph-stage-layer" style={stageLayerStyle}>
              <svg className="edge-overlay" width={canvasWidth} height={canvasHeight}>
                <defs>
                  <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 4 L 0 8 Z" fill="rgba(96,165,250,0.55)" />
                  </marker>
                  <marker id="arrowhead-active" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 4 L 0 8 Z" fill="#60a5fa" />
                  </marker>
                  <marker id="arrowhead-conditional-true" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 4 L 0 8 Z" fill="rgba(16,185,129,0.7)" />
                  </marker>
                  <marker id="arrowhead-conditional-false" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 4 L 0 8 Z" fill="rgba(239,68,68,0.7)" />
                  </marker>
                </defs>

                {renderedEdges.map((re) => (
                  <g
                    key={re.edge.id}
                    data-testid={`workflow-canvas-edge-${re.edge.id}`}
                    data-edge-id={re.edge.id}
                    className="edge-hit-group"
                    onClick={(e) => { e.stopPropagation(); onSelectEdge(re.edge.id); }}
                  >
                    <path
                      className={[
                        "edge-path",
                        re.edge.id === selectedEdgeId ? "active" : "",
                        re.conditionBranch === "true" ? "edge-true" : "",
                        re.conditionBranch === "false" ? "edge-false" : "",
                      ].filter(Boolean).join(" ")}
                      d={re.path}
                      markerEnd={edgeMarker(re)}
                    />
                    <path className="edge-hit" d={re.path} />
                    {re.conditionBranch && (
                      <text className="edge-label-text" x={re.labelPos.x} y={re.labelPos.y} textAnchor="middle">
                        {re.conditionBranch === "true" ? "True" : "False"}
                      </text>
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
                return (
                  <article
                    key={rn.node.id}
                    data-testid={`workflow-canvas-node-${rn.node.id}`}
                    data-node-id={rn.node.id}
                    data-kind={rn.node.kind}
                    className={[
                      "workflow-node-card",
                      rn.node.id === selectedNodeId ? "active" : "",
                      dragState?.nodeId === rn.node.id ? "dragging" : "",
                      isTerminal ? "is-terminal" : "",
                    ].filter(Boolean).join(" ")}
                    style={{
                      width: `${rn.width}px`,
                      height: `${rn.height}px`,
                      transform: `translate(${rn.position.x}px, ${rn.position.y}px)`,
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelectNode(rn.node.id); }}
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
                        <span className="visually-hidden">Target handle</span>
                      </button>
                    )}

                    <div className="node-header">
                      <span className="node-kind-badge" data-kind={rn.node.kind}>
                        {Icon && <Icon size={12} />}
                        {nodeKindMap[rn.node.kind] || rn.node.kind}
                      </span>
                      {rn.node.id === definition.entryNodeId && (
                        <span className="entry-star" title="入口节点">
                          <Play size={10} />
                        </span>
                      )}
                    </div>

                    <div className="node-content">
                      <h4 className="node-label">{rn.node.label}</h4>
                      {rn.node.kind !== "start" && rn.node.kind !== "end" && (
                        <p
                          className="node-summary"
                          data-testid={`workflow-canvas-node-summary-${rn.node.id}`}
                        >
                          {nodeSummary(rn.node)}
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
                        <span className="visually-hidden">Source handle</span>
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
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
        .edge-overlay {
          position: absolute;
          inset: 0;
          overflow: visible;
          pointer-events: none;
        }
        .edge-hit-group { pointer-events: auto; }
        .edge-path {
          fill: none;
          stroke: rgba(96, 165, 250, 0.55);
          stroke-width: 2px;
          transition: stroke 0.2s;
        }
        .edge-path.active { stroke: #60a5fa; stroke-width: 2.5px; }
        .edge-path.edge-true { stroke: rgba(16, 185, 129, 0.7); }
        .edge-path.edge-false { stroke: rgba(239, 68, 68, 0.7); }
        .edge-path--preview { stroke-dasharray: 8 6; }
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
          overflow: hidden;
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
        .node-handle--target { top: -7px; }
        .node-handle--source { bottom: -7px; }
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
      `}</style>
    </section>
  );
}
