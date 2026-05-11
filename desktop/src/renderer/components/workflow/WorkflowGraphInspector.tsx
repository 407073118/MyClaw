import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowVariableRef } from "@shared/contracts";

import WorkflowEdgeEditor from "./WorkflowEdgeEditor";
import WorkflowNodeEditor, { type WorkflowEditorOption, type WorkflowNodeLabelOption, type WorkflowVariableSourceOption } from "./WorkflowNodeEditor";
import { useWorkspaceStore } from "../../stores/workspace";

interface WorkflowGraphInspectorProps {
  workflowId: string;
  definition: WorkflowDefinition;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  compact?: boolean;
}

type AutoSaveState = "idle" | "saving" | "saved" | "blocked" | "error";

/** 深拷贝工作流定义，避免编辑草稿和上游引用共享对象。 */
function cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
}

/** 根据节点 ID 解析可读名称，校验错误面向用户时不直接暴露内部 ID。 */
function resolveNodeLabel(definition: WorkflowDefinition, nodeId: string): string {
  return definition.nodes.find((node) => node.id === nodeId)?.label || "已删除节点";
}

/** 校验工作流图引用是否合法，包括入口、边关系和 join/condition 约束。 */
function validateGraph(definition: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(definition.nodes.map((node) => node.id));

  if (definition.entryNodeId && !nodeIds.has(definition.entryNodeId)) {
    errors.push("入口节点已不存在，请重新指定开始节点");
  }

  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      errors.push("连线引用了已删除节点，请重新连线");
    }
  }

  for (const node of definition.nodes) {
    if (node.kind !== "join") continue;
    const incoming = definition.edges.filter((edge) => edge.toNodeId === node.id);
    const candidates = new Set(incoming.map((edge) => edge.fromNodeId));
    const invalidUpstreams = node.join.upstreamNodeIds.filter((id) => !candidates.has(id));
    if (invalidUpstreams.length) {
      const labels = invalidUpstreams.map((id) => resolveNodeLabel(definition, id)).join("、");
      errors.push(`${node.label || "汇聚节点"} 的上游节点不可达：${labels}`);
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
      errors.push(`${node.label || "条件分支"} 需要配置判断条件`);
    }
    if (node.route?.trueNodeId && !nodeIds.has(node.route.trueNodeId)) {
      errors.push(`${node.label || "条件分支"} 的 True 路由目标已不存在`);
    }
    if (node.route?.falseNodeId && !nodeIds.has(node.route.falseNodeId)) {
      errors.push(`${node.label || "条件分支"} 的 False 路由目标已不存在`);
    }
    if (node.route?.trueNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.trueNodeId)) {
      errors.push(`${node.label || "条件分支"} 的 True 路由还没有连线`);
    }
    if (node.route?.falseNodeId && !outgoing.some((edge) => edge.toNodeId === node.route?.falseNodeId)) {
      errors.push(`${node.label || "条件分支"} 的 False 路由还没有连线`);
    }
  }

  return errors;
}

/** 递归收集当前节点的上游节点，避免参数选择器默认暴露明显不可达的下游输出。 */
function collectUpstreamNodeIds(definition: WorkflowDefinition, nodeId: string | null): Set<string> {
  if (!nodeId) return new Set();
  const upstream = new Set<string>();
  const queue = definition.edges.filter((edge) => edge.toNodeId === nodeId).map((edge) => edge.fromNodeId);
  while (queue.length) {
    const current = queue.shift();
    if (!current || upstream.has(current)) continue;
    upstream.add(current);
    for (const edge of definition.edges) {
      if (edge.toNodeId === current) queue.push(edge.fromNodeId);
    }
  }
  return upstream;
}

/** 把工作流变量定义和上游节点输出整理成节点参数选择器可消费的选项。 */
function buildVariableSourceOptions(
  definition: WorkflowDefinition,
  selectedNodeId: string | null,
): WorkflowVariableSourceOption[] {
  const options: WorkflowVariableSourceOption[] = [];
  const seen = new Set<string>();

  function addOption(group: string, label: string, ref: WorkflowVariableRef) {
    const id = `${ref.scope}:${ref.nodeId ?? ""}:${ref.path}`;
    if (seen.has(id)) return;
    seen.add(id);
    options.push({ id, group, label, ref });
  }

  for (const variable of definition.variables ?? []) {
    if (variable.scope !== "input" && variable.scope !== "run" && variable.scope !== "secret") {
      continue;
    }
    const group = variable.scope === "input" ? "启动输入" : variable.scope === "run" ? "全局变量" : "密钥变量";
    addOption(group, variable.label || variable.key, {
      scope: variable.scope,
      path: variable.path || variable.key,
      valueType: variable.valueType,
    });
  }

  for (const field of definition.stateSchema ?? []) {
    if (!field.required || field.producerNodeIds.length > 0) continue;
    addOption("启动输入", field.label || field.key, {
      scope: "input",
      path: field.key,
      valueType: field.valueType,
    });
  }

  const upstreamNodeIds = collectUpstreamNodeIds(definition, selectedNodeId);
  for (const node of definition.nodes) {
    if (!upstreamNodeIds.has(node.id)) continue;
    const nodeLabel = node.label || node.id;
    if (node.kind === "llm") {
      addOption("节点输出", `${nodeLabel}.content`, {
        scope: "node",
        nodeId: node.id,
        path: "content",
        valueType: "string",
      });
    }
    if (node.kind === "tool") {
      addOption("节点输出", `${nodeLabel}.output`, {
        scope: "node",
        nodeId: node.id,
        path: "output",
        valueType: "unknown",
      });
    }
    if (node.kind === "http-request") {
      addOption("节点输出", `${nodeLabel}.body`, {
        scope: "node",
        nodeId: node.id,
        path: "body",
        valueType: "object",
      });
    }
    for (const bindingKey of Object.keys(node.outputBindings ?? {})) {
      addOption("节点输出", `${nodeLabel}.${bindingKey}`, {
        scope: "node",
        nodeId: node.id,
        path: bindingKey,
        valueType: "unknown",
      });
    }
  }

  return options;
}

/** 渲染工作流图检查器，负责节点/连线编辑与保存。 */
export default function WorkflowGraphInspector({
  workflowId,
  definition,
  selectedNodeId: propSelectedNodeId = null,
  selectedEdgeId: propSelectedEdgeId = null,
  compact = false,
}: WorkflowGraphInspectorProps) {
  const workspace = useWorkspaceStore();

  const [draft, setDraft] = useState<WorkflowDefinition>(() => cloneDefinition(definition));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [saveError, setSaveError] = useState("");

  const prevDefinitionRef = useRef<WorkflowDefinition | null>(null);
  const draftRef = useRef(draft);
  const saveSequenceRef = useRef(0);
  draftRef.current = draft;

  useEffect(() => {
    if (prevDefinitionRef.current === definition) return;
    const cloned = cloneDefinition(definition);
    setDraft(cloned);
    draftRef.current = cloned;
    setAutoSaveState("idle");
    setSaveError("");
    console.info("[workflow] 同步 workflow definition 草稿", { workflowId });
    prevDefinitionRef.current = definition;
  }, [definition, workflowId]);

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

  const nodeLabelOptions = useMemo<WorkflowNodeLabelOption[]>(() => {
    return draft.nodes.map((node) => ({
      id: node.id,
      label: node.label || "未命名节点",
    }));
  }, [draft.nodes]);

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

  const modelCandidateOptions = useMemo<WorkflowEditorOption[]>(() => {
    return (workspace.models ?? [])
      .map((model) => ({
        value: model.id,
        label: model.name || model.id,
        hint: [model.providerFamily, model.protocolTarget].filter(Boolean).join(" / ") || "工作区模型",
      }));
  }, [workspace.models]);

  const stateFieldKeyOptions = useMemo<string[]>(() => {
    return draft.stateSchema
      .map((field) => field.key.trim())
      .filter((key, index, list) => Boolean(key) && list.indexOf(key) === index);
  }, [draft.stateSchema]);

  const variableSourceOptions = useMemo<WorkflowVariableSourceOption[]>(() => {
    return buildVariableSourceOptions(draft, selectedNodeId);
  }, [draft, selectedNodeId]);

  const graphErrors = useMemo(() => validateGraph(draft), [draft]);
  const graphErrorText = graphErrors.length ? graphErrors.join("; ") : "";

  const autoSaveLabel = useMemo(() => {
    if (autoSaveState === "saving") return "正在自动保存";
    if (autoSaveState === "saved") return "已自动保存";
    if (autoSaveState === "blocked") return "修正错误后自动保存";
    if (autoSaveState === "error") return "自动保存失败";
    return "自动保存已开启";
  }, [autoSaveState]);

  /** 自动持久化工作流定义草稿，让运行按钮始终读取最新配置。 */
  async function persistDraft(nextDraft: WorkflowDefinition, reason: string) {
    const nextGraphErrors = validateGraph(nextDraft);
    if (nextGraphErrors.length) {
      setAutoSaveState("blocked");
      const errorText = nextGraphErrors.join("; ");
      setSaveError(errorText);
      console.info("[workflow] 自动保存被校验拦截", {
        workflowId,
        reason,
        graphErrors: nextGraphErrors,
      });
      return;
    }

    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
    setSaveError("");
    setAutoSaveState("saving");
    console.info("[workflow] 开始自动保存 workflow definition", {
      workflowId,
      reason,
      nodes: nextDraft.nodes.length,
      edges: nextDraft.edges.length,
      stateSchema: nextDraft.stateSchema.length,
    });

    try {
      await workspace.updateWorkflow(workflowId, {
        entryNodeId: nextDraft.entryNodeId,
        nodes: nextDraft.nodes,
        edges: nextDraft.edges,
        stateSchema: nextDraft.stateSchema,
        editor: nextDraft.editor,
        defaults: nextDraft.defaults,
      });
      if (saveSequenceRef.current === saveSequence) {
        setAutoSaveState("saved");
      }
      console.info("[workflow] 自动保存 workflow definition 成功", { workflowId, reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : "自动保存 workflow definition 失败。";
      if (saveSequenceRef.current === saveSequence) {
        setSaveError(message);
        setAutoSaveState("error");
      }
      console.info("[workflow] 自动保存 workflow definition 失败", { workflowId, reason, error: message });
    }
  }

  /** 提交下一版草稿并集中触发自动保存，避免在 React state updater 中执行副作用。 */
  function commitDraft(reason: string, buildNext: (prev: WorkflowDefinition) => WorkflowDefinition) {
    const prevDraft = draftRef.current;
    const nextDraft = buildNext(prevDraft);
    if (nextDraft === prevDraft) return;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    console.info("[workflow] 提交 workflow definition 草稿", {
      workflowId,
      reason,
      nodes: nextDraft.nodes.length,
      edges: nextDraft.edges.length,
      stateSchema: nextDraft.stateSchema.length,
    });
    void persistDraft(nextDraft, reason);
  }

  /** 更新草稿中的节点定义，并立即自动保存到工作流。 */
  function handleNodeUpdate(nextNode: WorkflowNode) {
    commitDraft("node", (prev) => {
      const nodes = [...prev.nodes];
      const index = nodes.findIndex((node) => node.id === nextNode.id);
      if (index < 0) return prev;
      nodes.splice(index, 1, nextNode);
      const nextDraft = { ...prev, nodes };
      console.info("[workflow] 更新节点并触发自动保存", { workflowId, nodeId: nextNode.id });
      return nextDraft;
    });
  }

  /** 更新草稿中的连线定义，并立即自动保存到工作流。 */
  function handleEdgeUpdate(nextEdge: WorkflowEdge) {
    commitDraft("edge", (prev) => {
      const edges = [...prev.edges];
      const index = edges.findIndex((edge) => edge.id === nextEdge.id);
      if (index < 0) return prev;
      edges.splice(index, 1, nextEdge);
      const nextDraft = { ...prev, edges };
      console.info("[workflow] 更新连线并触发自动保存", { workflowId, edgeId: nextEdge.id });
      return nextDraft;
    });
  }

  return (
    <section
      data-testid="workflow-graph-inspector"
      className={`inspector${compact ? " inspector--compact" : ""}`}
    >
      <div className="actions">
        {graphErrorText && (
          <span data-testid="workflow-graph-inspector-graph-error" className="error">
            {graphErrorText}
          </span>
        )}
        {saveError && <span className="error">{saveError}</span>}
        <span
          data-testid="workflow-graph-inspector-save-state"
          className={`save-state save-state--${autoSaveState}`}
        >
          {autoSaveLabel}
        </span>
      </div>

      <section className="panel">
        {selectedNode ? (
          <WorkflowNodeEditor
            node={selectedNode}
            upstreamCandidateNodeIds={joinUpstreamCandidates}
            routeCandidateNodeIds={conditionRouteCandidates}
            nodeLabelOptions={nodeLabelOptions}
            modelCandidateOptions={modelCandidateOptions}
            toolCandidateOptions={toolCandidateOptions}
            workflowCandidateOptions={workflowCandidateOptions}
            stateFieldKeyOptions={stateFieldKeyOptions}
            variableSourceOptions={variableSourceOptions}
            onUpdateNode={handleNodeUpdate}
          />
        ) : selectedEdge ? (
          <WorkflowEdgeEditor edge={selectedEdge} onUpdateEdge={handleEdgeUpdate} />
        ) : (
          <p className="placeholder">请在左侧侧栏或画布中选择一个节点或连线开始编辑。</p>
        )}

      </section>

      <style>{`
        .inspector {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .inspector .actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .inspector .save-state {
          border: 1px solid var(--glass-border);
          border-radius: 999px;
          padding: 7px 11px;
          color: var(--text-secondary);
          background: color-mix(in srgb, var(--bg-base) 82%, transparent);
          font-size: 13px;
          white-space: nowrap;
        }
        .inspector .save-state--saving {
          color: #2563eb;
          border-color: rgba(37, 99, 235, 0.32);
        }
        .inspector .save-state--saved {
          color: #0f766e;
          border-color: rgba(15, 118, 110, 0.32);
        }
        .inspector .save-state--blocked,
        .inspector .save-state--error {
          color: #b83333;
          border-color: rgba(184, 51, 51, 0.28);
        }
        .inspector .error {
          color: #b83333;
          font-size: 12px;
        }
        .inspector--compact .panel,
        .inspector--compact .node-editor {
          min-width: 0;
        }
        .inspector--compact .node-editor .field input,
        .inspector--compact .node-editor .field textarea,
        .inspector--compact .node-editor .field select {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }
        .inspector--compact .node-editor .candidate-toggle {
          align-items: flex-start;
        }
        .inspector .panel {
          border: 0;
          border-radius: 0;
          background: transparent;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .inspector .node-editor {
          border: 0;
          border-radius: 0;
          background: transparent;
          padding: 0;
        }
        .inspector .panel-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
        }
        .inspector .placeholder {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
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
