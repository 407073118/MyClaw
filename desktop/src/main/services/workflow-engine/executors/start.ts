import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export class StartNodeExecutor implements NodeExecutor {
  readonly kind = "start" as const;

  async execute(_ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    return { writes: [], outputs: {}, durationMs: 0 };
  }
}
