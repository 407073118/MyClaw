import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Bug, ChevronDown, ChevronLeft, PanelRight, Play, Save, Square, ToggleLeft, ToggleRight } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import { useWorkflowRunsStore, type NodeLiveStatus } from "../stores/workflow-runs";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowNodeKind, WorkflowInterruptPayload } from "@shared/contracts";
import WorkflowCanvas from "../components/workflow/WorkflowCanvas";
import WorkflowGraphInspector from "../components/workflow/WorkflowGraphInspector";
import WorkflowRunPanel from "../components/workflow/WorkflowRunPanel";
import { WorkflowDebugPanel } from "../components/workflow/WorkflowDebugPanel";
import { createWorkflowNodeDraft } from "../components/workflow/workflow-node-factory";

// ── Types ─────────────────────────────────────────────────────────────────────

type StudioMode = "edit" | "debug";

/** 每个节点在调试期间的运行状态。 */
export interface DebugNodeStatus {
  phase: "idle" | "running" | "streaming" | "completed" | "error" | "interrupted";
  content?: string;
  durationMs?: number;
  error?: string;
}

/** 将 store 的 NodeLiveStatus 映射为 Canvas 使用的 DebugNodeStatus。 */
function toDebugNodeStatus(live: NodeLiveStatus): DebugNodeStatus {
  switch (live.phase) {
    case "idle":
      return { phase: "idle" };
    case "running":
      return { phase: "running" };
    case "streaming":
      return { phase: "streaming", content: live.content };
    case "completed":
      return { phase: "completed", durationMs: live.durationMs };
    case "error":
      return { phase: "error", error: live.error };
    case "interrupted":
      return { phase: "interrupted" };
    default:
      return { phase: "idle" };
  }
}

/** 将 store 的 nodeStatuses Map 批量映射为 Canvas 使用的 DebugNodeStatus Map。 */
function toDebugNodeStatusMap(
  source: Map<string, NodeLiveStatus>,
): Map<string, DebugNodeStatus> {
  const result = new Map<string, DebugNodeStatus>();
  source.forEach((status, nodeId) => {
    result.set(nodeId, toDebugNodeStatus(status));
  });
  return result;
}

interface WorkflowCanvasNodeLayout {
  nodeId: string;
  position: { x: number; y: number };
}

// ── Status display map ────────────────────────────────────────────────────────

const statusMap: Record<string, string> = {
  draft: "草稿",
  active: "已启用",
  archived: "已归档",
};

// ── Canvas geometry helpers (same logic as Vue source) ────────────────────────

function cleanupNodeLayouts(
  layouts: WorkflowCanvasNodeLayout[],
  validNodeIds: Set<string>,
): WorkflowCanvasNodeLayout[] {
  return layouts.filter((layout) => validNodeIds.has(layout.nodeId));
}

function computeNextNodePosition(opts: {
  layouts: WorkflowCanvasNodeLayout[];
  upstreamNodeId?: string;
  fallbackIndex: number;
}): { x: number; y: number } {
  const { layouts, upstreamNodeId, fallbackIndex } = opts;
  if (upstreamNodeId) {
    const upstream = layouts.find((l) => l.nodeId === upstreamNodeId);
    if (upstream) {
      return { x: upstream.position.x + 280, y: upstream.position.y };
    }
  }
  return { x: 100 + (fallbackIndex % 4) * 280, y: 100 + Math.floor(fallbackIndex / 4) * 180 };
}

// ── Workflow graph helpers ────────────────────────────────────────────────────

function reconcileConditionNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.kind !== "condition") return node;
    const outgoingTargetIds = new Set(
      edges.filter((e) => e.fromNodeId === node.id).map((e) => e.toNodeId),
    );
    const trueNodeId = node.route?.trueNodeId;
    const falseNodeId = node.route?.falseNodeId;
    const nextRoute = {
      ...(trueNodeId && outgoingTargetIds.has(trueNodeId) ? { trueNodeId } : {}),
      ...(falseNodeId && outgoingTargetIds.has(falseNodeId) ? { falseNodeId } : {}),
    };
    if (!Object.keys(nextRoute).length) {
      const { route: _route, ...rest } = node as WorkflowNode & { route?: unknown };
      return rest as WorkflowNode;
    }
    return { ...node, route: nextRoute };
  });
}

type JoinReconcileResult = { nodes: WorkflowNode[]; blockedJoinIds: string[] };

function reconcileJoinNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): JoinReconcileResult {
  const blockedJoinIds: string[] = [];
  const nextNodes = nodes.map((node) => {
    if (node.kind !== "join") return node;
    const incomingSources = new Set(
      edges.filter((e) => e.toNodeId === node.id).map((e) => e.fromNodeId),
    );
    const upstreamNodeIds = node.join.upstreamNodeIds.filter((id: string) =>
      incomingSources.has(id),
    );
    if (upstreamNodeIds.length === 0) {
      blockedJoinIds.push(node.id);
      return node;
    }
    return { ...node, join: { ...node.join, upstreamNodeIds } };
  });
  return { nodes: blockedJoinIds.length > 0 ? nodes : nextNodes, blockedJoinIds };
}

// ── WorkflowStudioPage ────────────────────────────────────────────────────────

export default function WorkflowStudioPage() {
  const { id: paramId = "" } = useParams<{ id: string }>();
  const workspace = useWorkspaceStore();

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [definitionError, setDefinitionError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [canvasFeedback, setCanvasFeedbackState] = useState("");
  const [showRunPanel, setShowRunPanel] = useState(false);
  const [showInspector, setShowInspector] = useState(true);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatus, setDraftStatus] = useState<"draft" | "active" | "archived">("draft");
  const [draftSource, setDraftSource] = useState<"personal" | "enterprise" | "hub">("personal");

  // ── Debug mode state ──────────────────────────────────────────────────────
  const [studioMode, setStudioMode] = useState<StudioMode>("edit");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isDebugResuming, setIsDebugResuming] = useState(false);

  // ── Store-driven debug state ─────────────────────────────────────────────
  const liveRuns = useWorkflowRunsStore((s) => s.liveRuns);
  const startRun = useWorkflowRunsStore((s) => s.startRun);
  const cancelRun = useWorkflowRunsStore((s) => s.cancelRun);
  const resumeRun = useWorkflowRunsStore((s) => s.resumeRun);
  const clearLiveRun = useWorkflowRunsStore((s) => s.clearLiveRun);

  const activeLiveRun = activeRunId ? liveRuns.get(activeRunId) : undefined;
  const debugNodeStatuses = useMemo(
    () => (activeLiveRun ? toDebugNodeStatusMap(activeLiveRun.nodeStatuses) : new Map<string, DebugNodeStatus>()),
    [activeLiveRun],
  );
  const debugStep = activeLiveRun?.currentStep ?? 0;
  const debugRunStatus = activeLiveRun?.status ?? "";
  const debugInterruptPayload = activeLiveRun?.interruptPayload;
  const debugState = activeLiveRun?.state ?? {};
  const debugEvents = activeLiveRun?.events ?? [];

  const canvasFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workflowId = paramId;
  const workflow = useMemo(
    () => workspace.workflows.find((item) => item.id === workflowId) ?? null,
    [workspace.workflows, workflowId],
  );
  const workflowDefinition = useMemo(
    () => (workspace.workflowDefinitions?.[workflowId] as WorkflowDefinition | undefined) ?? null,
    [workspace.workflowDefinitions, workflowId],
  );

  // Sync draft from workflow
  useEffect(() => {
    if (!workflow) return;
    setDraftName(workflow.name);
    setDraftDescription(workflow.description);
    setDraftStatus(workflow.status);
    setDraftSource(workflow.source);
  }, [workflow]);

  // Sync selectedNodeId when definition changes
  useEffect(() => {
    if (!workflowDefinition) {
      setCanvasFeedbackState("");
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }
    const hasSelectedNode = selectedNodeId
      ? workflowDefinition.nodes.some((node: WorkflowNode) => node.id === selectedNodeId)
      : false;
    const hasSelectedEdge = selectedEdgeId
      ? workflowDefinition.edges.some((edge: WorkflowEdge) => edge.id === selectedEdgeId)
      : false;
    if (hasSelectedNode || hasSelectedEdge) return;
    setSelectedNodeId(workflowDefinition.entryNodeId || workflowDefinition.nodes[0]?.id || null);
    setSelectedEdgeId(null);
  }, [workflowDefinition]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load workflow if needed
  useEffect(() => {
    if (!workflowId) return;
    setDefinitionError("");
    workspace.loadWorkflowById(workflowId).catch((error: unknown) => {
      setDefinitionError(error instanceof Error ? error.message : "加载工作流定义失败。");
    });
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup canvas feedback timer on unmount
  useEffect(() => {
    return () => {
      if (canvasFeedbackTimer.current) clearTimeout(canvasFeedbackTimer.current);
    };
  }, []);

  function setCanvasFeedback(message: string) {
    setCanvasFeedbackState(message);
    if (canvasFeedbackTimer.current) clearTimeout(canvasFeedbackTimer.current);
    canvasFeedbackTimer.current = setTimeout(() => setCanvasFeedbackState(""), 3000);
  }

  function cloneEditor(definition: WorkflowDefinition) {
    return {
      canvas: {
        viewport: {
          offsetX: definition.editor?.canvas.viewport.offsetX ?? 0,
          offsetY: definition.editor?.canvas.viewport.offsetY ?? 0,
        },
        nodes: (definition.editor?.canvas.nodes ?? []).map(
          (layout: WorkflowCanvasNodeLayout) => ({
            nodeId: layout.nodeId,
            position: { x: layout.position.x, y: layout.position.y },
          }),
        ),
      },
    };
  }

  async function handleSave() {
    if (!workflowId) return;

    const name = draftName.trim();
    const description = draftDescription.trim() || " ";
    setSaveError("");

    if (!name) {
      setSaveError("工作流名称不能为空。");
      return;
    }

    setIsSaving(true);
    try {
      await workspace.updateWorkflow(workflowId, {
        name,
        description,
        status: draftStatus,
        source: draftSource,
      });
      setTimeout(() => setSaveError(""), 2000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存工作流失败。");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Debug mode handlers ────────────────────────────────────────────────────

  /** 启动工作流调试运行（通过 store）。 */
  async function handleStartDebugRun() {
    if (!workflowId || !workflowDefinition || workflowDefinition.nodes.length === 0) return;
    try {
      const runId = await startRun(workflowId);
      if (runId) {
        setActiveRunId(runId);
        setStudioMode("debug");
        setIsDebugResuming(false);
      }
    } catch (err) {
      setCanvasFeedback((err as Error)?.message || "启动工作流运行失败。");
    }
  }

  /** 取消当前调试运行（通过 store）。 */
  async function handleCancelDebugRun() {
    if (!activeRunId) return;
    try {
      await cancelRun(activeRunId);
    } catch (err) {
      setCanvasFeedback((err as Error)?.message || "取消运行失败。");
    }
  }

  /** 退出调试模式，切换回编辑模式。 */
  function handleExitDebugMode() {
    if (activeRunId) {
      clearLiveRun(activeRunId);
    }
    setStudioMode("edit");
    setActiveRunId(null);
    setIsDebugResuming(false);
  }

  /** 通过调试面板提交中断输入以恢复运行（通过 store）。 */
  async function handleDebugResumeWithInput(value: unknown) {
    if (!activeRunId) return;
    setIsDebugResuming(true);
    try {
      await resumeRun(activeRunId, value);
    } catch (err) {
      setCanvasFeedback((err as Error)?.message || "恢复运行失败。");
    } finally {
      setIsDebugResuming(false);
    }
  }

  /** 工作流是否拥有可执行的节点。 */
  const hasNodes = (workflowDefinition?.nodes?.length ?? 0) > 0;
  const isDebugRunActive = studioMode === "debug" && !!activeRunId && debugRunStatus === "running";

  function handleNodeSelection(nodeId: string) {
    setCanvasFeedbackState("");
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function handleEdgeSelection(edgeId: string) {
    setCanvasFeedbackState("");
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }

  async function handleCanvasDeleteEdge(edgeId: string) {
    if (!workflowId || !workflowDefinition) return;

    const nextEdges = workflowDefinition.edges.filter(
      (edge: WorkflowEdge) => edge.id !== edgeId,
    );
    const reconciledConditionNodes = reconcileConditionNodes(
      workflowDefinition.nodes,
      nextEdges,
    );
    const { nodes: nextNodes, blockedJoinIds } = reconcileJoinNodes(
      reconciledConditionNodes,
      nextEdges,
    );
    if (blockedJoinIds.length > 0) {
      setCanvasFeedback("汇聚节点至少要保留一个上游节点，无法删除这条连线。");
      return;
    }

    setCanvasFeedbackState("");
    try {
      await workspace.updateWorkflow(workflowId, {
        edges: nextEdges,
        nodes: nextNodes,
        editor: cloneEditor(workflowDefinition),
      });
      setSelectedEdgeId(null);
      setSelectedNodeId(
        workflowDefinition.entryNodeId || workflowDefinition.nodes[0]?.id || null,
      );
    } catch (e: unknown) {
      setCanvasFeedback((e as Error)?.message || "删除连线失败。");
    }
  }

  async function handleCanvasDeleteNode(nodeId: string) {
    if (!workflowId || !workflowDefinition) return;

    if (workflowDefinition.entryNodeId === nodeId) {
      setCanvasFeedback("入口节点不能删除。");
      return;
    }

    const deletedNodeIds = new Set([nodeId]);
    const nextEdges = workflowDefinition.edges.filter(
      (edge: WorkflowEdge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId,
    );
    const remainingNodes = workflowDefinition.nodes.filter(
      (node: WorkflowNode) => node.id !== nodeId,
    );
    const reconciledConditionNodes = reconcileConditionNodes(remainingNodes, nextEdges);
    const { nodes: nextNodes, blockedJoinIds } = reconcileJoinNodes(
      reconciledConditionNodes,
      nextEdges,
    );

    if (blockedJoinIds.length > 0) {
      setCanvasFeedback("汇聚节点至少要保留一个上游节点，无法删除该节点。");
      return;
    }

    setCanvasFeedbackState("");
    try {
      const nextEditor = {
        canvas: {
          viewport: cloneEditor(workflowDefinition).canvas.viewport,
          nodes: cleanupNodeLayouts(
            cloneEditor(workflowDefinition).canvas.nodes as WorkflowCanvasNodeLayout[],
            new Set(nextNodes.map((node: WorkflowNode) => node.id)),
          ),
        },
      };

      const stateSchema = (workflowDefinition.stateSchema ?? []).map(
        (field: { key: string; producerNodeIds: string[]; consumerNodeIds: string[] }) => ({
          ...field,
          producerNodeIds: field.producerNodeIds.filter((id: string) => !deletedNodeIds.has(id)),
          consumerNodeIds: field.consumerNodeIds.filter((id: string) => !deletedNodeIds.has(id)),
        }),
      );

      await workspace.updateWorkflow(workflowId, {
        nodes: nextNodes,
        edges: nextEdges,
        stateSchema,
        editor: nextEditor,
      });
      setSelectedNodeId(workflowDefinition.entryNodeId || nextNodes[0]?.id || null);
      setSelectedEdgeId(null);
    } catch (e: unknown) {
      setCanvasFeedback((e as Error)?.message || "删除节点失败。");
    }
  }

  async function handleCanvasEditorUpdate(editor: NonNullable<WorkflowDefinition["editor"]>) {
    if (!workflowId) return;
    try {
      await workspace.updateWorkflow(workflowId, { editor });
    } catch (error: unknown) {
      setCanvasFeedback((error as Error)?.message || "更新画布布局失败。");
    }
  }

  async function handleAddNode(kind: WorkflowNodeKind) {
    if (!workflowId || !workflowDefinition) return;

    const nodeId = `node-${kind}-${Date.now().toString(36)}`;
    const existingLayouts = (workflowDefinition.editor?.canvas.nodes ?? []) as WorkflowCanvasNodeLayout[];
    const position = computeNextNodePosition({
      layouts: existingLayouts,
      upstreamNodeId: selectedNodeId ?? undefined,
      fallbackIndex: workflowDefinition.nodes.length,
    });

    try {
      const draft = createWorkflowNodeDraft({
        kind,
        nodeId,
        position,
        upstreamNodeId: selectedNodeId ?? undefined,
      });
      const nextNodes = [...workflowDefinition.nodes, draft.node];
      const nextEditor = {
        canvas: {
          viewport: cloneEditor(workflowDefinition).canvas.viewport,
          nodes: [...existingLayouts, draft.layout],
        },
      };
      await workspace.updateWorkflow(workflowId, {
        nodes: nextNodes,
        editor: nextEditor,
      });
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    } catch (e: unknown) {
      setCanvasFeedback((e as Error)?.message || "添加节点失败。");
    }
  }

  async function handleConnectNode(payload: { fromNodeId: string; toNodeId: string }) {
    if (!workflowId || !workflowDefinition) return;

    const { fromNodeId, toNodeId } = payload;
    // Prevent duplicate edges
    const alreadyExists = workflowDefinition.edges.some(
      (edge: WorkflowEdge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId,
    );
    if (alreadyExists) {
      setCanvasFeedback("该连线已存在。");
      return;
    }

    const edgeId = `edge-${Date.now().toString(36)}`;
    const newEdge: WorkflowEdge = {
      id: edgeId,
      fromNodeId,
      toNodeId,
      kind: "normal",
    };

    try {
      await workspace.updateWorkflow(workflowId, {
        edges: [...workflowDefinition.edges, newEdge],
        editor: cloneEditor(workflowDefinition),
      });
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
    } catch (e: unknown) {
      setCanvasFeedback((e as Error)?.message || "创建连线失败。");
    }
  }

  return (
    <div data-testid="workflow-studio-view" className="studio-layout">
      {/* Top Toolbar */}
      <header className="studio-topbar">
        <div className="topbar-left">
          <Link to="/workflows" className="back-link" title="返回工作流列表">
            <ChevronLeft size={20} className="icon-back" />
          </Link>
          <div className="divider" />
          <div className="title-group">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="title-input"
              placeholder="未命名工作流"
              onBlur={handleSave}
              data-testid="workflow-studio-name"
            />
            <span className="status-chip" data-status={draftStatus}>
              {statusMap[draftStatus] || draftStatus}
            </span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="setting-group">
            <div className="setting-item">
              <span className="label">来源</span>
              <select
                value={draftSource}
                onChange={(e) => {
                  setDraftSource(e.target.value as "personal" | "enterprise" | "hub");
                  void handleSave();
                }}
                data-testid="workflow-studio-source"
                className="compact-select"
              >
                <option value="personal">个人</option>
                <option value="enterprise">企业</option>
                <option value="hub">hub</option>
              </select>
            </div>
            <div className="setting-item">
              <span className="label">状态</span>
              <select
                value={draftStatus}
                onChange={(e) => {
                  setDraftStatus(e.target.value as "draft" | "active" | "archived");
                  void handleSave();
                }}
                data-testid="workflow-studio-status"
                className="compact-select"
              >
                <option value="draft">草稿</option>
                <option value="active">已启用</option>
                <option value="archived">已归档</option>
              </select>
            </div>
          </div>
          <div className="divider" />
          {/* 调试模式控制按钮 */}
          {studioMode === "debug" ? (
            <>
              {isDebugRunActive && (
                <button
                  className="topbar-icon-btn debug-stop-btn"
                  title="停止运行"
                  onClick={handleCancelDebugRun}
                >
                  <Square size={13} />
                  <span>停止</span>
                </button>
              )}
              <button
                className="topbar-icon-btn debug-exit-btn"
                title="退出调试模式"
                onClick={handleExitDebugMode}
              >
                <ToggleRight size={15} />
                <span>退出调试</span>
              </button>
            </>
          ) : (
            <>
              {hasNodes && (
                <button
                  className="topbar-icon-btn debug-run-btn"
                  title="调试运行"
                  onClick={handleStartDebugRun}
                >
                  <Bug size={15} />
                  <span>调试</span>
                </button>
              )}
            </>
          )}
          <button
            className={`topbar-icon-btn${showRunPanel ? " active" : ""}`}
            title="运行/记录"
            onClick={() => setShowRunPanel((v) => !v)}
          >
            <Play size={15} />
            <span>运行</span>
          </button>
          <button
            className={`topbar-icon-btn${showInspector ? " active" : ""}`}
            title="检查面板"
            onClick={() => setShowInspector((v) => !v)}
          >
            <PanelRight size={15} />
            <span>侧栏</span>
          </button>
          <div className="divider" />
          <button
            data-testid="workflow-studio-save"
            className="primary-save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {!isSaving && <Save size={16} />}
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </header>

      <main className="studio-body">
        {/* Main Canvas Area */}
        <section className="studio-canvas-area">
          {saveError && (
            <div className="top-banner error-banner">
              <AlertTriangle size={16} />
              {saveError}
            </div>
          )}

          {/* 调试模式状态栏 */}
          {studioMode === "debug" && (
            <div className="debug-status-bar">
              <span className="debug-status-item">
                <span className="debug-status-dot" data-status={debugRunStatus || "idle"} />
                状态: {debugRunStatus || "idle"}
              </span>
              <span className="debug-status-item">步骤: {debugStep}</span>
              <span className="debug-status-item">
                运行中: {[...debugNodeStatuses].filter(([, s]) => s.phase === "running" || s.phase === "streaming").map(([id]) => id).join(", ") || "无"}
              </span>
              <span className="debug-status-item">
                已完成: {[...debugNodeStatuses].filter(([, s]) => s.phase === "completed").length}/{workflowDefinition?.nodes.length ?? 0}
              </span>
            </div>
          )}

          {workflowDefinition && Array.isArray(workflowDefinition.nodes) ? (
            <WorkflowCanvas
              definition={workflowDefinition}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              feedbackMessage={canvasFeedback}
              onSelectNode={handleNodeSelection}
              onSelectEdge={handleEdgeSelection}
              onAddNode={handleAddNode}
              onConnectNode={handleConnectNode}
              onDeleteNode={handleCanvasDeleteNode}
              onDeleteEdge={handleCanvasDeleteEdge}
              onUpdateEditor={handleCanvasEditorUpdate}
              debugMode={studioMode === "debug"}
              debugNodeStatuses={studioMode === "debug" ? debugNodeStatuses : undefined}
            />
          ) : definitionError ? (
            <div className="loading-state error-copy">{definitionError}</div>
          ) : (
            <div className="loading-state">
              <div className="spinner" />
              <p>正在加载工作流定义...</p>
            </div>
          )}

          {/* Run panel slides up from bottom */}
          {showRunPanel && workflowDefinition && (
            <div className="run-panel-drawer">
              <div
                className="run-panel-drag-bar"
                onClick={() => setShowRunPanel(false)}
              >
                <ChevronDown size={16} />
                <span>收起运行面板</span>
              </div>
              <div className="studio-run-panel">
                <WorkflowRunPanel
                  workflowId={workflowId}
                  definition={workflowDefinition}
                />
              </div>
            </div>
          )}
        </section>

        {/* Right inspector panel */}
        {showInspector && (
          <aside className="studio-right-panel">
            {studioMode === "debug" && activeRunId ? (
              <WorkflowDebugPanel
                runId={activeRunId}
                status={debugRunStatus}
                currentStep={debugStep}
                state={debugState}
                events={debugEvents}
                interruptPayload={debugInterruptPayload}
                onResumeWithInput={handleDebugResumeWithInput}
                isResuming={isDebugResuming}
              />
            ) : (
              <div className="inspector-content">
                {workflowDefinition ? (
                  <WorkflowGraphInspector
                    workflowId={workflowId}
                    definition={workflowDefinition}
                    selectedNodeId={selectedNodeId}
                    selectedEdgeId={selectedEdgeId}
                    compact
                  />
                ) : definitionError ? (
                  <p className="error-copy" style={{ padding: "20px" }}>
                    {definitionError}
                  </p>
                ) : (
                  <p className="subtitle" style={{ padding: "20px" }}>
                    加载中...
                  </p>
                )}
              </div>
            )}
          </aside>
        )}
      </main>

      <style>{`
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
          text-decoration: none;
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

        .title-input:hover { background: rgba(255,255,255,0.05); }

        .title-input:focus {
          background: #09090b;
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 2px rgba(59,130,246,0.2);
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
          background: rgba(16,185,129,0.1);
          color: #10b981;
          border-color: rgba(16,185,129,0.2);
        }

        .status-chip[data-status="draft"] {
          background: rgba(245,158,11,0.1);
          color: #f59e0b;
          border-color: rgba(245,158,11,0.2);
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

        .primary-save-btn:hover:not(:disabled) { background: #2563eb; }
        .primary-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .topbar-icon-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 28px;
          padding: 0 10px;
          background: transparent;
          border: 1px solid #27272a;
          border-radius: 6px;
          color: #a1a1aa;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .topbar-icon-btn:hover {
          background: #27272a;
          color: #f4f4f5;
        }

        .topbar-icon-btn.active {
          background: rgba(59,130,246,0.12);
          border-color: rgba(59,130,246,0.3);
          color: #60a5fa;
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
          min-height: 0;
          background: #0d0d0f;
        }

        .flex-fill { flex: 1; min-height: 0; }

        .studio-right-panel {
          width: 440px;
          min-width: 400px;
          border-left: 1px solid #27272a;
          background: #161618;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          z-index: 10;
          overflow: hidden;
        }

        .inspector-content {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          min-height: 0;
        }

        .inspector-placeholder {
          padding: 8px;
        }

        .run-panel-drawer {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          max-height: 50%;
          display: flex;
          flex-direction: column;
          background: #161618;
          border-top: 1px solid #27272a;
          box-shadow: 0 -8px 24px rgba(0,0,0,0.4);
          z-index: 50;
        }

        .run-panel-drag-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 0;
          cursor: pointer;
          color: #52525b;
          font-size: 11px;
          font-weight: 500;
          border-bottom: 1px solid #1f1f23;
          transition: all 0.15s;
          user-select: none;
        }

        .run-panel-drag-bar:hover {
          color: #a1a1aa;
          background: #1a1a1d;
        }

        .studio-run-panel {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
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
          display: flex;
          align-items: center;
          gap: 8px;
          backdrop-filter: blur(4px);
        }

        .error-banner {
          background: rgba(239,68,68,0.9);
          color: white;
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

        .error-copy { color: #f87171; }

        @keyframes spin { to { transform: rotate(360deg); } }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid #27272a;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .canvas-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          height: 100%;
          background: #0d0d0f;
          padding: 24px;
        }

        .canvas-placeholder-text {
          color: #52525b;
          font-size: 13px;
        }

        .node-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          max-width: 600px;
        }

        .node-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid var(--glass-border, #27272a);
          background: #161618;
          color: var(--text-secondary, #a1a1aa);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .node-chip:hover { border-color: #3f3f46; color: #fff; }
        .node-chip.selected { border-color: #3b82f6; color: #60a5fa; background: rgba(59,130,246,0.08); }

        .node-kind-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #52525b;
        }

        .node-kind-dot.node-kind-start { background: #10b981; }
        .node-kind-dot.node-kind-end { background: #ef4444; }
        .node-kind-dot.node-kind-tool { background: #3b82f6; }
        .node-kind-dot.node-kind-llm { background: #8b5cf6; }
        .node-kind-dot.node-kind-condition { background: #f59e0b; }
        .node-kind-dot.node-kind-join { background: #06b6d4; }
        .node-kind-dot.node-kind-human-input { background: #ec4899; }
        .node-kind-dot.node-kind-subgraph { background: #6366f1; }

        .canvas-feedback {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(245,158,11,0.9);
          color: white;
          padding: 6px 16px;
          border-radius: 6px;
          font-size: 12px;
          z-index: 300;
        }

        /* ── 调试模式样式 ───────────────────────────────────────────────── */

        .debug-run-btn {
          border-color: rgba(59, 130, 246, 0.3);
          color: #60a5fa;
        }
        .debug-run-btn:hover {
          background: rgba(59, 130, 246, 0.12);
          color: #93c5fd;
        }

        .debug-stop-btn {
          border-color: rgba(239, 68, 68, 0.3);
          color: #f87171;
        }
        .debug-stop-btn:hover {
          background: rgba(239, 68, 68, 0.15);
          color: #fca5a5;
        }

        .debug-exit-btn {
          border-color: rgba(161, 161, 170, 0.3);
          color: #a1a1aa;
        }
        .debug-exit-btn:hover {
          background: rgba(161, 161, 170, 0.1);
          color: #d4d4d8;
        }

        .debug-status-bar {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 6px 16px;
          background: #121214;
          border-bottom: 1px solid #27272a;
          font-size: 12px;
          color: #a1a1aa;
          flex-shrink: 0;
          z-index: 30;
        }

        .debug-status-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .debug-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #52525b;
        }
        .debug-status-dot[data-status="running"] {
          background: #3b82f6;
          box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
          animation: debug-pulse 1.5s ease-in-out infinite;
        }
        .debug-status-dot[data-status="completed"] { background: #10b981; }
        .debug-status-dot[data-status="error"] { background: #ef4444; }
        .debug-status-dot[data-status="cancelled"] { background: #f59e0b; }

        @keyframes debug-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        @media (max-width: 1200px) {
          .studio-right-panel {
            width: 380px;
            min-width: 340px;
          }
        }
      `}</style>
    </div>
  );
}
