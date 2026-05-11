import type { WorkflowToolNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { resolveLegacyInputBindings } from "../variable-resolver";

export type ToolExecutorFn = (
  toolId: string,
  label: string,
  workingDir: string,
) => Promise<{ success: boolean; output: string; error?: string }>;

export type McpToolCallerFn = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>;

export function parseMcpToolId(toolId: string): { serverId: string; toolName: string } {
  const parts = toolId.split("__");
  return { serverId: parts[1] ?? "", toolName: parts[2] ?? "" };
}

export class ToolNodeExecutor implements NodeExecutor {
  readonly kind = "tool" as const;

  constructor(
    private toolExecutor: ToolExecutorFn,
    private mcpCaller: McpToolCallerFn | null,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowToolNode;
    const { toolId } = node.tool;
    const args = {
      ...this.resolveArgs(node, ctx.state),
      ...ctx.resolvedInputs,
    };
    let output: string;
    if (toolId.startsWith("mcp__") && this.mcpCaller) {
      const { serverId, toolName } = parseMcpToolId(toolId);
      output = await this.mcpCaller(serverId, toolName, args);
    } else {
      const label = `${toolId}(${JSON.stringify(args).slice(0, 100)})`;
      const result = await this.toolExecutor(toolId, label, ctx.config.workingDirectory);
      output = result.success ? result.output : `[错误] ${result.error ?? "unknown"}`;
    }
    const outputKey = node.tool.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "lastToolOutput";
    return {
      writes: [{ channelName: outputKey, value: output }],
      outputs: { toolId, output: output.slice(0, 500) },
      durationMs: Date.now() - start,
    };
  }

  private resolveArgs(node: WorkflowToolNode, state: ReadonlyMap<string, unknown>): Record<string, unknown> {
    return resolveLegacyInputBindings(node.inputBindings, state);
  }
}
