import type { ExperienceProfileId, ProtocolTarget, ProviderFamily } from "./model";

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
  HttpRequest: "http-request",
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

/** 与 WorkflowSummary 同形，向 renderer workspace store 暴露的列表项类型别名。 */
export type WorkflowDefinitionSummary = WorkflowSummary;

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

export type WorkflowVariableScope =
  | "input"
  | "system"
  | "node"
  | "run"
  | "output"
  | "secret";

export type WorkflowVariableRef = {
  scope: WorkflowVariableScope;
  nodeId?: string;
  path: string;
  valueType: WorkflowStateValueType | "file";
};

export type WorkflowNodeInputSource =
  | { mode: "static"; value: unknown }
  | { mode: "variable"; ref: WorkflowVariableRef }
  | { mode: "expression"; expression: string };

export type WorkflowVariableDefinition = {
  id: string;
  key: string;
  label: string;
  description?: string;
  scope: WorkflowVariableScope;
  valueType: WorkflowStateValueType | "file";
  required?: boolean;
  defaultValue?: unknown;
  sensitive?: boolean;
  nodeId?: string;
  path?: string;
};

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
  /** Declare which channels this node reads from */
  inputBindings?: Record<string, string>;
  /** Declare which channels this node writes to */
  outputBindings?: Record<string, string>;
  /** Declare typed input sources, compatible with mature workflow variable pickers. */
  inputSources?: Record<string, WorkflowNodeInputSource>;
};

export type WorkflowStartNode = WorkflowNodeBase & {
  kind: "start";
};

export type WorkflowLlmNode = WorkflowNodeBase & {
  kind: "llm";
  llm: WorkflowNodeOutputBinding & {
    systemPrompt?: string;
    prompt: string;
    model?: string;
    experienceProfileId?: ExperienceProfileId;
    providerFamily?: ProviderFamily;
    protocolTarget?: ProtocolTarget;
  };
};

export type WorkflowToolNode = WorkflowNodeBase & {
  kind: "tool";
  tool: WorkflowNodeOutputBinding & {
    toolId: string;
  };
};

export type WorkflowHttpRequestNode = WorkflowNodeBase & {
  kind: "http-request";
  httpRequest: WorkflowNodeOutputBinding & {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers?: Record<string, string>;
    body?: string;
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
  outputSources?: Record<string, WorkflowNodeInputSource>;
};

export type WorkflowNode =
  | WorkflowStartNode
  | WorkflowLlmNode
  | WorkflowToolNode
  | WorkflowHttpRequestNode
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
  variables?: WorkflowVariableDefinition[];
  outputs?: WorkflowVariableDefinition[];
  editor?: WorkflowEditorMetadata;
  defaults?: {
    run?: {
      maxParallelNodes?: number;
      checkpointPolicy?: "node-complete" | "always";
    };
    nodePolicy?: WorkflowNodePolicy;
    /** Allow cycles (back-edges) in the graph */
    allowCycles?: boolean;
  };
};

// ── Engine Extensions (backward-compatible, all optional) ──

export type WorkflowRunConfig = {
  /** Max supersteps before forced stop (default 50) */
  recursionLimit: number;
  /** Working directory for tool execution */
  workingDirectory: string;
  /** Model profile ID for LLM nodes */
  modelProfileId: string;
  /** Checkpoint strategy */
  checkpointPolicy: "every-step" | "on-interrupt" | "none";
  /** Max nodes executing in parallel per superstep */
  maxParallelNodes?: number;
  /** Custom variables passed to node executors */
  variables?: Record<string, unknown>;
};
