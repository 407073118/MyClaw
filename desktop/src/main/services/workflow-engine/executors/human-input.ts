import type { WorkflowHumanInputNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { GraphInterrupt } from "../errors";

export class HumanInputNodeExecutor implements NodeExecutor {
  readonly kind = "human-input" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const node = ctx.node as WorkflowHumanInputNode;
    const formKey = node.humanInput.formKey;
    const resumeValue = ctx.state.get("__resume__");
    if (resumeValue !== undefined) {
      return {
        writes: [{ channelName: formKey, value: resumeValue }],
        outputs: { humanInput: resumeValue },
        durationMs: 0,
      };
    }
    throw new GraphInterrupt({
      type: "input",
      nodeId: node.id,
      formKey,
      prompt: node.label,
      currentState: Object.fromEntries(ctx.state),
    });
  }
}
