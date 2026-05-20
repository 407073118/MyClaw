import vm from "node:vm";
import type { WorkflowCodeNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

function snapshotWorkflowState(state: ReadonlyMap<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(state.entries());
}

export class CodeNodeExecutor implements NodeExecutor {
  readonly kind = "code" as const;

  /** 执行受限 JavaScript 代码节点，用于确定性字段计算和轻量数据转换。 */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowCodeNode;
    const outputKey = node.code.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "codeOutput";
    const scriptSource = `(function(inputs, state) {\n${node.code.source}\n})(inputs, state)`;
    const sandbox = {
      inputs: Object.freeze({ ...ctx.resolvedInputs }),
      state: Object.freeze(snapshotWorkflowState(ctx.state)),
      result: undefined as unknown,
    };

    console.info("[workflow:code] 开始执行代码节点", {
      runId: ctx.runId,
      nodeId: node.id,
      outputKey,
      sourceLength: node.code.source.length,
    });

    try {
      const result = vm.runInNewContext(scriptSource, sandbox, {
        timeout: Math.min(ctx.config.recursionLimit * 100, 5000),
      });
      console.info("[workflow:code] 代码节点执行完成", {
        runId: ctx.runId,
        nodeId: node.id,
        outputKey,
        resultType: Array.isArray(result) ? "array" : typeof result,
      });
      return {
        writes: [{ channelName: outputKey, value: result }],
        outputs: { result },
        durationMs: Date.now() - start,
      };
    } catch (error) {
      console.error("[workflow:code] 代码节点执行失败", {
        runId: ctx.runId,
        nodeId: node.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
