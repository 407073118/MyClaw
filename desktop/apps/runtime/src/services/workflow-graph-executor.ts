import type { WorkflowCheckpointStore, WorkflowRunRecord } from "./workflow-checkpoint-store";

export type WorkflowEdgeKind = "normal" | "conditional" | "parallel";

export type WorkflowConditionOperator =
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

export type WorkflowCondition = {
  operator: WorkflowConditionOperator;
  leftPath: string;
  rightValue?: string | number | boolean | null | string[] | number[] | boolean[];
};

export type WorkflowNodeBase = {
  id: string;
  label: string;
  policy?: {
    retry?: {
      maxAttempts: number;
      backoffMs?: number;
    };
  };
};

export type WorkflowNodeOutputBinding = {
  outputKey?: string;
};

export type WorkflowStartNode = WorkflowNodeBase & { kind: "start" };
export type WorkflowEndNode = WorkflowNodeBase & { kind: "end" };
export type WorkflowTaskNode = WorkflowNodeBase & { kind: "task" };
export type WorkflowLlmNode = WorkflowNodeBase & {
  kind: "llm";
  llm: WorkflowNodeOutputBinding & { prompt: string };
};
export type WorkflowToolNode = WorkflowNodeBase & {
  kind: "tool";
  tool: WorkflowNodeOutputBinding & { toolId: string };
};
export type WorkflowSubgraphNode = WorkflowNodeBase & {
  kind: "subgraph";
  subgraph: WorkflowNodeOutputBinding & { workflowId: string };
};
export type WorkflowConditionNode = WorkflowNodeBase & {
  kind: "condition";
  condition?: WorkflowCondition;
  route?: {
    trueNodeId?: string;
    falseNodeId?: string;
  };
};
export type WorkflowHumanInputNode = WorkflowNodeBase & { kind: "human-input"; humanInput: { field: string } };
export type WorkflowJoinNode = WorkflowNodeBase & {
  kind: "join";
  join: {
    upstreamNodeIds: string[];
    mergeStrategyOverrides?: Record<string, WorkflowMergeStrategy>;
  };
};

export type WorkflowMergeStrategy = "replace" | "append" | "union" | "object-merge";

export type WorkflowNode =
  | WorkflowStartNode
  | WorkflowEndNode
  | WorkflowTaskNode
  | WorkflowLlmNode
  | WorkflowToolNode
  | WorkflowSubgraphNode
  | WorkflowConditionNode
  | WorkflowHumanInputNode
  | WorkflowJoinNode;

export type WorkflowEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: WorkflowEdgeKind;
  condition?: WorkflowCondition;
};

export type WorkflowGraphDefinition = {
  id: string;
  entryNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowNodeHandlerInput = {
  runId: string;
  nodeId: string;
  state: Record<string, unknown>;
  attempt: number;
};

export type WorkflowNodeHandler = (input: WorkflowNodeHandlerInput) => Promise<Record<string, unknown>>;

export type WorkflowNodeHandlerMap = Record<string, WorkflowNodeHandler>;

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

type ExecutorOptions = {
  store: WorkflowCheckpointStore;
  handlers: WorkflowNodeHandlerMap;
  logger: Logger;
};

export type WorkflowRunResult =
  | {
      status: "succeeded";
      state: Record<string, unknown>;
      attempts: Record<string, number>;
    }
  | {
      status: "paused";
      state: Record<string, unknown>;
      attempts: Record<string, number>;
      pausedAtNodeId: string;
    }
  | {
      status: "failed";
      state: Record<string, unknown>;
      attempts: Record<string, number>;
      error: string;
    };

function readPath(obj: unknown, path: string): unknown {
  if (!path) {
    return undefined;
  }
  const parts = path.split(".").filter(Boolean);
  /** 兼容 desktop 侧常见的 `$.field` 与 `$.state.field` 写法，统一映射到运行时根 state。 */
  if (parts[0] === "$") {
    parts.shift();
  }
  if (parts[0] === "state") {
    parts.shift();
  }
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(state: Record<string, unknown>, condition?: WorkflowCondition): boolean {
  if (!condition) {
    return false;
  }
  const left = readPath(state, condition.leftPath);
  const right = condition.rightValue;

  switch (condition.operator) {
    case "equals":
      return Object.is(left, right);
    case "not-equals":
      return !Object.is(left, right);
    case "greater-than":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "greater-or-equal":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "less-than":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "less-or-equal":
      return typeof left === "number" && typeof right === "number" && left <= right;
    case "exists":
      return left !== undefined;
    case "not-exists":
      return left === undefined;
    case "in":
      return Array.isArray(right) && right.some((item) => Object.is(left, item));
    case "not-in":
      return Array.isArray(right) && !right.some((item) => Object.is(left, item));
    default:
      return false;
  }
}

function createTypedNodeOutput(
  node: WorkflowLlmNode | WorkflowToolNode | WorkflowSubgraphNode,
  state: Record<string, unknown>,
): Record<string, unknown> {
  if (node.kind === "llm") {
    if (!node.llm.outputKey) {
      return state;
    }
    return {
      ...state,
      [node.llm.outputKey]: `llm:${node.id}:${node.llm.prompt}`,
    };
  }

  if (node.kind === "tool") {
    if (!node.tool.outputKey) {
      return state;
    }
    return {
      ...state,
      [node.tool.outputKey]: `tool:${node.id}:${node.tool.toolId}`,
    };
  }

  if (!node.subgraph.outputKey) {
    return state;
  }
  return {
    ...state,
    [node.subgraph.outputKey]: `subgraph:${node.id}:${node.subgraph.workflowId}`,
  };
}

function unionArray(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of values) {
    const key = typeof item === "string" ? `s:${item}` : JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeField(strategy: WorkflowMergeStrategy, base: unknown, incoming: unknown): unknown {
  switch (strategy) {
    case "append": {
      if (Array.isArray(base) && Array.isArray(incoming)) {
        return [...base, ...incoming];
      }
      return incoming;
    }
    case "union": {
      if (Array.isArray(base) && Array.isArray(incoming)) {
        return unionArray([...base, ...incoming]);
      }
      return incoming;
    }
    case "object-merge": {
      if (
        base &&
        incoming &&
        typeof base === "object" &&
        typeof incoming === "object" &&
        !Array.isArray(base) &&
        !Array.isArray(incoming)
      ) {
        return { ...(base as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
      }
      return incoming;
    }
    case "replace":
    default:
      return incoming;
  }
}

function mergeAtJoin(
  baseState: Record<string, unknown>,
  upstreamStates: Record<string, Record<string, unknown>>,
  overrides: Record<string, WorkflowMergeStrategy> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...baseState };
  const upstreamIds = Object.keys(upstreamStates).sort();
  const keys = new Set<string>(Object.keys(baseState));
  for (const upstreamId of upstreamIds) {
    for (const key of Object.keys(upstreamStates[upstreamId] ?? {})) {
      keys.add(key);
    }
  }

  for (const key of keys) {
    let current: unknown = baseState[key];
    for (const upstreamId of upstreamIds) {
      const incoming = upstreamStates[upstreamId]?.[key];
      if (incoming === undefined) {
        continue;
      }
      const strategy = overrides?.[key] ?? "replace";
      current = mergeField(strategy, current, incoming);
    }
    if (current !== undefined) {
      result[key] = current;
    }
  }

  return result;
}

function addMsToIso(iso: string, deltaMs: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) {
    return iso;
  }
  return new Date(base + deltaMs).toISOString();
}

/**
 * 工作流图执行器（桌面个人态，确定性执行）。
 * 支持：
 * - start/end
 * - condition 按当前 state 路由
 * - parallel 扇出，显式 join 聚合后继续
 * - join 字段级合并策略
 * - retry 策略（按节点 policy.maxAttempts）
 * - human-input 节点暂停与恢复
 */
export class WorkflowGraphExecutor {
  private readonly store: WorkflowCheckpointStore;
  private readonly handlers: WorkflowNodeHandlerMap;
  private readonly logger: Logger;

  constructor(options: ExecutorOptions) {
    this.store = options.store;
    this.handlers = options.handlers;
    this.logger = options.logger;
  }

  /** 从 entry 节点开始执行，直到 end、暂停或失败。 */
  async run(input: { runId: string; definition: WorkflowGraphDefinition }): Promise<WorkflowRunResult> {
    const run = this.requireRun(input.runId);
    this.logger.info("开始执行工作流运行", { runId: run.id, definitionId: input.definition.id });
    const entry = this.getNode(input.definition, input.definition.entryNodeId);
    if (!entry || entry.kind !== "start") {
      const error = `entry_node_not_start:${input.definition.entryNodeId}`;
      this.store.updateRun(run.id, { status: "failed", state: run.state });
      this.store.createCheckpoint(run.id, {
        nodeId: input.definition.entryNodeId,
        status: "node-error",
        state: run.state,
        attempts: run.attempts,
        error,
      });
      return {
        status: "failed",
        state: run.state,
        attempts: run.attempts,
        error,
      };
    }

    return this.executeFromNode(run.id, input.definition, input.definition.entryNodeId, run.state);
  }

  /** 从最新检查点恢复执行（当前仅支持 human-input 恢复）。 */
  async resume(input: {
    runId: string;
    definition: WorkflowGraphDefinition;
    input: Record<string, unknown>;
  }): Promise<WorkflowRunResult> {
    const run = this.requireRun(input.runId);
    const checkpoint = this.store.getLatestCheckpoint(run.id);
    if (!checkpoint || checkpoint.status !== "waiting-human-input") {
      return {
        status: "failed",
        state: run.state,
        attempts: run.attempts,
        error: "not_waiting_human_input",
      };
    }

    const node = this.getNode(input.definition, checkpoint.nodeId);
    if (!node || node.kind !== "human-input") {
      return {
        status: "failed",
        state: run.state,
        attempts: run.attempts,
        error: "checkpoint_node_invalid",
      };
    }

    const nextState: Record<string, unknown> = {
      ...checkpoint.state,
      ...(input.input ?? {}),
    };

    this.store.updateRun(run.id, { state: nextState, status: "running", pausedAtNodeId: undefined });
    this.store.createCheckpoint(run.id, {
      nodeId: node.id,
      status: "node-complete",
      state: nextState,
      attempts: run.attempts,
    });

    this.logger.info("恢复 human-input 并继续执行", { runId: run.id, nodeId: node.id });
    const nextNodeId = this.getNextNodeId(input.definition, node.id, nextState);
    return this.executeFromNode(run.id, input.definition, nextNodeId, nextState);
  }

  /** 获取运行记录（不存在则抛错），用于保证执行流程明确可控。 */
  private requireRun(runId: string): WorkflowRunRecord {
    const run = this.store.getRun(runId);
    if (!run) {
      throw new Error(`run_not_found:${runId}`);
    }
    return run;
  }

  /** 按 id 查找节点。 */
  private getNode(definition: WorkflowGraphDefinition, nodeId: string): WorkflowNode | undefined {
    return definition.nodes.find((node) => node.id === nodeId);
  }

  /** 获取出边列表。 */
  private getOutgoingEdges(definition: WorkflowGraphDefinition, nodeId: string): WorkflowEdge[] {
    return definition.edges.filter((edge) => edge.fromNodeId === nodeId);
  }

  /** 执行 task/llm/tool/subgraph 等可执行节点，并统一处理重试、检查点和默认 typed 输出。 */
  private async executeExecutableNode(
    runId: string,
    node: WorkflowTaskNode | WorkflowLlmNode | WorkflowToolNode | WorkflowSubgraphNode,
    state: Record<string, unknown>,
  ): Promise<
    | { ok: true; state: Record<string, unknown> }
    | { ok: false; state: Record<string, unknown>; error: string }
  > {
    const maxAttempts = node.policy?.retry?.maxAttempts ?? 1;
    const backoffMs = node.policy?.retry?.backoffMs ?? 0;
    let currentState = { ...state };
    let lastError: unknown = undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const run = this.store.getRun(runId)!;
      const nextAttempts = { ...run.attempts, [node.id]: (run.attempts[node.id] ?? 0) + 1 };
      this.store.updateRun(runId, { attempts: nextAttempts });
      this.logger.info("执行可执行节点", { runId, nodeId: node.id, kind: node.kind, attempt });

      try {
        const produced = this.handlers[node.id]
          ? await this.handlers[node.id]({ runId, nodeId: node.id, state: currentState, attempt })
          : node.kind === "task"
            ? (() => {
                throw new Error(`handler_missing:${node.id}`);
              })()
            : createTypedNodeOutput(node, currentState);

        currentState = { ...(produced ?? currentState) };
        this.store.updateRun(runId, { state: currentState });
        this.store.createCheckpoint(runId, {
          nodeId: node.id,
          status: "node-complete",
          state: currentState,
          attempts: nextAttempts,
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        this.store.createCheckpoint(runId, {
          nodeId: node.id,
          status: "node-error",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < maxAttempts) {
          const now = this.store.getNow();
          const retryAt = addMsToIso(now, backoffMs);
          this.store.createCheckpoint(runId, {
            nodeId: node.id,
            status: "retry-scheduled",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            retryAt,
          });
        }
        this.logger.warn("可执行节点执行失败，将按重试策略处理", {
          runId,
          nodeId: node.id,
          kind: node.kind,
          attempt,
          maxAttempts,
        });
      }
    }

    if (lastError) {
      return {
        ok: false,
        state: currentState,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      };
    }

    return { ok: true, state: currentState };
  }

  /** 解析下一节点：优先匹配 conditional，然后 fallback normal。 */
  private getNextNodeId(definition: WorkflowGraphDefinition, nodeId: string, state: Record<string, unknown>): string {
    const currentNode = this.getNode(definition, nodeId);
    if (currentNode?.kind === "condition" && currentNode.route) {
      const routeMatched = evaluateCondition(state, currentNode.condition);
      const routedNodeId = routeMatched ? currentNode.route.trueNodeId : currentNode.route.falseNodeId;
      if (routedNodeId) {
        this.logger.info("条件节点命中内联路由", {
          fromNodeId: nodeId,
          toNodeId: routedNodeId,
          branch: routeMatched ? "true" : "false",
        });
        return routedNodeId;
      }
    }

    const outgoing = this.getOutgoingEdges(definition, nodeId);
    const conditional = outgoing.filter((edge) => edge.kind === "conditional");
    if (conditional.length) {
      const chosen = conditional.find((edge) => evaluateCondition(state, edge.condition));
      if (chosen) {
        this.logger.info("条件路由命中", { fromNodeId: nodeId, toNodeId: chosen.toNodeId });
        return chosen.toNodeId;
      }
    }
    const normal = outgoing.find((edge) => edge.kind === "normal");
    if (normal) {
      return normal.toNodeId;
    }
    throw new Error(`next_node_not_found:${nodeId}`);
  }

  /** 解析并执行并行扇出：等待所有分支到达同一个 join 节点后再继续。 */
  private async executeFanOutIfNeeded(input: {
    runId: string;
    definition: WorkflowGraphDefinition;
    fromNodeId: string;
    state: Record<string, unknown>;
  }): Promise<
    | { status: "no-fanout"; nextNodeId: string }
    | { status: "fanout"; nextNodeId: string; mergedState: Record<string, unknown> }
    | { status: "failed"; error: string }
  > {
    const outgoing = this.getOutgoingEdges(input.definition, input.fromNodeId)
      .filter((edge) => edge.kind === "parallel")
      .sort((a, b) => a.toNodeId.localeCompare(b.toNodeId));
    if (!outgoing.length) {
      return { status: "no-fanout", nextNodeId: this.getNextNodeId(input.definition, input.fromNodeId, input.state) };
    }

    this.logger.info("触发并行扇出", {
      runId: input.runId,
      fromNodeId: input.fromNodeId,
      branchCount: outgoing.length,
    });

    const baseState = { ...input.state };
    const upstreamStates: Record<string, Record<string, unknown>> = {};
    let joinNodeId: string | null = null;

    for (const edge of outgoing) {
      const branchStartId = edge.toNodeId;
      const branchResult = await this.executeBranchUntilJoin(input.runId, input.definition, branchStartId, baseState);
      if (branchResult.status !== "reached-join") {
        return { status: "failed", error: branchResult.error ?? "parallel_branch_failed" };
      }

      upstreamStates[branchResult.upstreamNodeId] = branchResult.state;
      joinNodeId = joinNodeId ?? branchResult.joinNodeId;
      if (joinNodeId !== branchResult.joinNodeId) {
        return { status: "failed", error: "parallel_join_mismatch" };
      }
    }

    if (!joinNodeId) {
      return { status: "failed", error: "join_not_reached" };
    }

    const joinNode = this.getNode(input.definition, joinNodeId);
    if (!joinNode || joinNode.kind !== "join") {
      return { status: "failed", error: "join_node_invalid" };
    }

    // 显式 join：必须满足 join.upstreamNodeIds（严格一致）才能合并继续。
    const expected = new Set(joinNode.join.upstreamNodeIds);
    const observed = new Set(Object.keys(upstreamStates));
    for (const observedId of observed) {
      if (!expected.has(observedId)) {
        return { status: "failed", error: `join_upstream_missing:${observedId}` };
      }
    }
    for (const expectedId of expected) {
      if (!observed.has(expectedId)) {
        return { status: "failed", error: `join_upstream_not_reached:${expectedId}` };
      }
    }

    const merged = mergeAtJoin(baseState, upstreamStates, joinNode.join.mergeStrategyOverrides);
    this.store.updateRun(input.runId, { state: merged });
    this.store.createCheckpoint(input.runId, {
      nodeId: joinNode.id,
      status: "node-complete",
      state: merged,
      attempts: this.store.getRun(input.runId)!.attempts,
    });

    this.logger.info("完成 join 合并并继续", { runId: input.runId, joinNodeId: joinNode.id });
    const nextNodeId = this.getNextNodeId(input.definition, joinNode.id, merged);
    return { status: "fanout", nextNodeId, mergedState: merged };
  }

  /** 从指定节点开始执行，直到遇到 end、暂停或失败。 */
  private async executeFromNode(
    runId: string,
    definition: WorkflowGraphDefinition,
    nodeId: string,
    state: Record<string, unknown>,
  ): Promise<WorkflowRunResult> {
    let currentNodeId = nodeId;
    let currentState: Record<string, unknown> = { ...state };

    for (;;) {
      const node = this.getNode(definition, currentNodeId);
      if (!node) {
        this.store.updateRun(runId, { status: "failed", state: currentState });
        return {
          status: "failed",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
          error: `node_not_found:${currentNodeId}`,
        };
      }

      this.logger.info("进入节点", { runId, nodeId: node.id, kind: node.kind });
      this.store.createCheckpoint(runId, {
        nodeId: node.id,
        status: "node-start",
        state: currentState,
        attempts: this.store.getRun(runId)!.attempts,
      });

      if (node.kind === "start") {
        const fanout = await this.executeFanOutIfNeeded({
          runId,
          definition,
          fromNodeId: node.id,
          state: currentState,
        });
        if (fanout.status === "failed") {
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: fanout.error,
          };
        }
        currentState = fanout.status === "fanout" ? fanout.mergedState : currentState;
        currentNodeId = fanout.nextNodeId;
        continue;
      }

      if (node.kind === "end") {
        this.store.updateRun(runId, { status: "succeeded", state: currentState, pausedAtNodeId: undefined });
        this.store.createCheckpoint(runId, {
          nodeId: node.id,
          status: "run-complete",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
        });
        this.logger.info("工作流运行结束", { runId, nodeId: node.id });
        return {
          status: "succeeded",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
        };
      }

      if (node.kind === "condition") {
        this.store.createCheckpoint(runId, {
          nodeId: node.id,
          status: "node-complete",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
        });
        const fanout = await this.executeFanOutIfNeeded({
          runId,
          definition,
          fromNodeId: node.id,
          state: currentState,
        });
        if (fanout.status === "failed") {
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: fanout.error,
          };
        }
        currentState = fanout.status === "fanout" ? fanout.mergedState : currentState;
        currentNodeId = fanout.nextNodeId;
        continue;
      }

      if (node.kind === "human-input") {
        this.store.updateRun(runId, { status: "paused", state: currentState, pausedAtNodeId: node.id });
        this.store.createCheckpoint(runId, {
          nodeId: node.id,
          status: "waiting-human-input",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
        });
        this.logger.info("暂停等待人工输入", { runId, nodeId: node.id, field: node.humanInput.field });
        return {
          status: "paused",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
          pausedAtNodeId: node.id,
        };
      }

      if (node.kind === "llm" || node.kind === "tool" || node.kind === "subgraph") {
        const executionResult = await this.executeExecutableNode(runId, node, currentState);
        currentState = executionResult.state;
        if (!executionResult.ok) {
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: executionResult.error,
          };
        }

        const fanout = await this.executeFanOutIfNeeded({
          runId,
          definition,
          fromNodeId: node.id,
          state: currentState,
        });
        if (fanout.status === "failed") {
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: fanout.error,
          };
        }
        currentState = fanout.status === "fanout" ? fanout.mergedState : currentState;
        currentNodeId = fanout.nextNodeId;
        continue;
      }

      if (node.kind === "task") {
        const handler = this.handlers[node.id];
        if (!handler) {
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: `handler_missing:${node.id}`,
          };
        }

        const maxAttempts = node.policy?.retry?.maxAttempts ?? 1;
        const backoffMs = node.policy?.retry?.backoffMs ?? 0;
        let lastError: unknown = undefined;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const run = this.store.getRun(runId)!;
          const nextAttempts = { ...run.attempts, [node.id]: (run.attempts[node.id] ?? 0) + 1 };
          this.store.updateRun(runId, { attempts: nextAttempts });
          this.logger.info("执行任务节点", { runId, nodeId: node.id, attempt });

          try {
            const produced = await handler({ runId, nodeId: node.id, state: currentState, attempt });
            currentState = { ...(produced ?? currentState) };
            this.store.updateRun(runId, { state: currentState });
            this.store.createCheckpoint(runId, {
              nodeId: node.id,
              status: "node-complete",
              state: currentState,
              attempts: nextAttempts,
            });
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            this.store.createCheckpoint(runId, {
              nodeId: node.id,
              status: "node-error",
              state: currentState,
              attempts: this.store.getRun(runId)!.attempts,
              error: error instanceof Error ? error.message : String(error),
            });
            if (attempt < maxAttempts) {
              const now = this.store.getNow();
              const retryAt = addMsToIso(now, backoffMs);
              this.store.createCheckpoint(runId, {
                nodeId: node.id,
                status: "retry-scheduled",
                state: currentState,
                attempts: this.store.getRun(runId)!.attempts,
                retryAt,
              });
            }
            this.logger.warn("任务节点执行失败，将按重试策略处理", {
              runId,
              nodeId: node.id,
              attempt,
              maxAttempts,
            });
          }
        }

        if (lastError) {
          const message = lastError instanceof Error ? lastError.message : String(lastError);
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: message,
          };
        }

        const fanout = await this.executeFanOutIfNeeded({
          runId,
          definition,
          fromNodeId: node.id,
          state: currentState,
        });
        if (fanout.status === "failed") {
          this.store.updateRun(runId, { status: "failed", state: currentState });
          return {
            status: "failed",
            state: currentState,
            attempts: this.store.getRun(runId)!.attempts,
            error: fanout.error,
          };
        }
        currentState = fanout.status === "fanout" ? fanout.mergedState : currentState;
        currentNodeId = fanout.nextNodeId;
        continue;
      }

      if (node.kind === "join") {
        // join 通常由 parallel 处理，这里只做最小前进逻辑。
        this.store.createCheckpoint(runId, {
          nodeId: node.id,
          status: "node-complete",
          state: currentState,
          attempts: this.store.getRun(runId)!.attempts,
        });
        currentNodeId = this.getNextNodeId(definition, node.id, currentState);
        continue;
      }

      this.store.updateRun(runId, { status: "failed", state: currentState });
      return {
        status: "failed",
        state: currentState,
        attempts: this.store.getRun(runId)!.attempts,
        error: `unsupported_node_kind:${(node as WorkflowNode).kind}`,
      };
    }
  }

  /** 执行并行分支：从分支起点执行，直到下一跳指向 join（返回该 join 与 upstream 的状态）。 */
  private async executeBranchUntilJoin(
    runId: string,
    definition: WorkflowGraphDefinition,
    startNodeId: string,
    baseState: Record<string, unknown>,
  ): Promise<
    | { status: "reached-join"; joinNodeId: string; upstreamNodeId: string; state: Record<string, unknown> }
    | { status: "failed"; error: string }
  > {
    let currentNodeId = startNodeId;
    let currentState = { ...baseState };

    for (;;) {
      const node = this.getNode(definition, currentNodeId);
      if (!node) {
        return { status: "failed", error: `node_not_found:${currentNodeId}` };
      }

      if (node.kind === "end") {
        return { status: "failed", error: "branch_reached_end_without_join" };
      }

      if (node.kind === "llm" || node.kind === "tool" || node.kind === "subgraph") {
        const executionResult = await this.executeExecutableNode(runId, node, currentState);
        currentState = executionResult.state;
        if (!executionResult.ok) {
          return { status: "failed", error: executionResult.error };
        }
        const next = this.getNextNodeId(definition, node.id, currentState);
        const nextNode = this.getNode(definition, next);
        if (nextNode?.kind === "join") {
          return { status: "reached-join", joinNodeId: nextNode.id, upstreamNodeId: node.id, state: currentState };
        }
        currentNodeId = next;
        continue;
      }

      if (node.kind === "task") {
        const handler = this.handlers[node.id];
        if (!handler) {
          return { status: "failed", error: `handler_missing:${node.id}` };
        }
        const maxAttempts = node.policy?.retry?.maxAttempts ?? 1;
        let lastError: unknown = undefined;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const run = this.store.getRun(runId)!;
          const nextAttempts = { ...run.attempts, [node.id]: (run.attempts[node.id] ?? 0) + 1 };
          this.store.updateRun(runId, { attempts: nextAttempts });
          try {
            const produced = await handler({ runId, nodeId: node.id, state: currentState, attempt });
            currentState = { ...(produced ?? currentState) };
            this.store.updateRun(runId, { state: currentState });
            this.store.createCheckpoint(runId, {
              nodeId: node.id,
              status: "node-complete",
              state: currentState,
              attempts: nextAttempts,
            });
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            this.store.createCheckpoint(runId, {
              nodeId: node.id,
              status: "node-error",
              state: currentState,
              attempts: this.store.getRun(runId)!.attempts,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (lastError) {
          return { status: "failed", error: lastError instanceof Error ? lastError.message : String(lastError) };
        }
        const next = this.getNextNodeId(definition, node.id, currentState);
        const nextNode = this.getNode(definition, next);
        if (nextNode?.kind === "join") {
          return { status: "reached-join", joinNodeId: nextNode.id, upstreamNodeId: node.id, state: currentState };
        }
        currentNodeId = next;
        continue;
      }

      if (node.kind === "condition") {
        const next = this.getNextNodeId(definition, node.id, currentState);
        const nextNode = this.getNode(definition, next);
        if (nextNode?.kind === "join") {
          return { status: "reached-join", joinNodeId: nextNode.id, upstreamNodeId: node.id, state: currentState };
        }
        currentNodeId = next;
        continue;
      }

      if (node.kind === "human-input" || node.kind === "start" || node.kind === "join") {
        return { status: "failed", error: `unsupported_branch_node:${node.kind}` };
      }

      return { status: "failed", error: `unsupported_branch_node:${(node as WorkflowNode).kind}` };
    }
  }
}
