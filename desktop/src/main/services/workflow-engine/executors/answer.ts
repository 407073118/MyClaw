import type { WorkflowAnswerNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { renderWorkflowTemplate } from "../variable-resolver";

export class AnswerNodeExecutor implements NodeExecutor {
  readonly kind = "answer" as const;

  /** 执行回复节点，把模板渲染结果写入 outputs，供对话流或结束节点直接消费。 */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowAnswerNode;
    const outputKey = node.answer.outputKey?.trim() || "answer";
    const content = renderWorkflowTemplate(node.answer.template, ctx.state, ctx.resolvedInputs);

    console.info("[workflow:answer] 回复节点已生成对话输出", {
      runId: ctx.runId,
      nodeId: node.id,
      outputKey,
      contentLength: content.length,
    });

    return {
      writes: [{ channelName: "outputs", value: { [outputKey]: content } }],
      outputs: { [outputKey]: content },
      durationMs: Date.now() - start,
    };
  }
}
