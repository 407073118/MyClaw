import React, { useEffect, useMemo, useState } from "react";
import type {
  WorkflowConditionNode,
  WorkflowHttpRequestNode,
  WorkflowJoinNode,
  WorkflowMergeStrategy,
  WorkflowNode,
  WorkflowNodeInputSource,
  WorkflowVariableRef,
} from "@shared/contracts";
import WorkflowVariablePicker, { type WorkflowVariablePickerItem } from "./WorkflowVariablePicker";

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

export type WorkflowVariableSourceOption = {
  id: string;
  group: string;
  label: string;
  ref: WorkflowVariableRef;
};

export type WorkflowNodeLabelOption = {
  id: string;
  label: string;
};

interface WorkflowNodeEditorProps {
  node: WorkflowNode;
  upstreamCandidateNodeIds?: string[];
  routeCandidateNodeIds?: string[];
  nodeLabelOptions?: WorkflowNodeLabelOption[];
  modelCandidateOptions?: WorkflowEditorOption[];
  toolCandidateOptions?: WorkflowEditorOption[];
  workflowCandidateOptions?: WorkflowEditorOption[];
  stateFieldKeyOptions?: string[];
  variableSourceOptions?: WorkflowVariableSourceOption[];
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
  return kind === "start" ? "开始阶段" : "结束阶段";
}

/** 把内部节点 ID 转成人能看懂的节点名称，避免普通配置界面泄漏实现细节。 */
function formatNodeChoiceLabel(nodeId: string, nodeLabelOptions: WorkflowNodeLabelOption[]): string {
  const matched = nodeLabelOptions.find((option) => option.id === nodeId);
  const label = matched?.label.trim();
  return label || "未命名节点";
}

/** 把结构化变量引用转换成模板 token，供 prompt、HTTP body 等文本字段插入。 */
function formatVariableToken(ref: WorkflowVariableRef): string {
  if (ref.scope === "input" || ref.scope === "run" || ref.scope === "system" || ref.scope === "output" || ref.scope === "secret") {
    return `{{ ${ref.path} }}`;
  }
  return `{{ nodes.${ref.nodeId ?? ""}.${ref.path} }}`;
}

/** 返回节点 kind 的中文标签，供 inspector header 展示。*/
function kindLabel(kind: WorkflowNode["kind"]): string {
  switch (kind) {
    case "start":
      return "开始";
    case "end":
      return "结束";
    case "llm":
      return "对话";
    case "answer":
      return "回复";
    case "template":
      return "模板转换";
    case "code":
      return "代码执行";
    case "variable-assigner":
      return "变量赋值";
    case "tool":
      return "工具调用";
    case "http-request":
      return "HTTP 调用";
    case "human-input":
      return "人工输入";
    case "condition":
      return "条件分支";
    case "subgraph":
      return "子工作流";
    case "join":
      return "汇聚节点";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export default function WorkflowNodeEditor({
  node,
  upstreamCandidateNodeIds = [],
  routeCandidateNodeIds = [],
  nodeLabelOptions = [],
  modelCandidateOptions = [],
  toolCandidateOptions = [],
  workflowCandidateOptions = [],
  stateFieldKeyOptions = [],
  variableSourceOptions = [],
  onUpdateNode,
}: WorkflowNodeEditorProps) {
  const [joinError, setJoinError] = useState("");
  const [joinConfig, setJoinConfig] = useState<WorkflowJoinConfig>({ mode: "all", upstreamNodeIds: [] });
  const [activePromptVariableMenu, setActivePromptVariableMenu] = useState<"system" | "user" | null>(null);

  const stateFieldKeyListId = `workflow-node-editor-state-field-options-${node.id}`;
  const stateFieldPathListId = `workflow-node-editor-state-path-options-${node.id}`;

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
    if (!matched) return "未找到已注册工具。";
    return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
  }, [node, toolCandidateOptions]);

  const selectedWorkflowHint = useMemo(() => {
    if (node.kind !== "subgraph") return "";
    const matched = workflowCandidateOptions.find((option) => option.value === node.subgraph.workflowId);
    if (!matched) return "未找到本地工作流。";
    return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
  }, [node, workflowCandidateOptions]);

  const selectedModelHint = useMemo(() => {
    if (node.kind !== "llm") return "";
    if (!node.llm.model) return "未指定时继承工作流运行配置里的默认模型。";
    const matched = modelCandidateOptions.find((option) => option.value === node.llm.model);
    if (!matched) return "当前模型不在工作区模型列表中，运行时会按模型 ID 尝试解析。";
    return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
  }, [node, modelCandidateOptions]);

  const httpRequestNode = node.kind === "http-request" ? node : null;
  const inputSourceEntries = Object.entries(node.inputSources ?? {});
  const promptVariableItems = useMemo(() => (
    variableSourceOptions.map((option) => ({
      label: option.label,
      token: formatVariableToken(option.ref),
      group: option.group,
      hint: option.id,
    }))
  ), [variableSourceOptions]);

  const variablePickerItems = useMemo<WorkflowVariablePickerItem[]>(() => {
    const items: WorkflowVariablePickerItem[] = [];
    const seen = new Set<string>();

    function addItem(item: WorkflowVariablePickerItem) {
      if (seen.has(item.token)) return;
      seen.add(item.token);
      items.push(item);
    }

    for (const fieldKey of stateFieldKeyOptions) {
      addItem({
        group: "运行变量",
        label: fieldKey,
        token: `{{ ${fieldKey} }}`,
      });
    }
    for (const upstreamNodeId of upstreamCandidateNodeIds) {
      addItem({
        group: "节点输出",
        label: `${formatNodeChoiceLabel(upstreamNodeId, nodeLabelOptions)}.content`,
        token: `{{ nodes.${upstreamNodeId}.content }}`,
      });
    }
    for (const option of variableSourceOptions) {
      addItem({
        group: option.group,
        label: option.label,
        token: formatVariableToken(option.ref),
      });
    }
    return items;
  }, [stateFieldKeyOptions, upstreamCandidateNodeIds, nodeLabelOptions, variableSourceOptions]);

  /** 统一更新节点 label。*/
  function handleLabelInput(e: React.ChangeEvent<HTMLInputElement>) {
    const label = e.target.value;
    console.info("[workflow] 更新节点标签", { nodeId: node.id, label });
    onUpdateNode({ ...node, label } as WorkflowNode);
  }

  function handleLlmPromptInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "llm") return;
    const prompt = e.target.value;
    setActivePromptVariableMenu(prompt.endsWith("@") ? "user" : null);
    console.info("[workflow] 更新对话节点 prompt", { nodeId: node.id, promptLength: prompt.length });
    onUpdateNode({ ...node, llm: { ...node.llm, prompt } });
  }

  /** 更新 LLM 节点系统提示词，用于约束角色、风格、边界和输出规则。 */
  function handleLlmSystemPromptInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "llm") return;
    const systemPrompt = e.target.value;
    setActivePromptVariableMenu(systemPrompt.endsWith("@") ? "system" : null);
    console.info("[workflow] 更新 LLM 节点系统提示词", { nodeId: node.id, promptLength: systemPrompt.length });
    onUpdateNode({ ...node, llm: { ...node.llm, systemPrompt } });
  }

  /** 更新 LLM 节点模型选择；为空时继承运行配置默认模型，避免节点被无效模型卡死。 */
  function handleLlmModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "llm") return;
    const model = e.target.value.trim() || undefined;
    console.info("[workflow] 更新 LLM 节点模型", {
      nodeId: node.id,
      model: model ?? "default",
      mode: model ? "explicit" : "inherit",
    });
    onUpdateNode({ ...node, llm: { ...node.llm, model } });
  }

  /** 将变量 token 插入当前节点最自然的文本字段。*/
  function handleInsertVariableToken(token: string) {
    if (node.kind === "llm") {
      const prompt = `${node.llm.prompt.trimEnd()}${node.llm.prompt.trimEnd() ? " " : ""}${token}`;
      console.info("[workflow] 向对话 prompt 插入变量", { nodeId: node.id, token });
      onUpdateNode({ ...node, llm: { ...node.llm, prompt } });
      return;
    }
    if (node.kind === "http-request") {
      const body = `${node.httpRequest.body ?? ""}${node.httpRequest.body ? " " : ""}${token}`;
      console.info("[workflow] 向 HTTP 请求体插入变量", { nodeId: node.id, token });
      onUpdateNode({ ...node, httpRequest: { ...node.httpRequest, body } });
      return;
    }
    if (node.kind === "answer") {
      const template = `${node.answer.template.trimEnd()}${node.answer.template.trimEnd() ? " " : ""}${token}`;
      console.info("[workflow] 向回复节点插入变量", { nodeId: node.id, token });
      onUpdateNode({ ...node, answer: { ...node.answer, template } });
      return;
    }
    if (node.kind === "template") {
      const template = `${node.template.template.trimEnd()}${node.template.template.trimEnd() ? " " : ""}${token}`;
      console.info("[workflow] 向模板节点插入变量", { nodeId: node.id, token });
      onUpdateNode({ ...node, template: { ...node.template, template } });
    }
  }

  /** 通过 @ 菜单把变量插入系统提示词或用户提示词，并自动替换触发字符。 */
  function handleInsertPromptVariable(target: "system" | "user", token: string) {
    if (node.kind !== "llm") return;
    const normalizedToken = token.trim();
    if (target === "system") {
      const current = node.llm.systemPrompt ?? "";
      const nextSystemPrompt = current.endsWith("@")
        ? `${current.slice(0, -1)}${normalizedToken}`
        : `${current}${current ? " " : ""}${normalizedToken}`;
      console.info("[workflow] 通过 @ 菜单插入系统提示词变量", { nodeId: node.id, token: normalizedToken });
      setActivePromptVariableMenu(null);
      onUpdateNode({ ...node, llm: { ...node.llm, systemPrompt: nextSystemPrompt } });
      return;
    }
    const current = node.llm.prompt;
    const nextPrompt = current.endsWith("@")
      ? `${current.slice(0, -1)}${normalizedToken}`
      : `${current}${current ? " " : ""}${normalizedToken}`;
    console.info("[workflow] 通过 @ 菜单插入用户提示词变量", { nodeId: node.id, token: normalizedToken });
    setActivePromptVariableMenu(null);
    onUpdateNode({ ...node, llm: { ...node.llm, prompt: nextPrompt } });
  }

  function handleLlmOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "llm") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新对话节点输出字段", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, llm: { ...node.llm, outputKey } });
  }

  /** 更新回复节点模板，支持引用上游变量生成 Chatflow 风格的最终话术。 */
  function handleAnswerTemplateInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "answer") return;
    const template = e.target.value;
    console.info("[workflow] 更新回复节点模板", { nodeId: node.id, templateLength: template.length });
    onUpdateNode({ ...node, answer: { ...node.answer, template } });
  }

  /** 更新回复节点写入 outputs 的字段名，默认 answer 会被对话回流优先展示。 */
  function handleAnswerOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "answer") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新回复节点输出字段", { nodeId: node.id, outputKey: outputKey ?? "answer" });
    onUpdateNode({ ...node, answer: { ...node.answer, outputKey } });
  }

  /** 更新模板转换节点文本，用于确定性拼接和格式化上游结果。 */
  function handleTemplateTemplateInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "template") return;
    const template = e.target.value;
    console.info("[workflow] 更新模板转换节点模板", { nodeId: node.id, templateLength: template.length });
    onUpdateNode({ ...node, template: { ...node.template, template } });
  }

  /** 更新模板转换节点输出字段名。 */
  function handleTemplateOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "template") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新模板转换节点输出字段", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, template: { ...node.template, outputKey } });
  }

  /** 更新代码节点源码，运行时会在受限上下文中接收 inputs 和 state。 */
  function handleCodeSourceInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "code") return;
    const source = e.target.value;
    console.info("[workflow] 更新代码节点源码", { nodeId: node.id, sourceLength: source.length });
    onUpdateNode({ ...node, code: { ...node.code, source } });
  }

  /** 更新代码节点输出字段名。 */
  function handleCodeOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "code") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新代码节点输出字段", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, code: { ...node.code, outputKey } });
  }

  /** 更新变量赋值节点的目标 channel，支持写入运行变量或最终输出。 */
  function handleVariableAssignerTargetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "variable-assigner") return;
    const target = e.target.value === "outputs" ? "outputs" : "vars";
    console.info("[workflow] 更新变量赋值节点目标", { nodeId: node.id, target });
    onUpdateNode({ ...node, variableAssigner: { ...node.variableAssigner, target } });
  }

  /** 复制变量 token，方便用户把上游输出粘贴到 Prompt、条件或其它节点配置中。 */
  function handleCopyVariableToken(token: string) {
    console.info("[workflow] 复制 LLM 节点可用变量 token", { nodeId: node.id, token });
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard) {
      void clipboard.writeText(token);
    }
  }

  function handleToolCandidateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "tool") return;
    const toolId = e.target.value;
    if (!toolId) return;
    console.info("[workflow] 选择工具节点工具", { nodeId: node.id, toolId });
    onUpdateNode({ ...node, tool: { ...node.tool, toolId } });
  }

  function handleToolOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "tool") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新工具节点输出字段", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, tool: { ...node.tool, outputKey } });
  }

  /** 生成节点绑定配置的下一版对象，保持输入/输出映射可编辑。*/
  function patchBindings(
    current: Record<string, string> | undefined,
    index: number,
    patch: { key?: string; value?: string },
  ): Record<string, string> | undefined {
    const entries = Object.entries(current ?? {});
    const nextEntries = [...entries];
    const currentEntry = nextEntries[index] ?? ["", ""];
    const nextKey = patch.key ?? currentEntry[0];
    const nextValue = patch.value ?? currentEntry[1];
    if (!nextKey.trim()) {
      nextEntries.splice(index, 1);
    } else {
      nextEntries[index] = [nextKey.trim(), nextValue];
    }
    return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
  }

  /** 新增一个输入绑定占位行，方便用户继续补全流程变量映射。*/
  function handleAddInputBinding() {
    const current = node.inputBindings ?? {};
    const nextKey = `input_${Object.keys(current).length + 1}`;
    console.info("[workflow] 新增节点输入绑定", { nodeId: node.id, nextKey });
    onUpdateNode({ ...node, inputBindings: { ...current, [nextKey]: "" } } as WorkflowNode);
  }

  /** 新增一个输出绑定占位行，方便用户继续补全流程变量映射。*/
  function handleAddOutputBinding() {
    const current = node.outputBindings ?? {};
    const nextKey = `output_${Object.keys(current).length + 1}`;
    console.info("[workflow] 新增节点输出绑定", { nodeId: node.id, nextKey });
    onUpdateNode({ ...node, outputBindings: { ...current, [nextKey]: "" } } as WorkflowNode);
  }

  /** 更新节点输入绑定中的变量名或 state 字段名。*/
  function handleInputBindingChange(
    index: number,
    patch: { key?: string; value?: string },
  ) {
    const nextBindings = patchBindings(node.inputBindings, index, patch);
    console.info("[workflow] 更新节点输入绑定", {
      nodeId: node.id,
      index,
      bindingCount: Object.keys(nextBindings ?? {}).length,
    });
    onUpdateNode({ ...node, inputBindings: nextBindings } as WorkflowNode);
  }

  /** 更新节点输出绑定中的变量名或 state 字段名。*/
  function handleOutputBindingChange(
    index: number,
    patch: { key?: string; value?: string },
  ) {
    const nextBindings = patchBindings(node.outputBindings, index, patch);
    console.info("[workflow] 更新节点输出绑定", {
      nodeId: node.id,
      index,
      bindingCount: Object.keys(nextBindings ?? {}).length,
    });
    onUpdateNode({ ...node, outputBindings: nextBindings } as WorkflowNode);
  }

  /** 生成 typed inputSources 的下一版对象，支持参数名和变量来源同时维护。 */
  function patchInputSources(
    current: Record<string, WorkflowNodeInputSource> | undefined,
    index: number,
    patch: { key?: string; source?: WorkflowNodeInputSource },
  ): Record<string, WorkflowNodeInputSource> | undefined {
    const entries = Object.entries(current ?? {});
    const nextEntries = [...entries];
    const currentEntry = nextEntries[index] ?? ["", { mode: "static", value: "" } as WorkflowNodeInputSource];
    const nextKey = patch.key ?? currentEntry[0];
    const nextSource = patch.source ?? currentEntry[1];
    if (!nextKey.trim()) {
      nextEntries.splice(index, 1);
    } else {
      nextEntries[index] = [nextKey.trim(), nextSource];
    }
    return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
  }

  /** 新增一个 typed 参数来源，默认指向变量中心里的第一个可见变量。 */
  function handleAddInputSource() {
    const firstOption = variableSourceOptions[0];
    if (!firstOption) return;
    const current = node.inputSources ?? {};
    const nextKey = `param_${Object.keys(current).length + 1}`;
    console.info("[workflow] 新增节点 typed 输入来源", {
      nodeId: node.id,
      nextKey,
      variable: firstOption.id,
    });
    onUpdateNode({
      ...node,
      inputSources: {
        ...current,
        [nextKey]: { mode: "variable", ref: { ...firstOption.ref } },
      },
    } as WorkflowNode);
  }

  /** 给 LLM 节点新增一个输入参数；没有可选变量时先创建空文本输入，避免表单断流。 */
  function handleAddLlmInputSource() {
    if (node.kind !== "llm") return;
    const current = node.inputSources ?? {};
    const nextKey = Object.keys(current).length === 0 ? "input" : `input_${Object.keys(current).length + 1}`;
    const firstOption = variableSourceOptions[0];
    console.info("[workflow] 新增 LLM 节点输入参数", {
      nodeId: node.id,
      nextKey,
      hasVariableSource: Boolean(firstOption),
    });
    onUpdateNode({
      ...node,
      inputSources: {
        ...current,
        [nextKey]: firstOption
          ? { mode: "variable", ref: { ...firstOption.ref } }
          : { mode: "static", value: "" },
      },
    });
  }

  /** 更新 LLM 节点静态输入值，变量模式仍然通过下拉选择变量。 */
  function handleLlmInputSourceStaticValueChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const entries = Object.entries(node.inputSources ?? {});
    const currentEntry = entries[index];
    if (!currentEntry) return;
    const nextSources = patchInputSources(node.inputSources, index, {
      source: { mode: "static", value: e.target.value },
    });
    console.info("[workflow] 更新 LLM 节点静态输入值", {
      nodeId: node.id,
      index,
      valueLength: e.target.value.length,
    });
    onUpdateNode({ ...node, inputSources: nextSources } as WorkflowNode);
  }

  /** 更新 typed 参数名，空参数名会删除该行。 */
  function handleInputSourceKeyChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const nextSources = patchInputSources(node.inputSources, index, { key: e.target.value });
    console.info("[workflow] 更新节点 typed 输入参数名", {
      nodeId: node.id,
      index,
      sourceCount: Object.keys(nextSources ?? {}).length,
    });
    onUpdateNode({ ...node, inputSources: nextSources } as WorkflowNode);
  }

  /** 将 typed 参数绑定到变量中心中的某个结构化变量引用。 */
  function handleInputSourceRefChange(index: number, e: React.ChangeEvent<HTMLSelectElement>) {
    const option = variableSourceOptions.find((item) => item.id === e.target.value);
    if (!option) return;
    const nextSources = patchInputSources(node.inputSources, index, {
      source: { mode: "variable", ref: { ...option.ref } },
    });
    console.info("[workflow] 更新节点 typed 输入变量来源", {
      nodeId: node.id,
      index,
      variable: option.id,
    });
    onUpdateNode({ ...node, inputSources: nextSources } as WorkflowNode);
  }

  /** 根据已有 typed 来源反查当前下拉框选项。 */
  function readInputSourceOptionId(source: WorkflowNodeInputSource): string {
    if (source.mode !== "variable") return "";
    const matched = variableSourceOptions.find((option) => (
      option.ref.scope === source.ref.scope &&
      option.ref.nodeId === source.ref.nodeId &&
      option.ref.path === source.ref.path
    ));
    return matched?.id ?? "";
  }

  /** 新增结束节点输出映射，默认把第一个可见变量绑定到 answer 字段。 */
  function buildDefaultEndOutputSource(): WorkflowNodeInputSource {
    const firstOption = variableSourceOptions[0];
    return firstOption
      ? { mode: "variable", ref: { ...firstOption.ref } }
      : { mode: "static", value: "" };
  }

  /** 生成结束节点 outputSources 的下一版对象，空字段名会删除该行。 */
  function patchEndOutputSources(
    index: number,
    patch: { key?: string; source?: WorkflowNodeInputSource },
  ): Record<string, WorkflowNodeInputSource> | undefined {
    if (node.kind !== "end") return undefined;
    const entries = Object.entries(node.outputSources ?? {});
    const nextEntries = [...entries];
    const currentEntry = nextEntries[index] ?? ["answer", buildDefaultEndOutputSource()];
    const nextKey = patch.key ?? currentEntry[0];
    const nextSource = patch.source ?? currentEntry[1];
    if (!nextKey.trim()) {
      nextEntries.splice(index, 1);
    } else {
      nextEntries[index] = [nextKey.trim(), nextSource];
    }
    return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
  }

  /** 为结束节点追加一个最终输出字段，供 workflow run 完成后写入 outputs channel。 */
  function handleAddEndOutputSource() {
    if (node.kind !== "end") return;
    const current = node.outputSources ?? {};
    const nextKey = current.answer ? `output_${Object.keys(current).length + 1}` : "answer";
    const firstOption = variableSourceOptions[0];
    console.info("[workflow] 新增结束节点最终输出字段", {
      nodeId: node.id,
      key: nextKey,
      variable: firstOption?.id ?? null,
    });
    onUpdateNode({
      ...node,
      outputSources: {
        ...current,
        [nextKey]: buildDefaultEndOutputSource(),
      },
    });
  }

  /** 更新结束节点最终输出字段名称。 */
  function handleEndOutputSourceKeyChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "end") return;
    const nextSources = patchEndOutputSources(index, { key: e.target.value });
    console.info("[workflow] 更新结束节点最终输出字段名", {
      nodeId: node.id,
      index,
      sourceCount: Object.keys(nextSources ?? {}).length,
    });
    onUpdateNode({ ...node, outputSources: nextSources });
  }

  /** 将结束节点最终输出绑定到变量中心中的某个结构化变量引用。 */
  function handleEndOutputSourceRefChange(index: number, e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "end") return;
    const option = variableSourceOptions.find((item) => item.id === e.target.value);
    const nextSource: WorkflowNodeInputSource = option
      ? { mode: "variable", ref: { ...option.ref } }
      : { mode: "static", value: "" };
    const nextSources = patchEndOutputSources(index, { source: nextSource });
    console.info("[workflow] 更新结束节点最终输出变量来源", {
      nodeId: node.id,
      index,
      variable: option?.id ?? null,
    });
    onUpdateNode({ ...node, outputSources: nextSources });
  }

  /** 更新结束节点静态输出文本，便于直接写固定的最终回复。 */
  function handleEndOutputSourceStaticValueChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "end") return;
    const nextSources = patchEndOutputSources(index, {
      source: { mode: "static", value: e.target.value },
    });
    console.info("[workflow] 更新结束节点静态最终输出", {
      nodeId: node.id,
      index,
      valueLength: e.target.value.length,
    });
    onUpdateNode({ ...node, outputSources: nextSources });
  }

  /** 新增变量赋值字段，默认读取第一个可见变量来源。 */
  function handleAddVariableAssignment() {
    if (node.kind !== "variable-assigner") return;
    const current = node.variableAssigner.assignments ?? {};
    const nextKey = `field_${Object.keys(current).length + 1}`;
    const firstOption = variableSourceOptions[0];
    const source: WorkflowNodeInputSource = firstOption
      ? { mode: "variable", ref: { ...firstOption.ref } }
      : { mode: "static", value: "" };
    console.info("[workflow] 新增变量赋值字段", {
      nodeId: node.id,
      nextKey,
      target: node.variableAssigner.target,
      variable: firstOption?.id ?? null,
    });
    onUpdateNode({
      ...node,
      variableAssigner: {
        ...node.variableAssigner,
        assignments: { ...current, [nextKey]: source },
      },
    });
  }

  /** 更新变量赋值字段名或来源，空字段名会删除该赋值。 */
  function patchVariableAssignments(
    index: number,
    patch: { key?: string; source?: WorkflowNodeInputSource },
  ): Record<string, WorkflowNodeInputSource> | undefined {
    if (node.kind !== "variable-assigner") return undefined;
    return patchInputSources(node.variableAssigner.assignments, index, patch);
  }

  /** 更新变量赋值字段名。 */
  function handleVariableAssignmentKeyChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "variable-assigner") return;
    const assignments = patchVariableAssignments(index, { key: e.target.value }) ?? {};
    console.info("[workflow] 更新变量赋值字段名", { nodeId: node.id, index, count: Object.keys(assignments).length });
    onUpdateNode({ ...node, variableAssigner: { ...node.variableAssigner, assignments } });
  }

  /** 更新变量赋值来源。 */
  function handleVariableAssignmentRefChange(index: number, e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "variable-assigner") return;
    const option = variableSourceOptions.find((item) => item.id === e.target.value);
    const source: WorkflowNodeInputSource = option
      ? { mode: "variable", ref: { ...option.ref } }
      : { mode: "static", value: "" };
    const assignments = patchVariableAssignments(index, { source }) ?? {};
    console.info("[workflow] 更新变量赋值来源", { nodeId: node.id, index, variable: option?.id ?? null });
    onUpdateNode({ ...node, variableAssigner: { ...node.variableAssigner, assignments } });
  }

  /** 更新变量赋值静态文本。 */
  function handleVariableAssignmentStaticValueChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "variable-assigner") return;
    const assignments = patchVariableAssignments(index, {
      source: { mode: "static", value: e.target.value },
    }) ?? {};
    console.info("[workflow] 更新变量赋值静态值", { nodeId: node.id, index, valueLength: e.target.value.length });
    onUpdateNode({ ...node, variableAssigner: { ...node.variableAssigner, assignments } });
  }

  function handleWorkflowCandidateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "subgraph") return;
    const workflowId = e.target.value;
    if (!workflowId) return;
    console.info("[workflow] 选择子工作流节点 workflowId", { nodeId: node.id, workflowId });
    onUpdateNode({ ...node, subgraph: { ...node.subgraph, workflowId } });
  }

  function handleSubgraphOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "subgraph") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新子工作流节点输出字段", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, subgraph: { ...node.subgraph, outputKey } });
  }

  function handleHttpMethodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "http-request") return;
    const method = e.target.value as WorkflowHttpRequestNode["httpRequest"]["method"];
    console.info("[workflow] 更新 HTTP 请求方法", { nodeId: node.id, method });
    onUpdateNode({ ...node, httpRequest: { ...node.httpRequest, method } });
  }

  function handleHttpUrlInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "http-request") return;
    const url = e.target.value;
    console.info("[workflow] 更新 HTTP 请求 URL", { nodeId: node.id, url });
    onUpdateNode({ ...node, httpRequest: { ...node.httpRequest, url } });
  }

  function handleHttpHeadersInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "http-request") return;
    const raw = e.target.value.trim();
    try {
      const headers = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      console.info("[workflow] 更新 HTTP 请求头", { nodeId: node.id, headerCount: Object.keys(headers).length });
      onUpdateNode({ ...node, httpRequest: { ...node.httpRequest, headers } });
    } catch {
      console.info("[workflow] HTTP 请求头 JSON 解析失败", { nodeId: node.id });
    }
  }

  function handleHttpBodyInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (node.kind !== "http-request") return;
    const body = e.target.value;
    console.info("[workflow] 更新 HTTP 请求体", { nodeId: node.id, bodyLength: body.length });
    onUpdateNode({ ...node, httpRequest: { ...node.httpRequest, body } });
  }

  function handleHttpOutputKeyInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "http-request") return;
    const outputKey = e.target.value.trim() || undefined;
    console.info("[workflow] 更新 HTTP 输出字段", { nodeId: node.id, outputKey: outputKey ?? null });
    onUpdateNode({ ...node, httpRequest: { ...node.httpRequest, outputKey } });
  }

  function updateConditionConfig(patch: Partial<WorkflowConditionNode["condition"]>) {
    if (node.kind !== "condition") return;
    const nextCondition = {
      operator: conditionConfig.operator,
      leftPath: conditionConfig.leftPath,
      ...(conditionConfig.rightValue !== undefined ? { rightValue: conditionConfig.rightValue } : {}),
      ...patch,
    };
    console.info("[workflow] 更新条件节点规则", {
      nodeId: node.id,
      operator: nextCondition.operator,
      leftPath: nextCondition.leftPath,
    });
    onUpdateNode({ ...node, condition: nextCondition });
  }

  function updateConditionRoute(patch: Partial<NonNullable<WorkflowConditionNode["route"]>>) {
    if (node.kind !== "condition") return;
    const nextRoute = { ...(node.route ?? {}), ...patch };
    console.info("[workflow] 更新条件节点路由", { nodeId: node.id });
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

  function handleHumanFieldCandidateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (node.kind !== "human-input") return;
    const formKey = e.target.value;
    if (!formKey) return;
    console.info("[workflow] 选择人工输入结果字段", { nodeId: node.id, formKey });
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
    updateJoinConfig({ mode }, "[workflow] 更新汇聚节点模式", { triggerMode: mode });
  }

  function handleJoinTimeoutMsInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "join") return;
    const rawValue = e.target.value.trim();
    const parsedTimeout = rawValue === "" ? undefined : Number(rawValue);
    const timeoutMs =
      parsedTimeout !== undefined && Number.isFinite(parsedTimeout) && parsedTimeout >= 0
        ? Math.trunc(parsedTimeout)
        : undefined;
    updateJoinConfig({ timeoutMs }, "[workflow] 更新汇聚节点超时", { rawTimeoutMs: rawValue || null });
  }

  function handleJoinUpstreamToggle(candidateId: string, e: React.ChangeEvent<HTMLInputElement>) {
    if (node.kind !== "join") return;
    const checked = e.target.checked;
    const current = joinConfig.upstreamNodeIds;

    if (!checked && current.length <= 1 && current.includes(candidateId)) {
      e.target.checked = true;
      setJoinError("汇聚节点至少要保留一个上游节点。");
      console.info("[workflow] 阻止清空汇聚节点最后一个上游依赖", { nodeId: node.id, candidateId });
      return;
    }

    const next = checked
      ? Array.from(new Set([...current, candidateId]))
      : current.filter((id) => id !== candidateId);

    setJoinError("");
    updateJoinConfig({ upstreamNodeIds: next }, "[workflow] 更新汇聚节点上游依赖", { candidateId, checked });
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
      "[workflow] 更新汇聚字段合并策略",
      { fieldKey, strategy: nextStrategy || null },
    );
  }

  function readJoinMergeStrategy(fieldKey: string): WorkflowMergeStrategy | "" {
    if (node.kind !== "join") return "";
    return joinConfig.mergeStrategyOverrides?.[fieldKey] ?? "";
  }

  return (
    <section className="node-editor" data-testid="workflow-node-editor">
      <h4 className="title">节点配置 · {kindLabel(node.kind)}</h4>

      <label className="field">
        <span>标签</span>
        <input
          data-testid="workflow-node-editor-label"
          type="text"
          value={node.label}
          onChange={handleLabelInput}
        />
      </label>

      {(node.kind === "start" || node.kind === "end") && (
        <section className="subsection">
          <h5 className="subtitle">阶段说明</h5>
          <p className="meta" data-testid="workflow-node-editor-stage-hint">{stageHint(node.kind)}</p>
        </section>
      )}

      {node.kind === "end" && (
        <section className="subsection">
          <div className="binding-header">
            <div>
              <h5 className="subtitle">最终输出</h5>
              <p className="meta">把上游节点结果映射成 workflow outputs，answer 字段会优先回到对话。</p>
            </div>
            <button
              type="button"
              className="ghost"
              data-testid="workflow-node-editor-end-add-output-source"
              onClick={handleAddEndOutputSource}
            >
              新增输出
            </button>
          </div>
          {Object.entries(node.outputSources ?? {}).length === 0 ? (
            <p className="meta">尚未配置最终输出。</p>
          ) : (
            <div className="input-source-list">
              {Object.entries(node.outputSources ?? {}).map(([outputName, source], index) => (
                <div key={`end-output-${outputName}-${index}`} className="input-source-row">
                  <input
                    data-testid={`workflow-node-editor-end-output-key-${index}`}
                    type="text"
                    value={outputName}
                    onChange={(event) => handleEndOutputSourceKeyChange(index, event)}
                  />
                  <span className="binding-arrow">←</span>
                  <select
                    data-testid={`workflow-node-editor-end-output-source-${index}`}
                    value={readInputSourceOptionId(source)}
                    disabled={source.mode !== "variable" && variableSourceOptions.length === 0}
                    onChange={(event) => handleEndOutputSourceRefChange(index, event)}
                  >
                    <option value="">
                      {source.mode === "variable" ? "(选择变量)" : "静态文本"}
                    </option>
                    {variableSourceOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.group} / {option.label}
                      </option>
                    ))}
                  </select>
                  {source.mode === "static" && (
                    <input
                      data-testid={`workflow-node-editor-end-output-static-${index}`}
                      type="text"
                      value={typeof source.value === "string" ? source.value : ""}
                      placeholder="静态输出文本"
                      onChange={(event) => handleEndOutputSourceStaticValueChange(index, event)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {node.kind === "answer" && (
        <section className="subsection">
          <div className="binding-header">
            <div>
              <h5 className="subtitle">回复输出</h5>
              <p className="meta">把模板渲染为 outputs.answer，工作流完成后会优先回到对话。</p>
            </div>
            <button type="button" className="ghost" onClick={() => handleInsertVariableToken("{{ lastLlmOutput }}")}>
              插入上次对话输出
            </button>
          </div>
          <label className="field">
            输出字段
            <input
              data-testid="workflow-node-editor-answer-output-key"
              type="text"
              value={node.answer.outputKey ?? "answer"}
              placeholder="answer"
              onChange={handleAnswerOutputKeyInput}
            />
          </label>
          <label className="field">
            回复模板
            <textarea
              data-testid="workflow-node-editor-answer-template"
              value={node.answer.template}
              rows={6}
              onChange={handleAnswerTemplateInput}
            />
          </label>
        </section>
      )}

      {node.kind === "template" && (
        <section className="subsection">
          <div className="binding-header">
            <div>
              <h5 className="subtitle">模板转换</h5>
              <p className="meta">用变量模板拼装文本，适合格式化 API、工具或模型节点的结果。</p>
            </div>
          </div>
          <label className="field">
            输出字段
            <input
              data-testid="workflow-node-editor-template-output-key"
              type="text"
              value={node.template.outputKey ?? ""}
              placeholder="templateOutput"
              onChange={handleTemplateOutputKeyInput}
            />
          </label>
          <label className="field">
            模板
            <textarea
              data-testid="workflow-node-editor-template-body"
              value={node.template.template}
              rows={6}
              onChange={handleTemplateTemplateInput}
            />
          </label>
        </section>
      )}

      {node.kind === "code" && (
        <section className="subsection">
          <div className="binding-header">
            <div>
              <h5 className="subtitle">代码执行</h5>
              <p className="meta">在受限 JavaScript 上下文中执行，使用 inputs 和 state 读取参数。</p>
            </div>
          </div>
          <label className="field">
            输出字段
            <input
              data-testid="workflow-node-editor-code-output-key"
              type="text"
              value={node.code.outputKey ?? ""}
              placeholder="codeOutput"
              onChange={handleCodeOutputKeyInput}
            />
          </label>
          <label className="field">
            JavaScript
            <textarea
              data-testid="workflow-node-editor-code-source"
              value={node.code.source}
              rows={9}
              spellCheck={false}
              onChange={handleCodeSourceInput}
            />
          </label>
        </section>
      )}

      {node.kind === "variable-assigner" && (
        <section className="subsection">
          <div className="binding-header">
            <div>
              <h5 className="subtitle">变量赋值</h5>
              <p className="meta">把上游结果写入运行变量或最终输出，供后续节点继续引用。</p>
            </div>
            <button
              type="button"
              className="ghost"
              data-testid="workflow-node-editor-variable-add-assignment"
              onClick={handleAddVariableAssignment}
            >
              新增字段
            </button>
          </div>
          <label className="field">
            写入目标
            <select
              data-testid="workflow-node-editor-variable-target"
              value={node.variableAssigner.target}
              onChange={handleVariableAssignerTargetChange}
            >
              <option value="vars">运行变量 vars</option>
              <option value="outputs">最终输出 outputs</option>
            </select>
          </label>
          {Object.entries(node.variableAssigner.assignments ?? {}).length === 0 ? (
            <p className="meta">尚未配置赋值字段。</p>
          ) : (
            <div className="input-source-list">
              {Object.entries(node.variableAssigner.assignments ?? {}).map(([assignmentName, source], index) => (
                <div key={`variable-assignment-${assignmentName}-${index}`} className="input-source-row">
                  <input
                    data-testid={`workflow-node-editor-variable-key-${index}`}
                    type="text"
                    value={assignmentName}
                    onChange={(event) => handleVariableAssignmentKeyChange(index, event)}
                  />
                  <span className="binding-arrow">←</span>
                  <select
                    data-testid={`workflow-node-editor-variable-source-${index}`}
                    value={readInputSourceOptionId(source)}
                    onChange={(event) => handleVariableAssignmentRefChange(index, event)}
                  >
                    <option value="">
                      {source.mode === "variable" ? "(选择变量)" : "静态文本"}
                    </option>
                    {variableSourceOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.group} / {option.label}
                      </option>
                    ))}
                  </select>
                  {source.mode === "static" && (
                    <input
                      data-testid={`workflow-node-editor-variable-static-${index}`}
                      type="text"
                      value={typeof source.value === "string" ? source.value : ""}
                      placeholder="静态变量值"
                      onChange={(event) => handleVariableAssignmentStaticValueChange(index, event)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {node.kind === "llm" && (
        <section className="subsection llm-node-panel">
          <div className="llm-node-panel__heading">
            <h5 className="subtitle">大模型</h5>
            <p className="meta">调用大语言模型，使用变量和提示词生成回复。</p>
          </div>

          <section className="llm-node-panel__block">
            <div className="llm-node-panel__block-title">模型</div>
            <label className="field">
              <select
                data-testid="workflow-node-editor-llm-model"
                value={node.llm.model ?? ""}
                onChange={handleLlmModelChange}
              >
                <option value="">继承默认模型</option>
                {modelCandidateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="meta">{selectedModelHint}</p>
          </section>

          <section className="llm-node-panel__block">
            <div className="llm-node-panel__block-title">
              <span>输入</span>
              <button type="button" className="ghost" onClick={handleAddLlmInputSource}>
                新增
              </button>
            </div>
            <div className="llm-node-panel__input-head">
              <span>变量名</span>
              <span>字段类型</span>
              <span>变量值</span>
            </div>
            {inputSourceEntries.length === 0 ? (
              <p className="meta">暂无输入。需要把变量带进提示词时，点击“新增”。</p>
            ) : (
              <div className="llm-node-panel__input-list">
                {inputSourceEntries.map(([inputName, source], index) => (
                  <div key={`llm-input-${inputName}-${index}`} className="llm-node-panel__input-row">
                    <input
                      data-testid={`workflow-node-editor-llm-input-key-${index}`}
                      type="text"
                      value={inputName}
                      onChange={(event) => handleInputSourceKeyChange(index, event)}
                    />
                    <select value="string" disabled aria-label="字段类型">
                      <option value="string">str. 文本</option>
                    </select>
                    {source.mode === "variable" && variableSourceOptions.length > 0 ? (
                      <select
                        data-testid={`workflow-node-editor-llm-input-ref-${index}`}
                        value={readInputSourceOptionId(source)}
                        onChange={(event) => handleInputSourceRefChange(index, event)}
                      >
                        <option value="">选择变量</option>
                        {variableSourceOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        data-testid={`workflow-node-editor-llm-input-static-${index}`}
                        type="text"
                        value={source.mode === "static" && typeof source.value === "string" ? source.value : ""}
                        placeholder="输入或引用参数值"
                        onChange={(event) => handleLlmInputSourceStaticValueChange(index, event)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="llm-node-panel__block">
            <div className="llm-node-panel__block-title">系统提示词</div>
            <div className="llm-node-panel__prompt-wrap">
              <textarea
                data-testid="workflow-node-editor-llm-system-prompt"
                className="llm-node-panel__textarea"
                rows={5}
                value={node.llm.systemPrompt ?? ""}
                onChange={handleLlmSystemPromptInput}
                onBlur={() => setTimeout(() => setActivePromptVariableMenu(null), 120)}
                placeholder="系统提示词，可以定义角色、风格、边界和输出规则。输入 @ 插入变量。"
              />
              {activePromptVariableMenu === "system" && promptVariableItems.length > 0 && (
                <div className="llm-node-panel__mention-menu">
                  {promptVariableItems.map((item) => (
                    <button
                      key={`system-${item.token}`}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleInsertPromptVariable("system", item.token)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="llm-node-panel__block">
            <div className="llm-node-panel__block-title">用户提示词</div>
            <div className="llm-node-panel__prompt-wrap">
              <textarea
                data-testid="workflow-node-editor-llm-prompt"
                className="llm-node-panel__textarea"
                rows={6}
                value={node.llm.prompt}
                onChange={handleLlmPromptInput}
                onBlur={() => setTimeout(() => setActivePromptVariableMenu(null), 120)}
                placeholder="用户提示词，可以使用变量。输入 @ 插入变量。"
              />
              {activePromptVariableMenu === "user" && promptVariableItems.length > 0 && (
                <div className="llm-node-panel__mention-menu">
                  {promptVariableItems.map((item) => (
                    <button
                      key={`user-${item.token}`}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleInsertPromptVariable("user", item.token)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {variablePickerItems.length > 0 && (
            <section className="llm-node-panel__block">
              <div className="llm-node-panel__block-title">可用变量</div>
              <div className="variable-picker-wrap">
                <WorkflowVariablePicker
                  variables={variablePickerItems}
                  onInsert={handleInsertVariableToken}
                  onCopy={handleCopyVariableToken}
                  compact
                />
              </div>
            </section>
          )}

          <section className="llm-node-panel__block">
            <div className="llm-node-panel__block-title">输出</div>
            <div className="llm-node-panel__output-grid">
              <label className="field">
                <span>变量名</span>
                <input
                  data-testid="workflow-node-editor-llm-output-key"
                  type="text"
                  list={stateFieldKeyListId}
                  value={node.llm.outputKey ?? ""}
                  placeholder="output"
                  onChange={handleLlmOutputKeyInput}
                />
              </label>
              <label className="field">
                <span>变量类型</span>
                <select value="string" disabled>
                  <option value="string">str. String</option>
                </select>
              </label>
            </div>
          </section>
        </section>
      )}

      {(node.kind === "tool" || node.kind === "http-request" || node.kind === "subgraph") && (
        <section className="subsection">
          <h5 className="subtitle">变量绑定</h5>
          <p className="meta">把流程 state 传入节点，并把节点结果写回 state 字段。</p>
          <div className="binding-grid">
            <div className="binding-panel">
              <div className="binding-header">
                <span className="binding-title">输入绑定</span>
                <button type="button" className="ghost" onClick={handleAddInputBinding}>新增</button>
              </div>
              {Object.entries(node.inputBindings ?? {}).length === 0 ? (
                <p className="meta">尚未配置输入绑定。</p>
              ) : (
                Object.entries(node.inputBindings ?? {}).map(([bindingName, channelName], index) => (
                  <div key={`input-${bindingName}-${index}`} className="binding-row">
                    <input
                      type="text"
                      value={bindingName}
                      onChange={(e) => handleInputBindingChange(index, { key: e.target.value })}
                    />
                    <span className="binding-arrow">→</span>
                    <input
                      type="text"
                      list={stateFieldKeyListId}
                      value={channelName}
                      onChange={(e) => handleInputBindingChange(index, { value: e.target.value })}
                    />
                  </div>
                ))
              )}
            </div>

            <div className="binding-panel">
              <div className="binding-header">
                <span className="binding-title">输出绑定</span>
                <button type="button" className="ghost" onClick={handleAddOutputBinding}>新增</button>
              </div>
              {Object.entries(node.outputBindings ?? {}).length === 0 ? (
                <p className="meta">尚未配置输出绑定。</p>
              ) : (
                Object.entries(node.outputBindings ?? {}).map(([bindingName, channelName], index) => (
                  <div key={`output-${bindingName}-${index}`} className="binding-row">
                    <input
                      type="text"
                      value={bindingName}
                      onChange={(e) => handleOutputBindingChange(index, { key: e.target.value })}
                    />
                    <span className="binding-arrow">→</span>
                    <input
                      type="text"
                      list={stateFieldKeyListId}
                      value={channelName}
                      onChange={(e) => handleOutputBindingChange(index, { value: e.target.value })}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="input-source-panel">
            <div className="binding-header">
              <span className="binding-title">参数来源</span>
              <button
                type="button"
                className="ghost"
                data-testid="workflow-node-editor-add-input-source"
                disabled={variableSourceOptions.length === 0}
                onClick={handleAddInputSource}
              >
                选择变量
              </button>
            </div>
            <p className="meta">从变量中心选择输入，运行时会写入 executor 的 resolvedInputs。</p>
            {inputSourceEntries.length === 0 ? (
              <p className="meta">尚未配置结构化参数来源。</p>
            ) : (
              <div className="input-source-list">
                {inputSourceEntries.map(([inputName, source], index) => (
                  <div key={`source-${inputName}-${index}`} className="input-source-row">
                    <input
                      data-testid={`workflow-node-editor-input-source-key-${index}`}
                      type="text"
                      value={inputName}
                      onChange={(e) => handleInputSourceKeyChange(index, e)}
                    />
                    <span className="binding-arrow">←</span>
                    <select
                      data-testid={`workflow-node-editor-input-source-ref-${index}`}
                      value={readInputSourceOptionId(source)}
                      disabled={source.mode !== "variable"}
                      onChange={(e) => handleInputSourceRefChange(index, e)}
                    >
                      <option value="">
                        {source.mode === "variable" ? "(选择变量)" : "暂只支持变量来源"}
                      </option>
                      {variableSourceOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.group} / {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
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
          <p className="meta">{selectedToolHint}</p>
          <label className="field">
            <span>输出字段</span>
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

      {node.kind === "http-request" && httpRequestNode && (
        <section className="subsection">
          <h5 className="subtitle">HTTP 调用</h5>
          <p className="meta">配置方法、URL、请求头、请求体和输出字段。</p>
          <label className="field">
            <span>方法</span>
            <select
              data-testid="workflow-node-editor-http-method"
              value={httpRequestNode.httpRequest.method}
              onChange={handleHttpMethodChange}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
          <label className="field">
            <span>URL</span>
            <input
              data-testid="workflow-node-editor-http-url"
              type="text"
              value={httpRequestNode.httpRequest.url}
              onChange={handleHttpUrlInput}
            />
          </label>
          <label className="field">
            <span>请求头 JSON</span>
            <textarea
              data-testid="workflow-node-editor-http-headers"
              rows={4}
              value={JSON.stringify(httpRequestNode.httpRequest.headers ?? {}, null, 2)}
              onChange={handleHttpHeadersInput}
            />
          </label>
          <label className="field">
            <span>请求体</span>
            <textarea
              data-testid="workflow-node-editor-http-body"
              rows={4}
              value={httpRequestNode.httpRequest.body ?? ""}
              onChange={handleHttpBodyInput}
            />
          </label>
          <label className="field">
            <span>输出字段</span>
            <input
              data-testid="workflow-node-editor-http-output-key"
              type="text"
              list={stateFieldKeyListId}
              value={httpRequestNode.httpRequest.outputKey ?? ""}
              onChange={handleHttpOutputKeyInput}
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
          <p className="meta">{selectedWorkflowHint}</p>
          <label className="field">
            <span>输出字段</span>
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
          <p className="meta">根据条件跳转到 True 或 False 路由。</p>

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
            <span>左侧路径</span>
            <input
              data-testid="workflow-node-editor-condition-left-path"
              type="text"
              list={stateFieldPathListId}
              value={conditionConfig.leftPath}
              onChange={handleConditionLeftPathInput}
            />
          </label>

          <label className="field">
            <span>右侧值</span>
            <input
              data-testid="workflow-node-editor-condition-right-value"
              type="text"
              value={conditionRightValueText}
              disabled={isRightValueDisabled}
              onChange={handleConditionRightValueInput}
            />
          </label>

          <label className="field">
            <span>True 路由</span>
            <select
              data-testid="workflow-node-editor-condition-true-node-id"
              value={conditionConfig.trueNodeId}
              onChange={handleConditionTrueNodeIdChange}
            >
              <option value="">(未配置)</option>
              {routeCandidateNodeIds.map((candidateId) => (
                <option key={`true-${candidateId}`} value={candidateId}>
                  {formatNodeChoiceLabel(candidateId, nodeLabelOptions)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>False 路由</span>
            <select
              data-testid="workflow-node-editor-condition-false-node-id"
              value={conditionConfig.falseNodeId}
              onChange={handleConditionFalseNodeIdChange}
            >
              <option value="">(未配置)</option>
              {routeCandidateNodeIds.map((candidateId) => (
                <option key={`false-${candidateId}`} value={candidateId}>
                  {formatNodeChoiceLabel(candidateId, nodeLabelOptions)}
                </option>
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
                <option value="">(从 state schema 中选择)</option>
                {stateFieldKeyOptions.map((fieldKey) => (
                  <option key={fieldKey} value={fieldKey}>{fieldKey}</option>
                ))}
              </select>
            </label>
          )}
          <p className="meta">运行时会把人工输入结果写回这个字段。</p>
        </section>
      )}

      {node.kind === "join" && (
        <section className="subsection">
          <h5 className="subtitle">汇聚节点</h5>
          <p className="meta">配置汇聚方式、超时和上游节点。</p>
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
            <span>超时 (ms)</span>
            <input
              data-testid="workflow-node-editor-join-timeout-ms"
              type="number"
              min={0}
              step={100}
              value={joinTimeoutInputValue}
              placeholder="留空表示不超时"
              onChange={handleJoinTimeoutMsInput}
            />
          </label>
          <p className="meta">勾选允许进入该汇聚节点的上游节点。</p>
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
                    {formatNodeChoiceLabel(candidateId, nodeLabelOptions)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {stateFieldKeyOptions.length > 0 && (
            <div className="subsection subsection--nested">
              <h6 className="subtitle">字段合并策略</h6>
              <p className="meta">只有在需要覆盖默认合并方式时才修改这里。</p>
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

      <details className="advanced">
        <summary>高级信息</summary>
        <code className="mono" data-testid="workflow-node-editor-node-id">{node.id}</code>
      </details>

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
          font-size: 15px;
        }
        .node-editor .meta {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
        }
        .node-editor .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .node-editor .binding-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .node-editor .binding-panel {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .node-editor .binding-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .node-editor .binding-title {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 600;
        }
        .node-editor .binding-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          gap: 8px;
          align-items: center;
        }
        .node-editor .input-source-panel {
          border: 1px solid color-mix(in srgb, var(--accent-cyan) 26%, var(--glass-border));
          border-radius: var(--radius-md);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: color-mix(in srgb, var(--bg-base) 88%, var(--accent-cyan));
        }
        .node-editor .input-source-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .node-editor .input-source-row {
          display: grid;
          grid-template-columns: minmax(0, 0.72fr) auto minmax(0, 1.28fr);
          gap: 8px;
          align-items: center;
        }
        .node-editor .input-source-row input,
        .node-editor .input-source-row select {
          min-width: 0;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          background: var(--bg-base);
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
        }
        .node-editor .binding-arrow {
          color: var(--text-secondary);
          font-size: 12px;
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
        .node-editor .llm-node-panel {
          gap: 0;
          padding: 0;
          border: 1px solid color-mix(in srgb, var(--accent-cyan) 34%, var(--glass-border));
          border-radius: var(--radius-md);
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--accent-cyan) 8%, transparent), transparent 42%),
            color-mix(in srgb, var(--bg-card) 92%, transparent);
          overflow: hidden;
        }
        .node-editor .llm-node-panel__heading {
          display: grid;
          gap: 4px;
          padding: 12px 12px 10px;
          border-bottom: 1px solid var(--glass-border);
        }
        .node-editor .llm-node-panel__block {
          display: grid;
          gap: 9px;
          padding: 12px;
          border-bottom: 1px solid var(--glass-border);
        }
        .node-editor .llm-node-panel__block:last-child {
          border-bottom: 0;
        }
        .node-editor .llm-node-panel__block-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 700;
        }
        .node-editor .llm-node-panel__input-head,
        .node-editor .llm-node-panel__input-row {
          display: grid;
          grid-template-columns: minmax(92px, 0.8fr) 92px minmax(0, 1.4fr);
          gap: 8px;
          align-items: center;
        }
        .node-editor .llm-node-panel__input-head {
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
        }
        .node-editor .llm-node-panel__input-list {
          display: grid;
          gap: 7px;
        }
        .node-editor .llm-node-panel__input-row input,
        .node-editor .llm-node-panel__input-row select,
        .node-editor .llm-node-panel__output-grid input,
        .node-editor .llm-node-panel__output-grid select {
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          background: var(--bg-base);
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
        }
        .node-editor .llm-node-panel__input-row select:disabled,
        .node-editor .llm-node-panel__output-grid select:disabled {
          color: var(--text-secondary);
          opacity: 1;
        }
        .node-editor .llm-node-panel__textarea {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          padding: 10px 11px;
          background: var(--bg-base);
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
          line-height: 1.6;
          resize: vertical;
        }
        .node-editor .llm-node-panel__prompt-wrap {
          position: relative;
        }
        .node-editor .llm-node-panel__mention-menu {
          position: absolute;
          left: 10px;
          right: 10px;
          bottom: 10px;
          z-index: 20;
          display: grid;
          gap: 4px;
          max-height: 180px;
          overflow: auto;
          padding: 6px;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: color-mix(in srgb, var(--bg-base) 96%, transparent);
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.38);
        }
        .node-editor .llm-node-panel__mention-menu button {
          min-width: 0;
          border: 0;
          border-radius: var(--radius-sm);
          padding: 7px 9px;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        .node-editor .llm-node-panel__mention-menu button:hover {
          background: color-mix(in srgb, var(--accent-cyan) 14%, transparent);
        }
        .node-editor .llm-node-panel__output-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(120px, 0.45fr);
          gap: 8px;
          align-items: end;
        }
        .node-editor .variable-picker-wrap {
          border: 1px solid color-mix(in srgb, var(--glass-border) 70%, transparent);
          border-radius: var(--radius-sm);
          padding: 8px;
          background: color-mix(in srgb, var(--bg-base) 74%, transparent);
        }
        .node-editor .ghost {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          padding: 5px 9px;
          background: color-mix(in srgb, var(--bg-base) 80%, transparent);
          color: var(--text-secondary);
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }
        .node-editor .ghost:hover:not(:disabled) {
          color: var(--text-primary);
          border-color: color-mix(in srgb, var(--accent-cyan) 38%, var(--glass-border));
          background: color-mix(in srgb, var(--accent-cyan) 10%, var(--bg-base));
        }
        .node-editor .ghost:disabled {
          cursor: not-allowed;
          opacity: 0.55;
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
          font-size: 14px;
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
          font-size: 13px;
        }
        .node-editor .error {
          color: #b83333;
          font-size: 13px;
        }
        .node-editor .advanced {
          border-top: 1px solid var(--glass-border);
          padding-top: 10px;
          font-size: 13px;
          color: var(--text-muted);
        }
        .node-editor .advanced summary {
          cursor: pointer;
          user-select: none;
        }
        .node-editor .advanced .mono {
          display: inline-block;
          margin-top: 6px;
          font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace);
          color: var(--text-muted);
        }
      `}</style>
    </section>
  );
}
