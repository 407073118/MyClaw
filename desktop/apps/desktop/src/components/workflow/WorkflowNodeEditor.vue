<template>
  <section class="node-editor" data-testid="workflow-node-editor">
    <h4 class="title">节点配置</h4>
    <p class="meta">{{ node.id }} ({{ node.kind }})</p>

    <label class="field">
      <span>标签</span>
      <input
        data-testid="workflow-node-editor-label"
        type="text"
        :value="node.label"
        @input="handleLabelInput"
      />
    </label>

    <WorkflowExecutionPolicyEditor :policy="node.policy" @update:policy="handlePolicyUpdate" />

    <section v-if="node.kind === 'start' || node.kind === 'end'" class="subsection">
      <h5 class="subtitle">阶段说明</h5>
      <p class="meta" data-testid="workflow-node-editor-stage-hint">{{ stageHint(node.kind) }}</p>
    </section>

    <section v-if="node.kind === 'llm'" class="subsection">
      <h5 class="subtitle">LLM 节点</h5>
      <label class="field">
        <span>提示词</span>
        <textarea
          data-testid="workflow-node-editor-llm-prompt"
          rows="4"
          :value="node.llm.prompt"
          @input="handleLlmPromptInput"
        />
      </label>
      <label class="field">
        <span>输出键</span>
        <input
          data-testid="workflow-node-editor-llm-output-key"
          type="text"
          :list="stateFieldKeyListId"
          :value="node.llm.outputKey ?? ''"
          @input="handleLlmOutputKeyInput"
        />
      </label>
      <p class="meta">建议把 LLM 输出绑定到已有状态字段，避免后续节点继续手写路径。</p>
    </section>

    <section v-if="node.kind === 'tool'" class="subsection">
      <h5 class="subtitle">工具节点</h5>
      <label v-if="toolCandidateOptions.length" class="field">
        <span>选择工具</span>
        <select
          data-testid="workflow-node-editor-tool-candidate"
          :value="node.tool.toolId"
          @change="handleToolCandidateChange"
        >
          <option value="">(从已注册工具中选择)</option>
          <option v-for="option in toolCandidateOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Tool ID</span>
        <input
          data-testid="workflow-node-editor-tool-id"
          type="text"
          :list="toolOptionListId"
          :value="node.tool.toolId"
          @input="handleToolIdInput"
        />
      </label>
      <p class="meta">{{ selectedToolHint }}</p>
      <label class="field">
        <span>输出键</span>
        <input
          data-testid="workflow-node-editor-tool-output-key"
          type="text"
          :list="stateFieldKeyListId"
          :value="node.tool.outputKey ?? ''"
          @input="handleToolOutputKeyInput"
        />
      </label>
    </section>

    <section v-if="node.kind === 'subgraph'" class="subsection">
      <h5 class="subtitle">子工作流节点</h5>
      <label v-if="workflowCandidateOptions.length" class="field">
        <span>选择子工作流</span>
        <select
          data-testid="workflow-node-editor-subgraph-candidate"
          :value="node.subgraph.workflowId"
          @change="handleWorkflowCandidateChange"
        >
          <option value="">(从当前工作区选择)</option>
          <option v-for="option in workflowCandidateOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>工作流 ID</span>
        <input
          data-testid="workflow-node-editor-subgraph-workflow-id"
          type="text"
          :list="workflowOptionListId"
          :value="node.subgraph.workflowId"
          @input="handleSubgraphWorkflowIdInput"
        />
      </label>
      <p class="meta">{{ selectedWorkflowHint }}</p>
      <label class="field">
        <span>输出键</span>
        <input
          data-testid="workflow-node-editor-subgraph-output-key"
          type="text"
          :list="stateFieldKeyListId"
          :value="node.subgraph.outputKey ?? ''"
          @input="handleSubgraphOutputKeyInput"
        />
      </label>
    </section>

    <section v-if="node.kind === 'condition'" class="subsection">
      <h5 class="subtitle">条件分支</h5>
      <p class="meta">条件命中后走 True Route，否则走 False Route。</p>

      <label class="field">
        <span>运算符</span>
        <select
          data-testid="workflow-node-editor-condition-operator"
          :value="conditionConfig.operator"
          @change="handleConditionOperatorChange"
        >
          <option v-for="operator in conditionOperatorOptions" :key="operator" :value="operator">
            {{ operator }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>左值路径</span>
        <input
          data-testid="workflow-node-editor-condition-left-path"
          type="text"
          :list="stateFieldPathListId"
          :value="conditionConfig.leftPath"
          @input="handleConditionLeftPathInput"
        />
      </label>

      <label class="field">
        <span>右值</span>
        <input
          data-testid="workflow-node-editor-condition-right-value"
          type="text"
          :value="conditionRightValueText"
          :disabled="isRightValueDisabled"
          @input="handleConditionRightValueInput"
        />
      </label>

      <label class="field">
        <span>True Route</span>
        <select
          data-testid="workflow-node-editor-condition-true-node-id"
          :value="conditionConfig.trueNodeId"
          @change="handleConditionTrueNodeIdChange"
        >
          <option value="">(未配置)</option>
          <option v-for="candidateId in routeCandidateNodeIds" :key="`true-${candidateId}`" :value="candidateId">
            {{ candidateId }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>False Route</span>
        <select
          data-testid="workflow-node-editor-condition-false-node-id"
          :value="conditionConfig.falseNodeId"
          @change="handleConditionFalseNodeIdChange"
        >
          <option value="">(未配置)</option>
          <option v-for="candidateId in routeCandidateNodeIds" :key="`false-${candidateId}`" :value="candidateId">
            {{ candidateId }}
          </option>
        </select>
      </label>
    </section>

    <section v-if="node.kind === 'human-input'" class="subsection">
      <h5 class="subtitle">人工输入节点</h5>
      <label v-if="stateFieldKeyOptions.length" class="field">
        <span>选择结果字段</span>
        <select
          data-testid="workflow-node-editor-human-field-candidate"
          :value="node.humanInput.formKey"
          @change="handleHumanFieldCandidateChange"
        >
          <option value="">(从 state schema 选择)</option>
          <option v-for="fieldKey in stateFieldKeyOptions" :key="fieldKey" :value="fieldKey">
            {{ fieldKey }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>结果字段</span>
        <input
          data-testid="workflow-node-editor-human-form-key"
          type="text"
          :list="stateFieldKeyListId"
          :value="node.humanInput.formKey"
          @input="handleHumanFormKeyInput"
        />
      </label>
      <p class="meta">runtime 会把人工输入结果写回这个字段，优先复用 state schema 里的正式字段键。</p>
    </section>

    <section v-if="node.kind === 'join'" class="subsection">
      <h5 class="subtitle">汇聚节点</h5>
      <p class="meta">为当前汇聚节点配置触发模式、等待超时和有效上游。</p>
      <label class="field">
        <span>汇聚模式</span>
        <select
          data-testid="workflow-node-editor-join-mode"
          :value="joinConfig.mode"
          @change="handleJoinModeChange"
        >
          <option value="all">等待全部上游</option>
          <option value="any">任一上游即可</option>
        </select>
      </label>
      <label class="field">
        <span>超时（毫秒）</span>
        <input
          data-testid="workflow-node-editor-join-timeout-ms"
          type="number"
          min="0"
          step="100"
          :value="joinTimeoutInputValue"
          placeholder="留空表示不限制"
          @input="handleJoinTimeoutMsInput"
        />
      </label>
      <p class="meta">选择允许汇入当前 Join 的上游节点。</p>
      <p v-if="joinError" data-testid="workflow-node-editor-join-error" class="error">{{ joinError }}</p>
      <ul class="candidate-list">
        <li v-for="candidateId in upstreamCandidateNodeIds" :key="candidateId" class="candidate-row">
          <label class="candidate-toggle">
            <input
              :data-testid="`workflow-node-editor-join-upstream-toggle-${candidateId}`"
              type="checkbox"
              :checked="isJoinUpstreamSelected(candidateId)"
              @change="(event) => handleJoinUpstreamToggle(candidateId, event)"
            />
            <span :data-testid="`workflow-node-editor-join-upstream-candidate-${candidateId}`">
              {{ candidateId }}
            </span>
          </label>
        </li>
      </ul>
      <div v-if="stateFieldKeyOptions.length" class="subsection subsection--nested">
        <h6 class="subtitle">字段合并策略</h6>
        <p class="meta">仅为需要在汇聚节点覆盖默认合并方式的字段单独配置。</p>
        <label
          v-for="fieldKey in stateFieldKeyOptions"
          :key="fieldKey"
          class="field"
        >
          <span>{{ fieldKey }}</span>
          <select
            :data-testid="`workflow-node-editor-join-merge-${fieldKey}`"
            :value="readJoinMergeStrategy(fieldKey)"
            @change="(event) => handleJoinMergeStrategyChange(fieldKey, event)"
          >
            <option value="">继承默认策略</option>
            <option value="replace">replace</option>
            <option value="append">append</option>
            <option value="union">union</option>
            <option value="object-merge">object-merge</option>
          </select>
        </label>
      </div>
    </section>

    <datalist v-if="toolCandidateOptions.length" :id="toolOptionListId">
      <option v-for="option in toolCandidateOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </datalist>
    <datalist v-if="workflowCandidateOptions.length" :id="workflowOptionListId">
      <option v-for="option in workflowCandidateOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </datalist>
    <datalist v-if="stateFieldKeyOptions.length" :id="stateFieldKeyListId">
      <option v-for="fieldKey in stateFieldKeyOptions" :key="fieldKey" :value="fieldKey" />
    </datalist>
    <datalist v-if="stateFieldPathOptions.length" :id="stateFieldPathListId">
      <option v-for="fieldPath in stateFieldPathOptions" :key="fieldPath" :value="fieldPath" />
    </datalist>
  </section>
</template>

<script setup lang="ts">
import type {
  WorkflowConditionNode,
  WorkflowJoinNode,
  WorkflowMergeStrategy,
  WorkflowNode,
  WorkflowNodePolicy,
} from "@myclaw-desktop/shared";
import { computed, ref, watch } from "vue";

import WorkflowExecutionPolicyEditor from "@/components/workflow/WorkflowExecutionPolicyEditor.vue";

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
type WorkflowEditorOption = {
  value: string;
  label: string;
  hint?: string;
};

const props = defineProps<{
  node: WorkflowNode;
  upstreamCandidateNodeIds?: string[];
  routeCandidateNodeIds?: string[];
  toolCandidateOptions?: WorkflowEditorOption[];
  workflowCandidateOptions?: WorkflowEditorOption[];
  stateFieldKeyOptions?: string[];
}>();

const emit = defineEmits<{
  (event: "update:node", value: WorkflowNode): void;
}>();

const joinError = ref("");
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

const upstreamCandidateNodeIds = computed(() => props.upstreamCandidateNodeIds ?? []);
const routeCandidateNodeIds = computed(() => props.routeCandidateNodeIds ?? []);
const toolCandidateOptions = computed(() => props.toolCandidateOptions ?? []);
const workflowCandidateOptions = computed(() => props.workflowCandidateOptions ?? []);
const stateFieldKeyOptions = computed(() => props.stateFieldKeyOptions ?? []);
const joinConfig = ref<WorkflowJoinConfig>({
  mode: "all",
  upstreamNodeIds: [],
});
const toolOptionListId = computed(() => `workflow-node-editor-tool-options-${props.node.id}`);
const workflowOptionListId = computed(() => `workflow-node-editor-workflow-options-${props.node.id}`);
const stateFieldKeyListId = computed(() => `workflow-node-editor-state-field-options-${props.node.id}`);
const stateFieldPathListId = computed(() => `workflow-node-editor-state-path-options-${props.node.id}`);

const conditionConfig = computed<WorkflowConditionNodeConfig>(() => {
  if (props.node.kind !== "condition") {
    return {
      operator: "exists",
      leftPath: "$.state.result",
      rightValue: "",
      trueNodeId: "",
      falseNodeId: "",
    };
  }

  return {
    operator: normalizeConditionOperator(props.node.condition?.operator),
    leftPath: typeof props.node.condition?.leftPath === "string" && props.node.condition.leftPath.trim()
      ? props.node.condition.leftPath
      : "$.state.result",
    rightValue: props.node.condition?.rightValue,
    trueNodeId: props.node.route?.trueNodeId ?? "",
    falseNodeId: props.node.route?.falseNodeId ?? "",
  };
});

const conditionRightValueText = computed(() => formatConditionValue(conditionConfig.value.rightValue));
const isRightValueDisabled = computed(() => (
  conditionConfig.value.operator === "exists" || conditionConfig.value.operator === "not-exists"
));
const joinTimeoutInputValue = computed(() => (
  typeof joinConfig.value.timeoutMs === "number" ? String(joinConfig.value.timeoutMs) : ""
));
const stateFieldPathOptions = computed(() => {
  const optionSet = new Set<string>();
  for (const fieldKey of stateFieldKeyOptions.value) {
    const normalizedKey = fieldKey.trim();
    if (!normalizedKey) {
      continue;
    }
    optionSet.add(normalizedKey);
    optionSet.add(`$.${normalizedKey}`);
  }
  return [...optionSet];
});
const selectedToolHint = computed(() => {
  if (props.node.kind !== "tool") {
    return "";
  }
  const matched = toolCandidateOptions.value.find((option) => option.value === props.node.tool.toolId);
  if (!matched) {
    return "未匹配到已注册工具，可直接输入自定义 Tool ID。";
  }
  return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
});
const selectedWorkflowHint = computed(() => {
  if (props.node.kind !== "subgraph") {
    return "";
  }
  const matched = workflowCandidateOptions.value.find((option) => option.value === props.node.subgraph.workflowId);
  if (!matched) {
    return "未匹配到本地工作流，可直接输入已存在的 workflowId。";
  }
  return matched.hint ? `${matched.label} / ${matched.hint}` : matched.label;
});

watch(
  () => props.node,
  (node) => {
    joinError.value = "";
    if (node.kind !== "join") {
      joinConfig.value = { mode: "all", upstreamNodeIds: [] };
      return;
    }
    joinConfig.value = {
      mode: node.join.mode,
      upstreamNodeIds: [...node.join.upstreamNodeIds],
      ...(typeof node.join.timeoutMs === "number" ? { timeoutMs: node.join.timeoutMs } : {}),
      ...(node.join.mergeStrategyOverrides ? { mergeStrategyOverrides: { ...node.join.mergeStrategyOverrides } } : {}),
    };
  },
  { immediate: true, deep: true },
);

/** 生成开始/结束节点的阶段提示，避免出现空白节点面板。 */
function stageHint(kind: "start" | "end") {
  return kind === "start"
    ? "入口阶段：负责定义工作流启动点。"
    : "终止阶段：负责收敛结果并结束本次执行。";
}

/** 将条件运算符归一化到受支持的结构化列表。 */
function normalizeConditionOperator(value: unknown): WorkflowConditionOperator {
  return conditionOperatorOptions.includes(value as WorkflowConditionOperator)
    ? (value as WorkflowConditionOperator)
    : "exists";
}

/** 将运行时值格式化成输入框可编辑文本。 */
function formatConditionValue(value: WorkflowConditionNodeConfig["rightValue"]): string {
  if (value === undefined) {
    return "";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

/** 将输入框文本尽量解析成更贴近 runtime 契约的值类型。 */
function parseConditionValue(text: string, operator: WorkflowConditionOperator) {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (operator === "in" || operator === "not-in") {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  const parsedNumber = Number(trimmed);
  if (!Number.isNaN(parsedNumber) && trimmed === String(parsedNumber)) {
    return parsedNumber;
  }
  return trimmed;
}

/** 读取当前节点匹配到的 Join 字段合并策略。 */
function readJoinMergeStrategy(fieldKey: string): WorkflowMergeStrategy | "" {
  if (props.node.kind !== "join") {
    return "";
  }
  return joinConfig.value.mergeStrategyOverrides?.[fieldKey] ?? "";
}

/** 统一更新节点 label。 */
function handleLabelInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const label = target?.value ?? "";
  console.info("[workflow] 更新节点 label", { nodeId: props.node.id, label });
  emit("update:node", { ...props.node, label } as WorkflowNode);
}

/** 统一更新节点执行策略。 */
function handlePolicyUpdate(policy: WorkflowNodePolicy | undefined) {
  console.info("[workflow] 更新节点 policy", { nodeId: props.node.id, policy: policy ?? null });
  emit("update:node", { ...props.node, policy } as WorkflowNode);
}

/** 更新 llm.prompt，保证对话节点具备专属配置。 */
function handleLlmPromptInput(event: Event) {
  if (props.node.kind !== "llm") {
    return;
  }
  const target = event.target as HTMLTextAreaElement | null;
  const prompt = target?.value ?? "";
  console.info("[workflow] 更新 llm 节点 prompt", { nodeId: props.node.id, promptLength: prompt.length });
  emit("update:node", { ...props.node, llm: { ...props.node.llm, prompt } });
}

/** 更新 llm.outputKey，让结果写回状态树时更可控。 */
function handleLlmOutputKeyInput(event: Event) {
  if (props.node.kind !== "llm") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const outputKey = target?.value.trim() || undefined;
  console.info("[workflow] 更新 llm 节点 outputKey", { nodeId: props.node.id, outputKey: outputKey ?? null });
  emit("update:node", { ...props.node, llm: { ...props.node.llm, outputKey } });
}

/** 更新 tool.toolId。 */
function handleToolIdInput(event: Event) {
  if (props.node.kind !== "tool") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const toolId = target?.value ?? "";
  console.info("[workflow] 更新 tool 节点 toolId", { nodeId: props.node.id, toolId });
  emit("update:node", { ...props.node, tool: { ...props.node.tool, toolId } });
}

/** 从候选列表直接选择 toolId，减少手填和误填。 */
function handleToolCandidateChange(event: Event) {
  if (props.node.kind !== "tool") {
    return;
  }
  const target = event.target as HTMLSelectElement | null;
  const toolId = target?.value ?? "";
  if (!toolId) {
    return;
  }
  console.info("[workflow] 从候选列表选择 tool 节点 toolId", { nodeId: props.node.id, toolId });
  emit("update:node", { ...props.node, tool: { ...props.node.tool, toolId } });
}

/** 更新 tool.outputKey。 */
function handleToolOutputKeyInput(event: Event) {
  if (props.node.kind !== "tool") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const outputKey = target?.value.trim() || undefined;
  console.info("[workflow] 更新 tool 节点 outputKey", { nodeId: props.node.id, outputKey: outputKey ?? null });
  emit("update:node", { ...props.node, tool: { ...props.node.tool, outputKey } });
}

/** 更新 subgraph.workflowId。 */
function handleSubgraphWorkflowIdInput(event: Event) {
  if (props.node.kind !== "subgraph") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const workflowId = target?.value ?? "";
  console.info("[workflow] 更新 subgraph 节点 workflowId", { nodeId: props.node.id, workflowId });
  emit("update:node", { ...props.node, subgraph: { ...props.node.subgraph, workflowId } });
}

/** 从候选列表直接选择子工作流，避免输入不存在的 workflowId。 */
function handleWorkflowCandidateChange(event: Event) {
  if (props.node.kind !== "subgraph") {
    return;
  }
  const target = event.target as HTMLSelectElement | null;
  const workflowId = target?.value ?? "";
  if (!workflowId) {
    return;
  }
  console.info("[workflow] 从候选列表选择 subgraph 节点 workflowId", { nodeId: props.node.id, workflowId });
  emit("update:node", { ...props.node, subgraph: { ...props.node.subgraph, workflowId } });
}

/** 更新 subgraph.outputKey。 */
function handleSubgraphOutputKeyInput(event: Event) {
  if (props.node.kind !== "subgraph") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const outputKey = target?.value.trim() || undefined;
  console.info("[workflow] 更新 subgraph 节点 outputKey", { nodeId: props.node.id, outputKey: outputKey ?? null });
  emit("update:node", { ...props.node, subgraph: { ...props.node.subgraph, outputKey } });
}

/** 合并并写回 condition 规则配置。 */
function updateConditionConfig(patch: Partial<WorkflowConditionNode["condition"]>) {
  if (props.node.kind !== "condition") {
    return;
  }

  const nextCondition = {
    operator: conditionConfig.value.operator,
    leftPath: conditionConfig.value.leftPath,
    ...(conditionConfig.value.rightValue !== undefined ? { rightValue: conditionConfig.value.rightValue } : {}),
    ...patch,
  };

  console.info("[workflow] 更新 condition 节点规则", {
    nodeId: props.node.id,
    operator: nextCondition.operator,
    leftPath: nextCondition.leftPath,
    rightValue: nextCondition.rightValue ?? null,
  });
  emit("update:node", {
    ...props.node,
    condition: nextCondition,
  });
}

/** 合并并写回 condition.route。 */
function updateConditionRoute(patch: Partial<NonNullable<WorkflowConditionNode["route"]>>) {
  if (props.node.kind !== "condition") {
    return;
  }

  const nextRoute = {
    ...(props.node.route ?? {}),
    ...patch,
  };

  console.info("[workflow] 更新 condition 节点路由", {
    nodeId: props.node.id,
    trueNodeId: nextRoute.trueNodeId ?? null,
    falseNodeId: nextRoute.falseNodeId ?? null,
  });
  emit("update:node", {
    ...props.node,
    route: nextRoute,
  });
}

/** 更新 condition.operator。 */
function handleConditionOperatorChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const operator = normalizeConditionOperator(target?.value);
  const patch: Partial<WorkflowConditionNode["condition"]> = { operator };
  if (operator === "exists" || operator === "not-exists") {
    patch.rightValue = undefined;
  }
  updateConditionConfig(patch);
}

/** 更新 condition.leftPath。 */
function handleConditionLeftPathInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  updateConditionConfig({ leftPath: target?.value ?? "" });
}

/** 更新 condition.rightValue。 */
function handleConditionRightValueInput(event: Event) {
  if (isRightValueDisabled.value) {
    updateConditionConfig({ rightValue: undefined });
    return;
  }
  const target = event.target as HTMLInputElement | null;
  updateConditionConfig({
    rightValue: parseConditionValue(target?.value ?? "", conditionConfig.value.operator),
  });
}

/** 更新 condition.route.trueNodeId。 */
function handleConditionTrueNodeIdChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const trueNodeId = target?.value || undefined;
  updateConditionRoute({ trueNodeId });
}

/** 更新 condition.route.falseNodeId。 */
function handleConditionFalseNodeIdChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const falseNodeId = target?.value || undefined;
  updateConditionRoute({ falseNodeId });
}

/** 更新 human-input.formKey。 */
function handleHumanFormKeyInput(event: Event) {
  if (props.node.kind !== "human-input") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const formKey = target?.value ?? "";
  console.info("[workflow] 更新 human-input formKey", { nodeId: props.node.id, formKey });
  emit("update:node", { ...props.node, humanInput: { ...props.node.humanInput, formKey } });
}

/** 从 state schema 候选中选择人工输入写回字段。 */
function handleHumanFieldCandidateChange(event: Event) {
  if (props.node.kind !== "human-input") {
    return;
  }
  const target = event.target as HTMLSelectElement | null;
  const formKey = target?.value ?? "";
  if (!formKey) {
    return;
  }
  console.info("[workflow] 从候选列表选择 human-input 结果字段", { nodeId: props.node.id, formKey });
  emit("update:node", { ...props.node, humanInput: { ...props.node.humanInput, formKey } });
}

/** 合并并写回 join 配置，保证连续编辑时不会覆盖前一次修改。 */
function updateJoinConfig(
  patch: Partial<WorkflowJoinConfig>,
  logMessage: string,
  logPayload: Record<string, unknown>,
) {
  if (props.node.kind !== "join") {
    return;
  }

  const nextJoin: WorkflowJoinConfig = {
    ...joinConfig.value,
    ...patch,
    upstreamNodeIds: patch.upstreamNodeIds ? [...patch.upstreamNodeIds] : [...joinConfig.value.upstreamNodeIds],
    ...(patch.mergeStrategyOverrides
      ? { mergeStrategyOverrides: { ...patch.mergeStrategyOverrides } }
      : {}),
  };
  if ("mergeStrategyOverrides" in patch && !patch.mergeStrategyOverrides) {
    delete nextJoin.mergeStrategyOverrides;
  }

  joinConfig.value = nextJoin;
  console.info(logMessage, {
    nodeId: props.node.id,
    ...logPayload,
    mode: nextJoin.mode,
    timeoutMs: nextJoin.timeoutMs ?? null,
    upstreamNodeIds: nextJoin.upstreamNodeIds,
    mergeStrategyOverrides: nextJoin.mergeStrategyOverrides ?? null,
  });
  emit("update:node", { ...props.node, join: nextJoin });
}

/** 判断 join.upstreamNodeIds 是否包含目标节点。 */
function isJoinUpstreamSelected(candidateId: string): boolean {
  if (props.node.kind !== "join") {
    return false;
  }
  return joinConfig.value.upstreamNodeIds.includes(candidateId);
}

/** 更新 join.mode，让汇聚节点按“全部完成”或“任一完成”触发。 */
function handleJoinModeChange(event: Event) {
  if (props.node.kind !== "join") {
    return;
  }
  const target = event.target as HTMLSelectElement | null;
  const mode = target?.value === "any" ? "any" : "all";
  updateJoinConfig({ mode }, "[workflow] 更新 join 汇聚模式", { triggerMode: mode });
}

/** 更新 join.timeoutMs，支持留空表示不限制等待时间。 */
function handleJoinTimeoutMsInput(event: Event) {
  if (props.node.kind !== "join") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const rawValue = target?.value.trim() ?? "";
  const parsedTimeout = rawValue === "" ? undefined : Number(rawValue);
  const timeoutMs = parsedTimeout !== undefined && Number.isFinite(parsedTimeout) && parsedTimeout >= 0
    ? Math.trunc(parsedTimeout)
    : undefined;

  updateJoinConfig({ timeoutMs }, "[workflow] 更新 join 超时配置", {
    rawTimeoutMs: rawValue || null,
  });
}

/** 切换 join.upstreamNodeIds，并阻止清空最后一个上游依赖。 */
function handleJoinUpstreamToggle(candidateId: string, event: Event) {
  if (props.node.kind !== "join") {
    return;
  }
  const target = event.target as HTMLInputElement | null;
  const checked = Boolean(target?.checked);
  const current = joinConfig.value.upstreamNodeIds;

  if (!checked && current.length <= 1 && current.includes(candidateId)) {
    if (target) {
      target.checked = true;
    }
    joinError.value = "汇聚节点至少要保留一个上游节点。";
    console.info("[workflow] 阻止清空最后一个 join 上游依赖", {
      nodeId: props.node.id,
      candidateId,
      upstreamNodeIds: current,
    });
    return;
  }

  const next = checked
    ? Array.from(new Set([...current, candidateId]))
    : current.filter((id) => id !== candidateId);

  joinError.value = "";
  updateJoinConfig({ upstreamNodeIds: next }, "[workflow] 更新 join 上游依赖配置", {
    candidateId,
    checked,
  });
}

/** 更新 join.mergeStrategyOverrides，确保只写入显式覆盖字段。 */
function handleJoinMergeStrategyChange(fieldKey: string, event: Event) {
  if (props.node.kind !== "join") {
    return;
  }
  const target = event.target as HTMLSelectElement | null;
  const nextStrategy = target?.value as WorkflowMergeStrategy | "";
  const nextOverrides = {
    ...(joinConfig.value.mergeStrategyOverrides ?? {}),
  };
  if (!nextStrategy) {
    delete nextOverrides[fieldKey];
  } else {
    nextOverrides[fieldKey] = nextStrategy;
  }

  updateJoinConfig(
    {
      mergeStrategyOverrides: Object.keys(nextOverrides).length ? nextOverrides : undefined,
    },
    "[workflow] 更新 join 字段合并策略",
    {
      fieldKey,
      strategy: nextStrategy || null,
    },
  );
}
</script>

<style scoped>
.node-editor {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.meta {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.field input,
.field textarea,
.field select {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--bg-base);
  color: var(--text-primary);
  font: inherit;
}

.subsection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--glass-border);
  padding-top: 10px;
}

.subsection--nested {
  border-top: 1px dashed var(--glass-border);
}

.subtitle {
  margin: 0;
  color: var(--text-primary);
  font-size: 13px;
}

.candidate-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.candidate-row {
  margin: 0;
}

.candidate-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.error {
  color: #b83333;
  font-size: 12px;
}
</style>
