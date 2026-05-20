import type { WorkflowVariableAssignerNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { resolveWorkflowInputSources } from "../variable-resolver";

export class VariableAssignerNodeExecutor implements NodeExecutor {
  readonly kind = "variable-assigner" as const;

  /** 执行变量赋值节点，把结构化来源写入 vars 或 outputs 聚合 channel。 */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowVariableAssignerNode;
    const target = node.variableAssigner.target === "outputs" ? "outputs" : "vars";
    const assigned = resolveWorkflowInputSources(
      node.variableAssigner.assignments,
      ctx.state,
      ctx.resolvedInputs,
    );

    console.info("[workflow:variables] 变量赋值节点已写入运行态", {
      runId: ctx.runId,
      nodeId: node.id,
      target,
      keys: Object.keys(assigned),
    });

    return {
      writes: [{ channelName: target, value: assigned }],
      outputs: { assigned, target },
      durationMs: Date.now() - start,
    };
  }
}
