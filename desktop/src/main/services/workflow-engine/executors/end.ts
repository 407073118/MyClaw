import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import type { WorkflowEndNode } from "@shared/contracts";
import { resolveWorkflowInputSources } from "../variable-resolver";

export class EndNodeExecutor implements NodeExecutor {
  readonly kind = "end" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const node = ctx.node as WorkflowEndNode;
    const outputs = resolveWorkflowInputSources(node.outputSources, ctx.state, ctx.resolvedInputs);
    const finalOutputs = Object.keys(outputs).length > 0 ? outputs : buildFallbackFinalOutputs(ctx.state);
    const writes = Object.keys(outputs).length > 0
      ? [{ channelName: "outputs", value: finalOutputs }, { channelName: "__done__", value: true }]
      : [{ channelName: "outputs", value: finalOutputs }, { channelName: "__done__", value: true }];
    return {
      writes,
      outputs: finalOutputs,
      durationMs: 0,
    };
  }
}

/** 没配置 End 输出时自动兜底，保证最简单的 Start -> LLM -> End 能看到最终结果。 */
function buildFallbackFinalOutputs(state: ReadonlyMap<string, unknown>): Record<string, unknown> {
  const existingOutputs = state.get("outputs");
  if (existingOutputs && typeof existingOutputs === "object" && !Array.isArray(existingOutputs)) {
    return existingOutputs as Record<string, unknown>;
  }
  const lastLlmOutput = state.get("lastLlmOutput");
  if (lastLlmOutput !== undefined) {
    return { output: lastLlmOutput };
  }
  const nodes = state.get("nodes");
  if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
    const nodeOutputs = Object.values(nodes as Record<string, unknown>);
    const latestOutput = nodeOutputs[nodeOutputs.length - 1];
    if (latestOutput && typeof latestOutput === "object" && !Array.isArray(latestOutput)) {
      const content = (latestOutput as Record<string, unknown>).content;
      if (content !== undefined) return { output: content };
    }
    if (latestOutput !== undefined) return { output: latestOutput };
  }
  return {};
}
