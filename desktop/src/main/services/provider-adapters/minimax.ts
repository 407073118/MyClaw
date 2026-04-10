import type { SessionReasoningEffort } from "@shared/contracts";
import {
  BR_MINIMAX_MODEL,
  BR_MINIMAX_REQUEST_BODY,
  readBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";

import type { ProviderAdapter, ProviderAdapterContext, ProviderAdapterMessage } from "./base";
import {
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
} from "./base";

/** 将 reasoningEffort 等级映射为 thinking_budget token 数。 */
const THINKING_BUDGET_MAP: Record<SessionReasoningEffort, number> = {
  low: 2048,
  medium: 8192,
  high: 32768,
};

/**
 * 将 MiniMax assistant 消息物化为可重放的 think 内容。
 * 当 thinking 开启时，MiniMax 要求所有 assistant 消息都带 <think> 标签，
 * 即使 reasoning 为空也必须包含 <think></think>，否则 API 返回 400。
 */
function materializeMiniMaxReplayMessage(message: ProviderAdapterMessage): ProviderAdapterMessage {
  if (message.role !== "assistant") return { ...message };

  let content: string | null = null;
  if (typeof message.content === "string") {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    // 多模态数组：提取文本部分拼接（assistant 重放场景下图片信息无法嵌入 <think> 格式）
    const textParts = (message.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!);
    if (textParts.length > 0) {
      content = textParts.join("\n");
    }
  }
  const reasoning = typeof message.reasoning === "string" ? message.reasoning.trim() : "";

  const thinkTag = reasoning ? `<think>${reasoning}</think>` : `<think></think>`;
  return {
    ...message,
    content: content && content.trim().length > 0
      ? `${thinkTag}\n\n${content}`
      : thinkTag,
    reasoning: undefined,
  };
}

/** 清理 MiniMax 当前已知不稳定或低价值的通用参数，复用既有受管默认。 */
function sanitizeMiniMaxRequestBody(requestBody: Record<string, unknown>): Record<string, unknown> {
  const next = { ...requestBody };
  delete next["presence_penalty"];
  delete next["frequency_penalty"];
  delete next["logit_bias"];
  delete next["function_call"];
  return next;
}

/** 构建 BR MiniMax 的主请求体，根据 reasoningEffort 设置 thinking_budget。 */
function buildMiniMaxBody(
  context: ProviderAdapterContext,
  input: Parameters<ProviderAdapter["prepareRequest"]>[1],
): Record<string, unknown> {
  const { profile, reasoningEffort } = context;
  const hasTools = !!(input.tools && input.tools.length > 0);
  const profileRequestBody = sanitizeMiniMaxRequestBody((profile.requestBody ?? {}) as Record<string, unknown>);
  const effort = reasoningEffort ?? "medium";
  const thinkingBudget = THINKING_BUDGET_MAP[effort] ?? THINKING_BUDGET_MAP.medium;

  const body = {
    model: BR_MINIMAX_MODEL,
    messages: input.messages,
    stream: true,
    ...(hasTools ? { tools: input.tools, tool_choice: "auto" } : {}),
    ...BR_MINIMAX_REQUEST_BODY,
    ...profileRequestBody,
    chat_template_kwargs: {
      ...(BR_MINIMAX_REQUEST_BODY.chat_template_kwargs ?? {}),
      ...((profileRequestBody.chat_template_kwargs as Record<string, unknown> | undefined) ?? {}),
      thinking_budget: thinkingBudget,
    },
  };
  console.info(`[minimax-adapter] effort=${effort} thinking_budget=${thinkingBudget} tools=${hasTools ? input.tools!.length : 0}`);
  return body;
}

/** BR MiniMax 适配器负责 replay 物化与 diagnostics 感知的 fallback 形状。 */
export const minimaxAdapter: ProviderAdapter = {
  id: "br-minimax",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages).map((message) => materializeMiniMaxReplayMessage(message));
  },

  prepareRequest(context, input) {
    const mergedBody = buildMiniMaxBody(context, input);
    const diagnostics = readBrMiniMaxRuntimeDiagnostics(context.profile);

    if (diagnostics.reasoningSplitSupported === true) {
      return [createRequestVariant("primary", {
        ...mergedBody,
        reasoning_split: true,
      })];
    }

    if (diagnostics.reasoningSplitSupported === false) {
      return [createRequestVariant(
        "compatibility-fallback",
        mergedBody,
        "reasoning_split_unsupported",
      )];
    }

    return [
      createRequestVariant("primary", {
        ...mergedBody,
        reasoning_split: true,
      }),
      createRequestVariant(
        "compatibility-fallback",
        mergedBody,
        "reasoning_split_unsupported",
      ),
    ];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
