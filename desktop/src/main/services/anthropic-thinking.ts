import type { ModelProfile, SessionReasoningEffort } from "@shared/contracts";

const ANTHROPIC_THINKING_BUDGET_MAP: Record<SessionReasoningEffort, number> = {
  low: 4096,
  medium: 16384,
  high: 32768,
  xhigh: 65536,
};

/** 判断模型是否为只支持 adaptive thinking 的 Claude Opus 4.7 系列。 */
export function isClaudeOpus47Model(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return lowerModel.includes("claude-opus-4-7");
}

/** 按模型能力构造 Anthropic thinking 字段，避免 Opus 4.7 继续发送旧版 budget_tokens。 */
export function buildAnthropicThinkingPatch(
  profile: Pick<ModelProfile, "model">,
  reasoningEffort: SessionReasoningEffort | undefined,
): Record<string, unknown> {
  if (!reasoningEffort) {
    return {};
  }

  if (isClaudeOpus47Model(profile.model)) {
    return {
      thinking: {
        type: "adaptive",
        // 中文注释：Opus 4.7 默认 omitted；显式 summarized 才会返回可展示的思考摘要。
        display: "summarized",
      },
      output_config: {
        effort: reasoningEffort,
      },
    };
  }

  return {
    thinking: {
      type: "enabled",
      budget_tokens: ANTHROPIC_THINKING_BUDGET_MAP[reasoningEffort],
    },
  };
}
