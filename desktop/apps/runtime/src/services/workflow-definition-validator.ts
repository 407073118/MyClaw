import type { WorkflowDefinition } from "@myclaw-desktop/shared";

export type WorkflowDefinitionValidationResult =
  | { valid: true }
  | { valid: false; error: string };

const WORKFLOW_NODE_KINDS = new Set<WorkflowDefinition["nodes"][number]["kind"]>([
  "start",
  "llm",
  "tool",
  "human-input",
  "condition",
  "subgraph",
  "join",
  "end",
]);

const WORKFLOW_EDGE_KINDS = new Set<WorkflowDefinition["edges"][number]["kind"]>([
  "normal",
  "conditional",
  "parallel",
]);

const STATE_VALUE_TYPES = new Set<WorkflowDefinition["stateSchema"][number]["valueType"]>([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "null",
  "unknown",
]);

const MERGE_STRATEGIES = new Set<WorkflowDefinition["stateSchema"][number]["mergeStrategy"]>([
  "replace",
  "append",
  "union",
  "object-merge",
  "custom",
]);

const CONDITION_OPERATORS = new Set<string>([
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
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWorkflowConditionValid(
  condition: {
    operator?: unknown;
    leftPath?: unknown;
  } | undefined,
): boolean {
  return Boolean(
    condition &&
    typeof condition === "object" &&
    typeof condition.operator === "string" &&
    CONDITION_OPERATORS.has(condition.operator) &&
    isNonEmptyString(condition.leftPath),
  );
}

function isWorkflowRouteTargetValid(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isWorkflowNodePolicyValid(policy: WorkflowDefinition["nodes"][number]["policy"]): boolean {
  if (policy === undefined) {
    return true;
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return false;
  }
  if (policy.timeoutMs !== undefined && (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs < 0)) {
    return false;
  }
  if (policy.retry !== undefined) {
    if (!policy.retry || typeof policy.retry !== "object" || Array.isArray(policy.retry)) {
      return false;
    }
    if (!Number.isFinite(policy.retry.maxAttempts) || policy.retry.maxAttempts < 1) {
      return false;
    }
    if (!Number.isFinite(policy.retry.backoffMs) || policy.retry.backoffMs < 0) {
      return false;
    }
  }
  if (policy.idempotencyKeyTemplate !== undefined && !isNonEmptyString(policy.idempotencyKeyTemplate)) {
    return false;
  }
  if (policy.onFailure !== undefined) {
    if (!policy.onFailure || typeof policy.onFailure !== "object" || Array.isArray(policy.onFailure)) {
      return false;
    }
    if (policy.onFailure.mode !== "stop" && policy.onFailure.mode !== "route") {
      return false;
    }
    if (policy.onFailure.mode === "route" && !isNonEmptyString(policy.onFailure.routeNodeId)) {
      return false;
    }
    if (policy.onFailure.routeNodeId !== undefined && !isNonEmptyString(policy.onFailure.routeNodeId)) {
      return false;
    }
  }

  return true;
}

function isWorkflowDefaultsRunPolicyValid(defaults: WorkflowDefinition["defaults"]): boolean {
  if (defaults === undefined) {
    return true;
  }
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return false;
  }
  if (defaults.run !== undefined) {
    if (!defaults.run || typeof defaults.run !== "object" || Array.isArray(defaults.run)) {
      return false;
    }
    if (
      defaults.run.maxParallelNodes !== undefined &&
      (!Number.isFinite(defaults.run.maxParallelNodes) || defaults.run.maxParallelNodes < 1)
    ) {
      return false;
    }
    if (
      defaults.run.checkpointPolicy !== undefined &&
      defaults.run.checkpointPolicy !== "node-complete" &&
      defaults.run.checkpointPolicy !== "always"
    ) {
      return false;
    }
  }

  return isWorkflowNodePolicyValid(defaults.nodePolicy);
}

/** 验证工作流定义的基础结构，确保图数据可被 runtime 安全执行。 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinitionValidationResult {
  if (!isNonEmptyString(definition.id)) {
    return { valid: false, error: "workflow_id_required" };
  }
  if (!isNonEmptyString(definition.name)) {
    return { valid: false, error: "workflow_name_required" };
  }
  if (!isNonEmptyString(definition.description)) {
    return { valid: false, error: "workflow_description_required" };
  }
  if (!isNonEmptyString(definition.libraryRootId)) {
    return { valid: false, error: "library_root_required" };
  }
  if (!Number.isFinite(definition.version) || definition.version < 1) {
    return { valid: false, error: "workflow_version_invalid" };
  }
  if (!isNonEmptyString(definition.entryNodeId)) {
    return { valid: false, error: "entry_node_required" };
  }
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    return { valid: false, error: "nodes_required" };
  }
  if (!Array.isArray(definition.edges)) {
    return { valid: false, error: "edges_required" };
  }
  if (!Array.isArray(definition.stateSchema)) {
    return { valid: false, error: "state_schema_required" };
  }

  const nodeIds = new Set<string>();
  for (const node of definition.nodes) {
    if (!isNonEmptyString(node.id)) {
      return { valid: false, error: "node_id_required" };
    }
    if (!isNonEmptyString(node.label)) {
      return { valid: false, error: "node_label_required" };
    }
    if (!WORKFLOW_NODE_KINDS.has(node.kind)) {
      return { valid: false, error: "node_kind_invalid" };
    }
    if (nodeIds.has(node.id)) {
      return { valid: false, error: "duplicate_node_id" };
    }
    if (node.kind === "llm" && (!node.llm || !isNonEmptyString(node.llm.prompt))) {
      return { valid: false, error: "llm_node_prompt_required" };
    }
    if (node.kind === "llm" && node.llm.outputKey !== undefined && !isNonEmptyString(node.llm.outputKey)) {
      return { valid: false, error: "llm_node_output_key_required" };
    }
    if (node.kind === "tool" && (!node.tool || !isNonEmptyString(node.tool.toolId))) {
      return { valid: false, error: "tool_node_tool_id_required" };
    }
    if (node.kind === "tool" && node.tool.outputKey !== undefined && !isNonEmptyString(node.tool.outputKey)) {
      return { valid: false, error: "tool_node_output_key_required" };
    }
    if (node.kind === "human-input" && (!node.humanInput || !isNonEmptyString(node.humanInput.formKey))) {
      return { valid: false, error: "human_input_form_key_required" };
    }
    if (node.kind === "subgraph" && (!node.subgraph || !isNonEmptyString(node.subgraph.workflowId))) {
      return { valid: false, error: "subgraph_workflow_id_required" };
    }
    if (node.kind === "subgraph" && node.subgraph.outputKey !== undefined && !isNonEmptyString(node.subgraph.outputKey)) {
      return { valid: false, error: "subgraph_output_key_required" };
    }
    if (node.kind === "condition") {
      if (node.condition !== undefined && !isWorkflowConditionValid(node.condition)) {
        return { valid: false, error: "condition_node_rule_invalid" };
      }
      if (node.route !== undefined) {
        if (!node.route || typeof node.route !== "object" || Array.isArray(node.route)) {
          return { valid: false, error: "condition_route_invalid" };
        }
        if (
          !isWorkflowRouteTargetValid(node.route.trueNodeId) ||
          !isWorkflowRouteTargetValid(node.route.falseNodeId)
        ) {
          return { valid: false, error: "condition_route_invalid" };
        }
      }
    }
    if (!isWorkflowNodePolicyValid(node.policy)) {
      return { valid: false, error: "node_policy_invalid" };
    }
    if (node.kind === "join") {
      if (!node.join || typeof node.join !== "object" || Array.isArray(node.join)) {
        return { valid: false, error: "join_config_required" };
      }
      if (node.join.mode !== "all" && node.join.mode !== "any") {
        return { valid: false, error: "join_mode_invalid" };
      }
      if (!Array.isArray(node.join.upstreamNodeIds) || node.join.upstreamNodeIds.length === 0) {
        return { valid: false, error: "join_upstream_required" };
      }
      for (const upstreamNodeId of node.join.upstreamNodeIds) {
        if (!isNonEmptyString(upstreamNodeId)) {
          return { valid: false, error: "join_upstream_invalid" };
        }
      }
      if (node.join.mergeStrategyOverrides !== undefined) {
        if (
          !node.join.mergeStrategyOverrides ||
          typeof node.join.mergeStrategyOverrides !== "object" ||
          Array.isArray(node.join.mergeStrategyOverrides)
        ) {
          return { valid: false, error: "join_merge_overrides_invalid" };
        }
        for (const strategy of Object.values(node.join.mergeStrategyOverrides)) {
          if (typeof strategy !== "string") {
            return { valid: false, error: "join_merge_strategy_invalid" };
          }
        }
      }
    }
    nodeIds.add(node.id);
  }

  if (!nodeIds.has(definition.entryNodeId)) {
    return { valid: false, error: "entry_node_not_found" };
  }

  const stateKeys = new Set<string>();
  for (const field of definition.stateSchema) {
    if (!isNonEmptyString(field.key)) {
      return { valid: false, error: "state_field_key_required" };
    }
    if (!isNonEmptyString(field.label)) {
      return { valid: false, error: "state_field_label_required" };
    }
    if (!isNonEmptyString(field.description)) {
      return { valid: false, error: "state_field_description_required" };
    }
    if (!STATE_VALUE_TYPES.has(field.valueType)) {
      return { valid: false, error: "state_field_value_type_invalid" };
    }
    if (!MERGE_STRATEGIES.has(field.mergeStrategy)) {
      return { valid: false, error: "state_field_merge_strategy_invalid" };
    }
    if (typeof field.required !== "boolean") {
      return { valid: false, error: "state_field_required_invalid" };
    }
    if (!Array.isArray(field.producerNodeIds) || !Array.isArray(field.consumerNodeIds)) {
      return { valid: false, error: "state_field_node_links_invalid" };
    }
    if (stateKeys.has(field.key)) {
      return { valid: false, error: "duplicate_state_field_key" };
    }
    for (const producerNodeId of field.producerNodeIds) {
      if (!isNonEmptyString(producerNodeId)) {
        return { valid: false, error: "state_field_producer_node_id_required" };
      }
    }
    for (const consumerNodeId of field.consumerNodeIds) {
      if (!isNonEmptyString(consumerNodeId)) {
        return { valid: false, error: "state_field_consumer_node_id_required" };
      }
    }
    stateKeys.add(field.key);
  }

  if (definition.editor !== undefined) {
    if (
      !definition.editor ||
      typeof definition.editor !== "object" ||
      Array.isArray(definition.editor) ||
      !definition.editor.canvas ||
      typeof definition.editor.canvas !== "object" ||
      Array.isArray(definition.editor.canvas)
    ) {
      return { valid: false, error: "editor_canvas_invalid" };
    }

    const { viewport, nodes } = definition.editor.canvas;
    if (
      !viewport ||
      typeof viewport !== "object" ||
      Array.isArray(viewport) ||
      !isFiniteNumber((viewport as Record<string, unknown>).offsetX) ||
      !isFiniteNumber((viewport as Record<string, unknown>).offsetY)
    ) {
      return { valid: false, error: "editor_canvas_viewport_invalid" };
    }

    if (!Array.isArray(nodes)) {
      return { valid: false, error: "editor_canvas_nodes_invalid" };
    }

    const editorNodeIds = new Set<string>();
    for (const layout of nodes) {
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
        return { valid: false, error: "editor_canvas_nodes_invalid" };
      }

      if (!isNonEmptyString(layout.nodeId)) {
        return { valid: false, error: "editor_canvas_node_id_required" };
      }
      if (editorNodeIds.has(layout.nodeId)) {
        return { valid: false, error: "editor_canvas_duplicate_node_id" };
      }
      if (!nodeIds.has(layout.nodeId)) {
        return { valid: false, error: "editor_canvas_node_not_found" };
      }

      if (
        !layout.position ||
        typeof layout.position !== "object" ||
        Array.isArray(layout.position) ||
        !isFiniteNumber((layout.position as Record<string, unknown>).x) ||
        !isFiniteNumber((layout.position as Record<string, unknown>).y)
      ) {
        return { valid: false, error: "editor_canvas_position_invalid" };
      }

      editorNodeIds.add(layout.nodeId);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of definition.edges) {
    if (!isNonEmptyString(edge.id)) {
      return { valid: false, error: "edge_id_required" };
    }
    if (!WORKFLOW_EDGE_KINDS.has(edge.kind)) {
      return { valid: false, error: "edge_kind_invalid" };
    }
    if (edgeIds.has(edge.id)) {
      return { valid: false, error: "duplicate_edge_id" };
    }
    edgeIds.add(edge.id);

    if (!isNonEmptyString(edge.fromNodeId) || !isNonEmptyString(edge.toNodeId)) {
      return { valid: false, error: "edge_node_id_required" };
    }
    if (!nodeIds.has(edge.fromNodeId)) {
      return { valid: false, error: "edge_source_not_found" };
    }
    if (!nodeIds.has(edge.toNodeId)) {
      return { valid: false, error: "edge_target_not_found" };
    }
    if (edge.kind === "conditional") {
      if (!isWorkflowConditionValid(edge.condition)) {
        return { valid: false, error: "conditional_edge_missing_condition" };
      }
    }
  }

  for (const field of definition.stateSchema) {
    for (const producerNodeId of field.producerNodeIds) {
      if (!nodeIds.has(producerNodeId)) {
        return { valid: false, error: "state_field_producer_node_not_found" };
      }
    }
    for (const consumerNodeId of field.consumerNodeIds) {
      if (!nodeIds.has(consumerNodeId)) {
        return { valid: false, error: "state_field_consumer_node_not_found" };
      }
    }
  }

  for (const node of definition.nodes) {
    if (node.kind === "condition") {
      const outgoingEdges = definition.edges.filter((edge) => edge.fromNodeId === node.id);
      const hasInlineRule = isWorkflowConditionValid(node.condition);
      const hasConditionalEdgeRule = outgoingEdges.some((edge) => (
        edge.kind === "conditional" && isWorkflowConditionValid(edge.condition)
      ));

      if (!hasInlineRule && !hasConditionalEdgeRule) {
        return { valid: false, error: "condition_node_rule_required" };
      }
      if (node.route?.trueNodeId && !outgoingEdges.some((edge) => edge.toNodeId === node.route?.trueNodeId)) {
        return { valid: false, error: "condition_route_edge_missing" };
      }
      if (node.route?.falseNodeId && !outgoingEdges.some((edge) => edge.toNodeId === node.route?.falseNodeId)) {
        return { valid: false, error: "condition_route_edge_missing" };
      }
    }

    if (node.kind !== "join") {
      if (node.policy?.onFailure?.mode === "route" && !nodeIds.has(node.policy.onFailure.routeNodeId ?? "")) {
        return { valid: false, error: "node_policy_route_target_not_found" };
      }
      continue;
    }
    const incomingUpstreamIds = new Set(
      definition.edges.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.fromNodeId),
    );
    for (const upstreamId of node.join.upstreamNodeIds) {
      if (!nodeIds.has(upstreamId)) {
        return { valid: false, error: "join_upstream_not_found" };
      }
      if (!incomingUpstreamIds.has(upstreamId)) {
        return { valid: false, error: "join_upstream_edge_missing" };
      }
    }
    if (node.join.mergeStrategyOverrides) {
      for (const fieldKey of Object.keys(node.join.mergeStrategyOverrides)) {
        if (!stateKeys.has(fieldKey)) {
          return { valid: false, error: "join_merge_field_not_found" };
        }
        const strategy = node.join.mergeStrategyOverrides[fieldKey];
        if (!MERGE_STRATEGIES.has(strategy)) {
          return { valid: false, error: "join_merge_strategy_invalid" };
        }
      }
    }
  }

  if (definition.nodeCount !== definition.nodes.length) {
    return { valid: false, error: "summary_node_count_mismatch" };
  }
  if (definition.edgeCount !== definition.edges.length) {
    return { valid: false, error: "summary_edge_count_mismatch" };
  }
  if (!isWorkflowDefaultsRunPolicyValid(definition.defaults)) {
    return { valid: false, error: "defaults_run_policy_invalid" };
  }

  return { valid: true };
}
