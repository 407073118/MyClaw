import type { WorkflowToolNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { resolveLegacyInputBindings } from "../variable-resolver";

export type ToolExecutorFn = (
  toolId: string,
  args: Record<string, unknown>,
  workingDir: string,
) => Promise<{ success: boolean; output: string; error?: string }>;

export type McpToolCallerFn = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>;

export function parseMcpToolId(toolId: string): { serverId: string; toolName: string } {
  // MCP 工具名本身允许包含 "__"，这里只切第一处分隔符，避免破坏真实工具名。
  const prefix = "mcp__";
  if (!toolId.startsWith(prefix)) {
    return { serverId: "", toolName: toolId };
  }
  const rest = toolId.slice(prefix.length);
  const separatorIndex = rest.indexOf("__");
  if (separatorIndex < 0) {
    return { serverId: rest, toolName: "" };
  }
  return {
    serverId: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  };
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
      const result = await this.toolExecutor(toolId, args, ctx.config.workingDirectory);
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
