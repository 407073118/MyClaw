import type { ExperienceProfileId, ProtocolTarget, ProviderFamily, WorkflowLlmNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { renderWorkflowTemplate } from "../variable-resolver";

export type ModelCaller = (options: {
  profile: unknown;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
  providerFamily?: ProviderFamily;
  protocolTarget?: ProtocolTarget;
  experienceProfileId?: ExperienceProfileId;
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  signal?: AbortSignal;
  workflowRunId?: string;
}) => Promise<{ content: string; usage?: unknown }>;

export type ModelProfileResolver = (id?: string) => unknown;

export class LlmNodeExecutor implements NodeExecutor {
  readonly kind = "llm" as const;

  constructor(
    private modelCaller: ModelCaller,
    private profileResolver: ModelProfileResolver,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowLlmNode;
    const systemPrompt = node.llm.systemPrompt
      ? renderWorkflowTemplate(node.llm.systemPrompt, ctx.state, ctx.resolvedInputs)
      : "";
    const prompt = renderWorkflowTemplate(node.llm.prompt, ctx.state, ctx.resolvedInputs);
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt.trim()) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    const profileId = (node as any).llm?.model ?? ctx.config.modelProfileId;
    const profile = this.profileResolver(profileId);
    let content = "";
    const result = await this.modelCaller({
      profile,
      messages,
      tools: [],
      providerFamily: node.llm.providerFamily,
      protocolTarget: node.llm.protocolTarget,
      experienceProfileId: node.llm.experienceProfileId,
      onDelta: (delta) => {
        if (delta.content) {
          content += delta.content;
          ctx.emitter.emit({
            type: "node-streaming",
            runId: ctx.runId,
            nodeId: node.id,
            chunk: delta,
          });
        }
      },
      signal: ctx.signal,
      workflowRunId: ctx.runId,
    });
    const resolvedContent = content.length > 0 ? content : result.content;
    const outputKey = node.llm.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "lastLlmOutput";
    return {
      writes: [{ channelName: outputKey, value: resolvedContent }],
      outputs: { content: resolvedContent },
      durationMs: Date.now() - start,
    };
  }

}
