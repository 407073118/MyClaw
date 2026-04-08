import type { WorkflowJoinNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export class JoinNodeExecutor implements NodeExecutor {
  readonly kind = "join" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const node = ctx.node as WorkflowJoinNode;
    if (node.join.mode === "any") {
      return {
        writes: [{ channelName: "__route__", value: "continue" }],
        outputs: { joinCompleted: true, mode: "any" },
        durationMs: 0,
      };
    }
    return {
      writes: [{ channelName: "__route__", value: "continue" }],
      outputs: { joinCompleted: true, mode: "all" },
      durationMs: 0,
    };
  }
}
