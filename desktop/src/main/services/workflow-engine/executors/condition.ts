import type { WorkflowConditionNode, WorkflowTransitionConditionOperator } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export function resolveJsonPath(path: string, state: ReadonlyMap<string, unknown>): unknown {
  const key = path.startsWith("$.") ? path.slice(2) : path;
  const parts = key.split(".");
  let current: unknown = state.get(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  return current;
}

export function evaluateCondition(
  operator: WorkflowTransitionConditionOperator,
  leftValue: unknown,
  rightValue: unknown,
): boolean {
  switch (operator) {
    case "equals": return leftValue === rightValue;
    case "not-equals": return leftValue !== rightValue;
    case "greater-than": return Number(leftValue) > Number(rightValue);
    case "greater-or-equal": return Number(leftValue) >= Number(rightValue);
    case "less-than": return Number(leftValue) < Number(rightValue);
    case "less-or-equal": return Number(leftValue) <= Number(rightValue);
    case "exists": return leftValue !== undefined && leftValue !== null;
    case "not-exists": return leftValue === undefined || leftValue === null;
    case "in": return Array.isArray(rightValue) && rightValue.includes(leftValue);
    case "not-in": return !Array.isArray(rightValue) || !rightValue.includes(leftValue);
    default: return false;
  }
}

export class ConditionNodeExecutor implements NodeExecutor {
  readonly kind = "condition" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowConditionNode;

    if (!node.condition || !node.route) {
      return { writes: [], outputs: { error: "missing condition or route" }, durationMs: Date.now() - start };
    }

    const leftValue = resolveJsonPath(node.condition.leftPath, ctx.state);
    const result = evaluateCondition(node.condition.operator, leftValue, node.condition.rightValue);
    const targetNodeId = result ? node.route.trueNodeId : node.route.falseNodeId;

    return {
      writes: targetNodeId ? [{ channelName: "__route__", value: targetNodeId }] : [],
      outputs: { conditionResult: result, targetNodeId },
      durationMs: Date.now() - start,
    };
  }
}
