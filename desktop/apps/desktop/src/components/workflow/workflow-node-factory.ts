import type { WorkflowNode, WorkflowNodeKind } from "@myclaw-desktop/shared";
import type { WorkflowCanvasNodeLayout, WorkflowCanvasPoint } from "@/components/workflow/workflow-canvas-geometry";

type CreateWorkflowNodeOptions = {
  kind: WorkflowNodeKind;
  nodeId: string;
  upstreamNodeId?: string;
};

type CreateWorkflowNodeDraftOptions = CreateWorkflowNodeOptions & {
  position: WorkflowCanvasPoint;
};

type WorkflowNodeDraft = {
  node: WorkflowNode;
  layout: WorkflowCanvasNodeLayout;
};

type WorkflowConditionNodeConfig = {
  operator: "equals" | "not-equals" | "exists";
  leftPath: string;
  rightValue?: string;
};

export const WORKFLOW_NODE_KIND_LABELS: Record<WorkflowNodeKind, string> = {
  start: "开始",
  llm: "对话",
  tool: "工具",
  "human-input": "人工输入",
  condition: "条件分支",
  subgraph: "子工作流",
  join: "汇聚",
  end: "结束",
};

export const WORKFLOW_HUMAN_FORM_TEMPLATES = [
  {
    key: "human.approval",
    label: "审批确认",
    description: "用于人工确认、放行或驳回当前流程节点。",
  },
  {
    key: "human.review-note",
    label: "审核意见",
    description: "用于收集审核备注、风险说明和补充意见。",
  },
  {
    key: "human.collect-input",
    label: "补充信息",
    description: "用于收集手机号、工单号、附件说明等额外字段。",
  },
] as const;

/** 为不同节点类型生成带上下文的默认引用键，避免出现无意义占位值。 */
export function buildScopedReference(prefix: string, nodeId: string) {
  return `${prefix}.${nodeId}`;
}

/** 判断当前值是否仍是工厂生成的占位引用。 */
export function isGeneratedScopedReference(prefix: string, nodeId: string, value: string | undefined) {
  return Boolean(value) && value === buildScopedReference(prefix, nodeId);
}

/** 返回节点类型中文名，供画布和表单共用。 */
export function getWorkflowNodeKindLabel(kind: WorkflowNodeKind) {
  return WORKFLOW_NODE_KIND_LABELS[kind];
}

/** 根据节点类型创建满足 runtime 校验的最小默认节点定义。 */
export function createWorkflowNode(options: CreateWorkflowNodeOptions): WorkflowNode {
  const labelMap: Record<WorkflowNodeKind, string> = {
    start: "Start",
    llm: "LLM",
    tool: "Tool",
    "human-input": "Human Input",
    condition: "Condition",
    subgraph: "Subgraph",
    join: "Join",
    end: "End",
  };

  console.info("[workflow-node-factory] 创建默认节点定义", {
    kind: options.kind,
    nodeId: options.nodeId,
    upstreamNodeId: options.upstreamNodeId ?? null,
  });

  switch (options.kind) {
    case "llm":
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
        llm: { prompt: "请补充“对话”节点要完成的具体任务。" },
      };
    case "tool":
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
        tool: { toolId: buildScopedReference("tool", options.nodeId) },
      };
    case "human-input":
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
        humanInput: { formKey: buildScopedReference("form", options.nodeId) },
      };
    case "subgraph":
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
        subgraph: { workflowId: buildScopedReference("workflow", options.nodeId) },
      };
    case "join":
      if (!options.upstreamNodeId) {
        throw new Error("join_upstream_required");
      }
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
        join: { mode: "all", upstreamNodeIds: [options.upstreamNodeId] },
      };
    case "condition": {
      const condition: WorkflowConditionNodeConfig = {
        operator: "exists",
        leftPath: "$.state.result",
      };
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
        // condition 节点默认带条件配置，便于在 Inspector 中进行结构化编辑。
        condition,
      } as WorkflowNode;
    }
    case "start":
    case "end":
    default:
      return {
        id: options.nodeId,
        kind: options.kind,
        label: labelMap[options.kind],
      } as WorkflowNode;
  }
}

/** 为节点新增流程返回 node + layout seed，供画布持久化统一使用。 */
export function createWorkflowNodeDraft(options: CreateWorkflowNodeDraftOptions): WorkflowNodeDraft {
  const node = createWorkflowNode(options);
  return {
    node,
    layout: {
      nodeId: options.nodeId,
      position: {
        x: options.position.x,
        y: options.position.y,
      },
    },
  };
}
