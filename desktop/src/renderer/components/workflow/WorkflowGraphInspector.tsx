import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@shared/contracts";

import WorkflowEdgeEditor from "./WorkflowEdgeEditor";
import WorkflowNodeEditor, { type WorkflowEditorOption } from "./WorkflowNodeEditor";
import WorkflowStateSchemaEditor from "./WorkflowStateSchemaEditor";
import { useWorkspaceStore } from "../../stores/workspace";

interface WorkflowGraphInspectorProps {
  workflowId: string;
  definition: WorkflowDefinition;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  showGraphList?: boolean;
}

function cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
}

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

export default function WorkflowGraphInspector({
  workflowId,
  definition,
  selectedNodeId: propSelectedNodeId = null,
  selectedEdgeId: propSelectedEdgeId = null,
  showGraphList = true,
}: WorkflowGraphInspectorProps) {
  const workspace = useWorkspaceStore();

  const [draft, setDraft] = useState<WorkflowDefinition>(() => cloneDefinition(definition));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [schemaErrors, setSchemaErrors] = useState<string[]>([]);

  // Sync draft when definition changes
  const prevDefinitionRef = useRef<WorkflowDefinition | null>(null);
  useEffect(() => {
    if (prevDefinitionRef.current === definition) return;
    const cloned = cloneDefinition(definition);
    setDraft(cloned);
    console.info("[workflow] 同步 workflow definition 草稿", { workflowId });
    prevDefinitionRef.current = definition;
  }, [definition, workflowId]);

  // Sync selected node/edge from props
  useEffect(() => {
    if (propSelectedNodeId && draft.nodes.some((node) => node.id === propSelectedNodeId)) {
      setSelectedNodeId(propSelectedNodeId);
      setSelectedEdgeId(null);
      console.info("[workflow] 同步外部节点选中", { workflowId, nodeId: propSelectedNodeId });
      return;
    }
    if (propSelectedEdgeId && draft.edges.some((edge) => edge.id === propSelectedEdgeId)) {
      setSelectedEdgeId(propSelectedEdgeId);
      setSelectedNodeId(null);
      console.info("[workflow] 同步外部连线选中", { workflowId, edgeId: propSelectedEdgeId });
    }
  }, [propSelectedNodeId, propSelectedEdgeId, draft.nodes, draft.edges, workflowId]);

  const selectedNode = useMemo<WorkflowNode | null>(
    () => (selectedNodeId ? draft.nodes.find((node) => node.id === selectedNodeId) ?? null : null),
    [selectedNodeId, draft.nodes],
  );

  const selectedEdge = useMemo<WorkflowEdge | null>(
    () => (selectedEdgeId ? draft.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null),
    [selectedEdgeId, draft.edges],
  );

  const joinUpstreamCandidates = useMemo<string[]>(() => {
    if (!selectedNode || selectedNode.kind !== "join") return [];
    const incoming = draft.edges.filter((edge) => edge.toNodeId === selectedNode?.id);
    const ids = incoming.map((edge) => edge.fromNodeId);
    return Array.from(new Set(ids));
  }, [selectedNode, draft.edges]);

  const conditionRouteCandidates = useMemo<string[]>(() => {
    if (!selectedNode || selectedNode.kind !== "condition") return [];
    return draft.nodes.filter((node) => node.id !== selectedNode?.id).map((node) => node.id);
  }, [selectedNode, draft.nodes]);

  const toolCandidateOptions = useMemo<WorkflowEditorOption[]>(() => {
    const optionMap = new Map<string, WorkflowEditorOption>();
    for (const tool of workspace.builtinTools) {
      if (!tool.enabled) continue;
      optionMap.set(tool.id, { value: tool.id, label: tool.name, hint: `内置工具 / ${tool.group}` });
    }
    for (const tool of workspace.mcpTools) {
      if (!tool.enabled) continue;
      optionMap.set(tool.id, {
        value: tool.id,
        label: tool.name,
        hint: tool.serverId ? `MCP / ${tool.serverId}` : "MCP 工具",
      });
    }
    return [...optionMap.values()];
  }, [workspace.builtinTools, workspace.mcpTools]);

  const workflowCandidateOptions = useMemo<WorkflowEditorOption[]>(() => {
    return Object.values(workspace.workflowSummaries)
      .filter((workflow) => workflow.id !== workflowId)
      .map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
        hint: `${workflow.status} / v${workflow.version}`,
      }));
  }, [workspace.workflowSummaries, workflowId]);

  const stateFieldKeyOptions = useMemo<string[]>(() => {
    return draft.stateSchema
      .map((field) => field.key.trim())
      .filter((key, index, list) => Boolean(key) && list.indexOf(key) === index);
  }, [draft.stateSchema]);

  const graphErrors = useMemo(() => validateGraph(draft), [draft]);
  const graphErrorText = graphErrors.length ? graphErrors.join("; ") : "";
  const canSave = !isSaving && schemaErrors.length === 0 && graphErrors.length === 0;

  function selectNode(nodeId: string) {
    console.info("[workflow] 选择节点", { workflowId, nodeId });
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function selectEdge(edgeId: string) {
    console.info("[workflow] 选择连线", { workflowId, edgeId });
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }

  function handleNodeUpdate(nextNode: WorkflowNode) {
    setDraft((prev) => {
      const nodes = [...prev.nodes];
      const index = nodes.findIndex((node) => node.id === nextNode.id);
      if (index < 0) return prev;
      nodes.splice(index, 1, nextNode);
      console.info("[workflow] 更新草稿节点", { workflowId, nodeId: nextNode.id });
      return { ...prev, nodes };
    });
  }

  function handleEdgeUpdate(nextEdge: WorkflowEdge) {
    setDraft((prev) => {
      const edges = [...prev.edges];
      const index = edges.findIndex((edge) => edge.id === nextEdge.id);
      if (index < 0) return prev;
      edges.splice(index, 1, nextEdge);
      console.info("[workflow] 更新草稿连线", { workflowId, edgeId: nextEdge.id });
      return { ...prev, edges };
    });
  }

  function handleStateSchemaUpdate(nextSchema: WorkflowDefinition["stateSchema"]) {
    setDraft((prev) => {
      console.info("[workflow] 更新草稿 state schema", { workflowId, fields: nextSchema.length });
      return { ...prev, stateSchema: nextSchema as never };
    });
  }

  function handleSchemaValidation(payload: { errors: string[] }) {
    setSchemaErrors(payload.errors);
    if (payload.errors.length) {
      console.info("[workflow] state schema 校验失败", { workflowId, errors: payload.errors });
    }
  }

  async function handleSave() {
    if (!canSave) {
      if (graphErrors.length) {
        console.info("[workflow] graph 引用校验失败，禁止保存", { workflowId, errors: graphErrors });
      }
      return;
    }
    setSaveError("");
    setIsSaving(true);
    console.info("[workflow] 开始保存 workflow definition", {
      workflowId,
      nodes: draft.nodes.length,
      edges: draft.edges.length,
      stateSchema: draft.stateSchema.length,
    });
    try {
      await workspace.updateWorkflow(workflowId, {
        entryNodeId: draft.entryNodeId,
        nodes: draft.nodes,
        edges: draft.edges,
        stateSchema: draft.stateSchema,
        editor: draft.editor,
        defaults: draft.defaults,
      });
      console.info("[workflow] 保存 workflow definition 成功", { workflowId });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save definition failed.");
      console.info("[workflow] 保存 workflow definition 失败", { workflowId, error: saveError });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section data-testid="workflow-graph-inspector" className="inspector">
      <header className="inspector-header">
        <div>
          <h3 className="title">工作流图检查器</h3>
          <p className="subtitle">结构化编辑：节点、连线、状态 Schema、策略</p>
        </div>
        <div className="actions">
          {graphErrorText && (
            <span data-testid="workflow-graph-inspector-graph-error" className="error">
              {graphErrorText}
            </span>
          )}
          {saveError && <span className="error">{saveError}</span>}
          <button
            data-testid="workflow-graph-inspector-save"
            type="button"
            className="primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            保存图定义
          </button>
        </div>
      </header>

      <section className={`grid${!showGraphList ? " grid--single" : ""}`}>
        {showGraphList && (
          <section className="panel">
            <h4 className="panel-title">节点列表</h4>
            <ul className="list">
              {draft.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="row"
                    data-testid={`workflow-graph-node-row-${node.id}`}
                    data-active={node.id === selectedNodeId ? "true" : "false"}
                    onClick={() => selectNode(node.id)}
                  >
                    <strong data-testid={`workflow-graph-node-label-${node.id}`}>{node.label}</strong>
                    <span className="muted">{node.kind}</span>
                  </button>
                </li>
              ))}
            </ul>

            <h4 className="panel-title">连线列表</h4>
            <ul className="list">
              {draft.edges.map((edge) => (
                <li key={edge.id}>
                  <button
                    type="button"
                    className="row"
                    data-testid={`workflow-graph-edge-row-${edge.id}`}
                    data-active={edge.id === selectedEdgeId ? "true" : "false"}
                    onClick={() => selectEdge(edge.id)}
                  >
                    <span className="edge-label">{edge.fromNodeId} → {edge.toNodeId}</span>
                    <span data-testid={`workflow-graph-edge-kind-${edge.id}`} className="muted">{edge.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h4 className="panel-title">配置编辑器</h4>
          {selectedNode ? (
            <WorkflowNodeEditor
              node={selectedNode}
              upstreamCandidateNodeIds={joinUpstreamCandidates}
              routeCandidateNodeIds={conditionRouteCandidates}
              toolCandidateOptions={toolCandidateOptions}
              workflowCandidateOptions={workflowCandidateOptions}
              stateFieldKeyOptions={stateFieldKeyOptions}
              onUpdateNode={handleNodeUpdate}
            />
          ) : selectedEdge ? (
            <WorkflowEdgeEditor edge={selectedEdge} onUpdateEdge={handleEdgeUpdate} />
          ) : (
            <p className="placeholder">请在左侧侧栏或画布中选择一个节点或连线开始编辑。</p>
          )}

          <WorkflowStateSchemaEditor
            className="schema"
            modelValue={draft.stateSchema}
            onUpdateModelValue={handleStateSchemaUpdate}
            onValidation={handleSchemaValidation}
          />
        </section>
      </section>

      <style>{`
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
        .inspector .title {
          margin: 0;
          color: var(--text-primary);
          font-size: 18px;
        }
        .inspector .subtitle {
          margin: 6px 0 0;
          color: var(--text-secondary);
          font-size: 13px;
        }
        .inspector .actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .inspector .primary {
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          background: var(--accent-primary);
          color: var(--accent-text);
          font: inherit;
          cursor: pointer;
        }
        .inspector .primary[disabled] {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .inspector .error {
          color: #b83333;
          font-size: 12px;
        }
        .inspector .grid {
          display: grid;
          grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.1fr);
          gap: 14px;
          align-items: start;
        }
        .inspector .grid--single {
          grid-template-columns: 1fr;
        }
        .inspector .panel {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          background: var(--bg-card);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .inspector .panel-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 14px;
        }
        .inspector .list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .inspector .row {
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
        .inspector .row[data-active="true"] {
          border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--glass-border));
        }
        .inspector .muted {
          color: var(--text-secondary);
          font-size: 12px;
        }
        .inspector .edge-label {
          font-size: 12px;
          color: var(--text-primary);
        }
        .inspector .placeholder {
          margin: 0;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .inspector .schema {
          margin-top: 6px;
        }
        @media (max-width: 960px) {
          .inspector .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
