export const WorkflowPackageSource = {
  Personal: "personal",
  Enterprise: "enterprise",
  Hub: "hub",
} as const;

export type WorkflowPackageSource =
  (typeof WorkflowPackageSource)[keyof typeof WorkflowPackageSource];

export const WorkflowStatus = {
  Draft: "draft",
  Active: "active",
  Archived: "archived",
} as const;

export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const WorkflowNodeKind = {
  Start: "start",
  Llm: "llm",
  Tool: "tool",
  HumanInput: "human-input",
  Condition: "condition",
  Subgraph: "subgraph",
  Join: "join",
  End: "end",
} as const;

export type WorkflowNodeKind = (typeof WorkflowNodeKind)[keyof typeof WorkflowNodeKind];

export const WorkflowEdgeKind = {
  Normal: "normal",
  Conditional: "conditional",
  Parallel: "parallel",
} as const;

export type WorkflowEdgeKind = (typeof WorkflowEdgeKind)[keyof typeof WorkflowEdgeKind];

export const WorkflowMergeStrategy = {
  Replace: "replace",
  Append: "append",
  Union: "union",
  ObjectMerge: "object-merge",
  Custom: "custom",
} as const;

export type WorkflowMergeStrategy = (typeof WorkflowMergeStrategy)[keyof typeof WorkflowMergeStrategy];

export const WorkflowTransitionConditionOperator = {
  Equals: "equals",
  NotEquals: "not-equals",
  GreaterThan: "greater-than",
  GreaterOrEqual: "greater-or-equal",
  LessThan: "less-than",
  LessOrEqual: "less-or-equal",
  Exists: "exists",
  NotExists: "not-exists",
  In: "in",
  NotIn: "not-in",
} as const;

export type WorkflowTransitionConditionOperator =
  (typeof WorkflowTransitionConditionOperator)[keyof typeof WorkflowTransitionConditionOperator];

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  source: WorkflowPackageSource;
  updatedAt: string;
  version: number;
  nodeCount: number;
  edgeCount: number;
  libraryRootId: string;
};

export type WorkflowDefinitionSummaryCompat = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  source: WorkflowPackageSource;
  updatedAt: string;
  version?: number;
  nodeCount?: number;
  edgeCount?: number;
  libraryRootId?: string;
};

export type WorkflowDefinitionSummary = WorkflowSummary | WorkflowDefinitionSummaryCompat;

export type WorkflowCanvasPoint = {
  x: number;
  y: number;
};

export type WorkflowCanvasNodeLayout = {
  nodeId: string;
  position: WorkflowCanvasPoint;
};

export type WorkflowCanvasViewport = {
  offsetX: number;
  offsetY: number;
};

export type WorkflowEditorCanvas = {
  viewport: WorkflowCanvasViewport;
  nodes: WorkflowCanvasNodeLayout[];
};

export type WorkflowEditorMetadata = {
  canvas: WorkflowEditorCanvas;
};

export type WorkflowStateValueType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "unknown";

export type WorkflowStateSchemaField = {
  key: string;
  label: string;
  description: string;
  valueType: WorkflowStateValueType;
  mergeStrategy: WorkflowMergeStrategy;
  required: boolean;
  producerNodeIds: string[];
  consumerNodeIds: string[];
};

export type WorkflowNodePolicy = {
  timeoutMs?: number;
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  idempotencyKeyTemplate?: string;
  onFailure?: {
    mode: "stop" | "route";
    routeNodeId?: string;
  };
};

export type WorkflowTransitionCondition = {
  operator: WorkflowTransitionConditionOperator;
  leftPath: string;
  rightValue?: string | number | boolean | null | string[] | number[] | boolean[];
};

export type WorkflowNodeOutputBinding = {
  outputKey?: string;
};

export type WorkflowConditionRoute = {
  trueNodeId?: string;
  falseNodeId?: string;
};

type WorkflowEdgeBase = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type WorkflowNormalEdge = WorkflowEdgeBase & {
  kind: "normal";
  condition?: never;
};

export type WorkflowParallelEdge = WorkflowEdgeBase & {
  kind: "parallel";
  condition?: never;
};

export type WorkflowConditionalEdge = WorkflowEdgeBase & {
  kind: "conditional";
  condition: WorkflowTransitionCondition;
};

export type WorkflowEdge = WorkflowNormalEdge | WorkflowParallelEdge | WorkflowConditionalEdge;

type WorkflowNodeBase = {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  policy?: WorkflowNodePolicy;
};

export type WorkflowStartNode = WorkflowNodeBase & {
  kind: "start";
};

export type WorkflowLlmNode = WorkflowNodeBase & {
  kind: "llm";
  llm: WorkflowNodeOutputBinding & {
    prompt: string;
  };
};

export type WorkflowToolNode = WorkflowNodeBase & {
  kind: "tool";
  tool: WorkflowNodeOutputBinding & {
    toolId: string;
  };
};

export type WorkflowHumanInputNode = WorkflowNodeBase & {
  kind: "human-input";
  humanInput: {
    formKey: string;
  };
};

export type WorkflowConditionNode = WorkflowNodeBase & {
  kind: "condition";
  condition?: WorkflowTransitionCondition;
  route?: WorkflowConditionRoute;
};

export type WorkflowSubgraphNode = WorkflowNodeBase & {
  kind: "subgraph";
  subgraph: WorkflowNodeOutputBinding & {
    workflowId: string;
  };
};

export type WorkflowJoinNode = WorkflowNodeBase & {
  kind: "join";
  join: {
    mode: "all" | "any";
    upstreamNodeIds: string[];
    timeoutMs?: number;
    mergeStrategyOverrides?: Record<string, WorkflowMergeStrategy>;
  };
};

export type WorkflowEndNode = WorkflowNodeBase & {
  kind: "end";
};

export type WorkflowNode =
  | WorkflowStartNode
  | WorkflowLlmNode
  | WorkflowToolNode
  | WorkflowHumanInputNode
  | WorkflowConditionNode
  | WorkflowSubgraphNode
  | WorkflowJoinNode
  | WorkflowEndNode;

export type WorkflowDefinition = WorkflowSummary & {
  entryNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stateSchema: WorkflowStateSchemaField[];
  editor?: WorkflowEditorMetadata;
  defaults?: {
    run?: {
      maxParallelNodes?: number;
      checkpointPolicy?: "node-complete" | "always";
    };
    nodePolicy?: WorkflowNodePolicy;
  };
};
