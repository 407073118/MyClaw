import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkflowConditionNode,
  WorkflowJoinNode,
  WorkflowMergeStrategy,
  WorkflowNode,
  WorkflowNodePolicy,
} from "@shared/contracts";

import WorkflowExecutionPolicyEditor from "./WorkflowExecutionPolicyEditor";

type WorkflowConditionOperator =
  | "equals"
  | "not-equals"
  | "greater-than"
  | "greater-or-equal"
  | "less-than"
  | "less-or-equal"
  | "exists"
  | "not-exists"
  | "in"
  | "not-in";

type WorkflowConditionNodeConfig = {
  operator: WorkflowConditionOperator;
  leftPath: string;
  rightValue?: string | number | boolean | null | string[];
  trueNodeId: string;
  falseNodeId: string;
};

type WorkflowJoinConfig = WorkflowJoinNode["join"];

export type WorkflowEditorOption = {
  value: string;
  label: string;
  hint?: string;
};

interface WorkflowNodeEditorProps {
  node: WorkflowNode;
  upstreamCandidateNodeIds?: string[];
  routeCandidateNodeIds?: string[];
  toolCandidateOptions?: WorkflowEditorOption[];
  workflowCandidateOptions?: WorkflowEditorOption[];
  stateFieldKeyOptions?: string[];
  onUpdateNode: (value: WorkflowNode) => void;
}

const conditionOperatorOptions: WorkflowConditionOperator[] = [
  "equals",
  "not-equals",
  "greater-than",
  "greater-or-equal",
  "less-than",
  "less-or-equal",
  "exists",
  "not-exists",
  "in",
  "not-in",
];

function normalizeConditionOperator(value: unknown): WorkflowConditionOperator {
  return conditionOperatorOptions.includes(value as WorkflowConditionOperator)
    ? (value as WorkflowConditionOperator)
    : "exists";
}

function formatConditionValue(value: WorkflowConditionNodeConfig["rightValue"]): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function parseConditionValue(text: string, operator: WorkflowConditionOperator) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (operator === "in" || operator === "not-in") {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  const parsedNumber = Number(trimmed);
  if (!Number.isNaN(parsedNumber) && trimmed === String(parsedNumber)) return parsedNumber;
  return trimmed;
}

function stageHint(kind: "start" | "end") {
  return kind === "start"
    ? "入口阶段：负责定义工作流启动点。"
    : "终止阶段：负责收敛结果并结束本次执行。";
}

export default function WorkflowNodeEditor({
  node,
  upstreamCandidateNodeIds = [],
  routeCandidateNodeIds = [],
  toolCandidateOptions = [],
  workflowCandidateOptions = [],
  stateFieldKeyOptions = [],
  onUpdateNode,
}: WorkflowNodeEditorProps) {
  const [joinError, setJoinError] = useState("");
  const [joinConfig, setJoinConfig] = useState<WorkflowJoinConfig>({ mode: "all", upstreamNodeIds: [] });

  const toolOptionListId = `workflow-node-editor-tool-options-${node.id}`;
  const workflowOptionListId = `workflow-node-editor-workflow-options-${node.id}`;
  const stateFieldKeyListId = `workflow-node-editor-state-field-options-${node.id}`;
  const stateFieldPathListId = `workflow-node-editor-state-path-options-${node.id}`;

  // Sync joinConfig when node changes
  useEffect(() => {
    setJoinError("");
    if (node.kind !== "join") {
      setJoinConfig({ mode: "all", upstreamNodeIds: [] });
      return;
    }
    setJoinConfig({
      mode: node.join.mode,
      upstreamNodeIds: [...node.join.upstreamNodeIds],
      ...(typeof node.join.timeoutMs === "number" ? { timeoutMs: node.join.timeoutMs } : {}),
      ...(node.join.mergeStrategyOverrides ? { mergeStrategyOverrides: { ...node.join.mergeStrategyOverrides } } : {}),
    });
  }, [node]);

  const conditionConfig = useMemo<WorkflowConditionNodeConfig>(() => {
    if (node.kind !== "condition") {
      return { operator: "exists", leftPath: "$.state.result", rightValue: "", trueNodeId: "", falseNodeId: "" };
    }
    return {
      operator: normalizeConditionOperator(node.condition?.operator),
      leftPath:
        typeof node.condition?.leftPath === "string" && node.condition.leftPath.trim()
          ? node.condition.leftPath
          : "$.state.result",
      rightValue: node.condition?.rightValue as WorkflowConditionNodeConfig["rightValue"],
      trueNodeId: node.route?.trueNodeId ?? "",
      falseNodeId: node.route?.falseNodeId ?? "",
    };
  }, [node]);

  const conditionRightValueText = formatConditionValue(conditionConfig.rightValue);
  const isRightValueDisabled =
    conditionConfig.operator === "exists" || conditionConfig.operator === "not-exists";

  const joinTimeoutInputValue =
    typeof joinConfig.timeoutMs === "number" ? String(joinConfig.timeoutMs) : "";

  const stateFieldPathOptions = useMemo(() => {
    const optionSet = new Set<string>();
    for (const fieldKey of stateFieldKeyOptions) {
      const normalizedKey = fieldKey.trim();
      if (!normalizedKey) continue;
      optionSet.add(normalizedKey);
      optionSet.add(`$.${normalizedKey}`);
    }
    return [...optionSet];
  }, [stateFieldKeyOptions]);

  const selectedToolHint = useMemo(() => {
    if (node.kind !== "tool") return "";
    const matched = toolCandidateOptions.find((option) => option.value === node.tool.toolId);
    if (!matched) return "未匹配到已注册工具，可直接输入自定义 Tool ID。";
    return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
  }, [node, toolCandidateOptions]);

  const selectedWorkflowHint = useMemo(() => {
    if (node.kind !== "subgraph") return "";
    const matched = workflowCandidateOptions.find((option) => option.value === node.subgraph.workflowId);
    if (!matched) return "未匹配到本地工作流，可直接输入已存在的 workflowId。";
    return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
  }, [node, workflowCandidateOptions]);

  /** 统一更新节点 label。 */
  function handleLabelInput(e: React.ChangeEvent<HTMLInputElement>) {
    const label = e.target.value;
    console.info("[workflow] 更新节点 label", { nodeId: node.id, label });
    onUpdateNode({ ...node, label } as WorkflowNode);
  }

  /** 统一更新节点执行策略。 */
  function handlePolicyUpdate(policy: WorkflowNodePolicy | undefined) {
    console.info("[workflow] 更新节点 policy", { nodeId: node.id, policy: policy ?? null });
    onUpdateNode({ ...node, policy } as WorkflowNode);
  }

  function handleLlmPromptInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "llm") return;
    const prompt = e.target.value;
    console.info("[workflow] 更新 llm 节点 prompt", { nodeId: node.id, promptLength: prompt.length });
    onUpdateNode({ ...node, llm: { ...node.llm, prompt } });
  }

  function handleLlmOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "llm") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新 llm 节点 outputKey", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, llm: { ...node.llm, outputKey } });
  }

  function handleToolIdInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "tool") return;
    const toolId = e.target.value;
    console.info("[workflow] 更新 tool 节点 toolId", { nodeId: node.id, toolId });
    onUpdateNode({ ...node, tool: { ...node.tool, toolId } });
  }

  function handleToolCandidateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "tool") return;
    const toolId = e.target.value;
    if (!toolId) return;
    console.info("[workflow] 从候选列表选择 tool 节点 toolId", { nodeId: node.id, toolId });
    onUpdateNode({ ...node, tool: { ...node.tool, toolId } });
  }

  function handleToolOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "tool") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新 tool 节点 outputKey", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, tool: { ...node.tool, outputKey } });
  }

  function handleSubgraphWorkflowIdInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "subgraph") return;
    const workflowId = e.target.value;
    console.info("[workflow] 更新 subgraph 节点 workflowId", { nodeId: node.id, workflowId });
    onUpdateNode({ ...node, subgraph: { ...node.subgraph, workflowId } });
  }

  function handleWorkflowCandidateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "subgraph") return;
    const workflowId = e.target.value;
    if (!workflowId) return;
    console.info("[workflow] 从候选列表选择 subgraph 节点 workflowId", { nodeId: node.id, workflowId });
    onUpdateNode({ ...node, subgraph: { ...node.subgraph, workflowId } });
  }

  function handleSubgraphOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "subgraph") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新 subgraph 节点 outputKey", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, subgraph: { ...node.subgraph, outputKey } });
  }

  function updateConditionConfig(patch: Partial<WorkflowConditionNode["condition"]>) {
    if (node.kind !== "condition") return;
    const nextCondition = {
      operator: conditionConfig.operator,
      leftPath: conditionConfig.leftPath,
      ...(conditionConfig.rightValue !== undefined ? { rightValue: conditionConfig.rightValue } : {}),
      ...patch,
    };
    console.info("[workflow] 更新 condition 节点规则", {
      nodeId: node.id,
      operator: nextCondition.operator,
      leftPath: nextCondition.leftPath,
    });
    onUpdateNode({ ...node, condition: nextCondition });
  }

  function updateConditionRoute(patch: Partial<NonNullable<WorkflowConditionNode["route"]>>) {
    if (node.kind !== "condition") return;
    const nextRoute = { ...(node.route ?? {}), ...patch };
    console.info("[workflow] 更新 condition 节点路由", { nodeId: node.id });
    onUpdateNode({ ...node, route: nextRoute });
  }

  function handleConditionOperatorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const operator = normalizeConditionOperator(e.target.value);
    const patch: Partial<WorkflowConditionNode["condition"]> = { operator };
    if (operator === "exists" || operator === "not-exists") {
      patch.rightValue = undefined;
    }
    updateConditionConfig(patch);
  }

  function handleConditionLeftPathInput(e: React.ChangeEvent<HTMLInputElement>) {
    updateConditionConfig({ leftPath: e.target.value });
  }

  function handleConditionRightValueInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (isRightValueDisabled) {
      updateConditionConfig({ rightValue: undefined });
      return;
    }
    updateConditionConfig({ rightValue: parseConditionValue(e.target.value, conditionConfig.operator) });
  }

  function handleConditionTrueNodeIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
    updateConditionRoute({ trueNodeId: e.target.value || undefined });
  }

  function handleConditionFalseNodeIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
    updateConditionRoute({ falseNodeId: e.target.value || undefined });
  }

  function handleHumanFormKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "human-input") return;
    const formKey = e.target.value;
    console.info("[workflow] 更新 human-input formKey", { nodeId: node.id, formKey });
    onUpdateNode({ ...node, humanInput: { ...node.humanInput, formKey } });
  }

  function handleHumanFieldCandidateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "human-input") return;
    const formKey = e.target.value;
    if (!formKey) return;
    console.info("[workflow] 从候选列表选择 human-input 结果字段", { nodeId: node.id, formKey });
    onUpdateNode({ ...node, humanInput: { ...node.humanInput, formKey } });
  }

  function updateJoinConfig(
    patch: Partial<WorkflowJoinConfig>,
    logMessage: string,
    logPayload: Record<string, unknown>,
  ) {
    if (node.kind !== "join") return;
    const nextJoin: WorkflowJoinConfig = {
      ...joinConfig,
      ...patch,
      upstreamNodeIds: patch.upstreamNodeIds ? [...patch.upstreamNodeIds] : [...joinConfig.upstreamNodeIds],
      ...(patch.mergeStrategyOverrides ? { mergeStrategyOverrides: { ...patch.mergeStrategyOverrides } } : {}),
    };
    if ("mergeStrategyOverrides" in patch && !patch.mergeStrategyOverrides) {
      delete nextJoin.mergeStrategyOverrides;
    }
    setJoinConfig(nextJoin);
    console.info(logMessage, {
      nodeId: node.id,
      ...logPayload,
      mode: nextJoin.mode,
      timeoutMs: nextJoin.timeoutMs ?? null,
      upstreamNodeIds: nextJoin.upstreamNodeIds,
      mergeStrategyOverrides: nextJoin.mergeStrategyOverrides ?? null,
    });
    onUpdateNode({ ...node, join: nextJoin });
  }

  function isJoinUpstreamSelected(candidateId: string): boolean {
    if (node.kind !== "join") return false;
    return joinConfig.upstreamNodeIds.includes(candidateId);
  }

  function handleJoinModeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "join") return;
    const mode = e.target.value === "any" ? "any" : "all";
    updateJoinConfig({ mode }, "[workflow] 更新 join 汇聚模式", { triggerMode: mode });
  }

  function handleJoinTimeoutMsInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "join") return;
    const rawValue = e.target.value.trim();
    const parsedTimeout = rawValue === "" ? undefined : Number(rawValue);
    const timeoutMs =
      parsedTimeout !== undefined && Number.isFinite(parsedTimeout) && parsedTimeout >= 0
        ? Math.trunc(parsedTimeout)
        : undefined;
    updateJoinConfig({ timeoutMs }, "[workflow] 更新 join 超时配置", { rawTimeoutMs: rawValue || null });
  }

  function handleJoinUpstreamToggle(candidateId: string, e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "join") return;
    const checked = e.target.checked;
    const current = joinConfig.upstreamNodeIds;

    if (!checked && current.length <= 1 && current.includes(candidateId)) {
      e.target.checked = true;
      setJoinError("汇聚节点至少要保留一个上游节点。");
      console.info("[workflow] 阻止清空最后一个 join 上游依赖", { nodeId: node.id, candidateId });
      return;
    }

    const next = checked
      ? Array.from(new Set([...current, candidateId]))
      : current.filter((id) => id !== candidateId);

    setJoinError("");
    updateJoinConfig({ upstreamNodeIds: next }, "[workflow] 更新 join 上游依赖配置", { candidateId, checked });
  }

  function handleJoinMergeStrategyChange(fieldKey: string, e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "join") return;
    const nextStrategy = e.target.value as WorkflowMergeStrategy | "";
    const nextOverrides = { ...(joinConfig.mergeStrategyOverrides ?? {}) };
    if (!nextStrategy) {
      delete nextOverrides[fieldKey];
    } else {
      nextOverrides[fieldKey] = nextStrategy;
    }
    updateJoinConfig(
      { mergeStrategyOverrides: Object.keys(nextOverrides).length ? nextOverrides : undefined },
      "[workflow] 更新 join 字段合并策略",
      { fieldKey, strategy: nextStrategy || null },
    );
  }

  function readJoinMergeStrategy(fieldKey: string): WorkflowMergeStrategy | "" {
    if (node.kind !== "join") return "";
    return joinConfig.mergeStrategyOverrides?.[fieldKey] ?? "";
  }

  return (
    <section className="node-editor" data-testid="workflow-node-editor">
      <h4 className="title">节点配置</h4>
      <p className="meta">{node.id} ({node.kind})</p>

      <label className="field">
        <span>标签</span>
        <input
          data-testid="workflow-node-editor-label"
          type="text"
          value={node.label}
          onChange={handleLabelInput}
        />
      </label>

      <WorkflowExecutionPolicyEditor policy={node.policy} onUpdatePolicy={handlePolicyUpdate} />

      {(node.kind === "start" || node.kind === "end") && (
        <section className="subsection">
          <h5 className="subtitle">阶段说明</h5>
          <p className="meta" data-testid="workflow-node-editor-stage-hint">{stageHint(node.kind)}</p>
        </section>
      )}

      {node.kind === "llm" && (
        <section className="subsection">
          <h5 className="subtitle">LLM 节点</h5>
          <label className="field">
            <span>提示词</span>
            <textarea
              data-testid="workflow-node-editor-llm-prompt"
              rows={4}
              value={node.llm.prompt}
              onChange={handleLlmPromptInput}
            />
          </label>
          <label className="field">
            <span>输出键</span>
            <input
              data-testid="workflow-node-editor-llm-output-key"
              type="text"
              list={stateFieldKeyListId}
              value={node.llm.outputKey ?? ""}
              onChange={handleLlmOutputKeyInput}
            />
          </label>
          <p className="meta">建议把 LLM 输出绑定到已有状态字段，避免后续节点继续手写路径。</p>
        </section>
      )}

      {node.kind === "tool" && (
        <section className="subsection">
          <h5 className="subtitle">工具节点</h5>
          {toolCandidateOptions.length > 0 && (
            <label className="field">
              <span>选择工具</span>
              <select
                data-testid="workflow-node-editor-tool-candidate"
                value={node.tool.toolId}
                onChange={handleToolCandidateChange}
              >
                <option value="">(从已注册工具中选择)</option>
                {toolCandidateOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Tool ID</span>
            <input
              data-testid="workflow-node-editor-tool-id"
              type="text"
              list={toolOptionListId}
              value={node.tool.toolId}
              onChange={handleToolIdInput}
            />
          </label>
          <p className="meta">{selectedToolHint}</p>
          <label className="field">
            <span>输出键</span>
            <input
              data-testid="workflow-node-editor-tool-output-key"
              type="text"
              list={stateFieldKeyListId}
              value={node.tool.outputKey ?? ""}
              onChange={handleToolOutputKeyInput}
            />
          </label>
        </section>
      )}

      {node.kind === "subgraph" && (
        <section className="subsection">
          <h5 className="subtitle">子工作流节点</h5>
          {workflowCandidateOptions.length > 0 && (
            <label className="field">
              <span>选择子工作流</span>
              <select
                data-testid="workflow-node-editor-subgraph-candidate"
                value={node.subgraph.workflowId}
                onChange={handleWorkflowCandidateChange}
              >
                <option value="">(从当前工作区选择)</option>
                {workflowCandidateOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>工作流 ID</span>
            <input
              data-testid="workflow-node-editor-subgraph-workflow-id"
              type="text"
              list={workflowOptionListId}
              value={node.subgraph.workflowId}
              onChange={handleSubgraphWorkflowIdInput}
            />
          </label>
          <p className="meta">{selectedWorkflowHint}</p>
          <label className="field">
            <span>输出键</span>
            <input
              data-testid="workflow-node-editor-subgraph-output-key"
              type="text"
              list={stateFieldKeyListId}
              value={node.subgraph.outputKey ?? ""}
              onChange={handleSubgraphOutputKeyInput}
            />
          </label>
        </section>
      )}

      {node.kind === "condition" && (
        <section className="subsection">
          <h5 className="subtitle">条件分支</h5>
          <p className="meta">条件命中后走 True Route，否则走 False Route。</p>

          <label className="field">
            <span>运算符</span>
            <select
              data-testid="workflow-node-editor-condition-operator"
              value={conditionConfig.operator}
              onChange={handleConditionOperatorChange}
            >
              {conditionOperatorOptions.map((operator) => (
                <option key={operator} value={operator}>{operator}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>左值路径</span>
            <input
              data-testid="workflow-node-editor-condition-left-path"
              type="text"
              list={stateFieldPathListId}
              value={conditionConfig.leftPath}
              onChange={handleConditionLeftPathInput}
            />
          </label>

          <label className="field">
            <span>右值</span>
            <input
              data-testid="workflow-node-editor-condition-right-value"
              type="text"
              value={conditionRightValueText}
              disabled={isRightValueDisabled}
              onChange={handleConditionRightValueInput}
            />
          </label>

          <label className="field">
            <span>True Route</span>
            <select
              data-testid="workflow-node-editor-condition-true-node-id"
              value={conditionConfig.trueNodeId}
              onChange={handleConditionTrueNodeIdChange}
            >
              <option value="">(未配置)</option>
              {routeCandidateNodeIds.map((candidateId) => (
                <option key={`true-${candidateId}`} value={candidateId}>{candidateId}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>False Route</span>
            <select
              data-testid="workflow-node-editor-condition-false-node-id"
              value={conditionConfig.falseNodeId}
              onChange={handleConditionFalseNodeIdChange}
            >
              <option value="">(未配置)</option>
              {routeCandidateNodeIds.map((candidateId) => (
                <option key={`false-${candidateId}`} value={candidateId}>{candidateId}</option>
              ))}
            </select>
          </label>
        </section>
      )}

      {node.kind === "human-input" && (
        <section className="subsection">
          <h5 className="subtitle">人工输入节点</h5>
          {stateFieldKeyOptions.length > 0 && (
            <label className="field">
              <span>选择结果字段</span>
              <select
                data-testid="workflow-node-editor-human-field-candidate"
                value={node.humanInput.formKey}
                onChange={handleHumanFieldCandidateChange}
              >
                <option value="">(从 state schema 选择)</option>
                {stateFieldKeyOptions.map((fieldKey) => (
                  <option key={fieldKey} value={fieldKey}>{fieldKey}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>结果字段</span>
            <input
              data-testid="workflow-node-editor-human-form-key"
              type="text"
              list={stateFieldKeyListId}
              value={node.humanInput.formKey}
              onChange={handleHumanFormKeyInput}
            />
          </label>
          <p className="meta">runtime 会把人工输入结果写回这个字段，优先复用 state schema 里的正式字段键。</p>
        </section>
      )}

      {node.kind === "join" && (
        <section className="subsection">
          <h5 className="subtitle">汇聚节点</h5>
          <p className="meta">为当前汇聚节点配置触发模式、等待超时和有效上游。</p>
          <label className="field">
            <span>汇聚模式</span>
            <select
              data-testid="workflow-node-editor-join-mode"
              value={joinConfig.mode}
              onChange={handleJoinModeChange}
            >
              <option value="all">等待全部上游</option>
              <option value="any">任一上游即可</option>
            </select>
          </label>
          <label className="field">
            <span>超时（毫秒）</span>
            <input
              data-testid="workflow-node-editor-join-timeout-ms"
              type="number"
              min={0}
              step={100}
              value={joinTimeoutInputValue}
              placeholder="留空表示不限制"
              onChange={handleJoinTimeoutMsInput}
            />
          </label>
          <p className="meta">选择允许汇入当前 Join 的上游节点。</p>
          {joinError && (
            <p data-testid="workflow-node-editor-join-error" className="error">{joinError}</p>
          )}
          <ul className="candidate-list">
            {upstreamCandidateNodeIds.map((candidateId) => (
              <li key={candidateId} className="candidate-row">
                <label className="candidate-toggle">
                  <input
                    data-testid={`workflow-node-editor-join-upstream-toggle-${candidateId}`}
                    type="checkbox"
                    checked={isJoinUpstreamSelected(candidateId)}
                    onChange={(e) => handleJoinUpstreamToggle(candidateId, e)}
                  />
                  <span data-testid={`workflow-node-editor-join-upstream-candidate-${candidateId}`}>
                    {candidateId}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {stateFieldKeyOptions.length > 0 && (
            <div className="subsection subsection--nested">
              <h6 className="subtitle">字段合并策略</h6>
              <p className="meta">仅为需要在汇聚节点覆盖默认合并方式的字段单独配置。</p>
              {stateFieldKeyOptions.map((fieldKey) => (
                <label key={fieldKey} className="field">
                  <span>{fieldKey}</span>
                  <select
                    data-testid={`workflow-node-editor-join-merge-${fieldKey}`}
                    value={readJoinMergeStrategy(fieldKey)}
                    onChange={(e) => handleJoinMergeStrategyChange(fieldKey, e)}
                  >
                    <option value="">继承默认策略</option>
                    <option value="replace">replace</option>
                    <option value="append">append</option>
                    <option value="union">union</option>
                    <option value="object-merge">object-merge</option>
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {toolCandidateOptions.length > 0 && (
        <datalist id={toolOptionListId}>
          {toolCandidateOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </datalist>
      )}
      {workflowCandidateOptions.length > 0 && (
        <datalist id={workflowOptionListId}>
          {workflowCandidateOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </datalist>
      )}
      {stateFieldKeyOptions.length > 0 && (
        <datalist id={stateFieldKeyListId}>
          {stateFieldKeyOptions.map((fieldKey) => (
            <option key={fieldKey} value={fieldKey} />
          ))}
        </datalist>
      )}
      {stateFieldPathOptions.length > 0 && (
        <datalist id={stateFieldPathListId}>
          {stateFieldPathOptions.map((fieldPath) => (
            <option key={fieldPath} value={fieldPath} />
          ))}
        </datalist>
      )}

      <style>{`
        .node-editor {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          padding: 12px;
          background: var(--bg-card);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .node-editor .title {
          margin: 0;
          color: var(--text-primary);
          font-size: 14px;
        }
        .node-editor .meta {
          margin: 0;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .node-editor .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .node-editor .field input,
        .node-editor .field textarea,
        .node-editor .field select {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          background: var(--bg-base);
          color: var(--text-primary);
          font: inherit;
        }
        .node-editor .subsection {
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-top: 1px solid var(--glass-border);
          padding-top: 10px;
        }
        .node-editor .subsection--nested {
          border-top: 1px dashed var(--glass-border);
        }
        .node-editor .subtitle {
          margin: 0;
          color: var(--text-primary);
          font-size: 13px;
        }
        .node-editor .candidate-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .node-editor .candidate-row {
          margin: 0;
        }
        .node-editor .candidate-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .node-editor .error {
          color: #b83333;
          font-size: 12px;
        }
      `}</style>
    </section>
  );
}
