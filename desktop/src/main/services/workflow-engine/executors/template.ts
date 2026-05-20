import type { WorkflowTemplateNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { renderWorkflowTemplate } from "../variable-resolver";

export class TemplateNodeExecutor implements NodeExecutor {
  readonly kind = "template" as const;

  /** 执行模板转换节点，把上游变量拼装成确定性的文本结果。 */
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowTemplateNode;
    const content = renderWorkflowTemplate(node.template.template, ctx.state, ctx.resolvedInputs);
    const outputKey = node.template.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "templateOutput";

    console.info("[workflow:template] 模板节点已完成渲染", {
      runId: ctx.runId,
      nodeId: node.id,
      outputKey,
      contentLength: content.length,
    });

    return {
      writes: [{ channelName: outputKey, value: content }],
      outputs: { content },
      durationMs: Date.now() - start,
    };
  }
}
