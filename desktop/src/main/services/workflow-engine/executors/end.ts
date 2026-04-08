import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export class EndNodeExecutor implements NodeExecutor {
  readonly kind = "end" as const;

  async execute(_ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    return {
      writes: [{ channelName: "__done__", value: true }],
      outputs: {},
      durationMs: 0,
    };
  }
}
