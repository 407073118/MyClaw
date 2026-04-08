import type { WorkflowLlmNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export type ModelCaller = (options: {
  profile: unknown;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  signal?: AbortSignal;
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
    const prompt = this.resolvePrompt(node.llm.prompt, ctx.state);
    const messages: Array<{ role: string; content: string }> = [
      { role: "user", content: prompt },
    ];
    const profileId = (node as any).llm?.model ?? ctx.config.modelProfileId;
    const profile = this.profileResolver(profileId);
    let content = "";
    await this.modelCaller({
      profile,
      messages,
      tools: [],
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
    });
    const outputKey = node.llm.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "lastLlmOutput";
    return {
      writes: [{ channelName: outputKey, value: content }],
      outputs: { content },
      durationMs: Date.now() - start,
    };
  }

  private resolvePrompt(template: string, state: ReadonlyMap<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const val = state.get(key);
      if (val === undefined || val === null) return "";
      return typeof val === "string" ? val : JSON.stringify(val);
    });
  }
}
