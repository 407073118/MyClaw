import {
  BR_MINIMAX_MODEL,
  BR_MINIMAX_REQUEST_BODY,
  readBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";

import type { ProviderAdapter, ProviderAdapterMessage } from "./base";
import {
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
} from "./base";

/** 将带 reasoning 的 MiniMax assistant 消息物化为可重放的 think 内容。 */
function materializeMiniMaxReplayMessage(message: ProviderAdapterMessage): ProviderAdapterMessage {
  if (message.role !== "assistant") return { ...message };

  const content = typeof message.content === "string" ? message.content : null;
  const reasoning = typeof message.reasoning === "string" ? message.reasoning.trim() : "";
  if (!reasoning) return { ...message };

  return {
    ...message,
    content: content && content.trim().length > 0
      ? `<think>${reasoning}</think>\n\n${content}`
      : `<think>${reasoning}</think>`,
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

/** 构建 BR MiniMax 的主请求体，不在这里决定是否需要回退。 */
function buildMiniMaxBody(
  profile: Parameters<ProviderAdapter["prepareRequest"]>[0]["profile"],
  input: Parameters<ProviderAdapter["prepareRequest"]>[1],
): Record<string, unknown> {
  const hasTools = !!(input.tools && input.tools.length > 0);
  const profileRequestBody = sanitizeMiniMaxRequestBody((profile.requestBody ?? {}) as Record<string, unknown>);

  return {
    model: BR_MINIMAX_MODEL,
    messages: input.messages,
    stream: true,
    ...(hasTools ? { tools: input.tools, tool_choice: "auto" } : {}),
    ...BR_MINIMAX_REQUEST_BODY,
    ...profileRequestBody,
    chat_template_kwargs: {
      ...(BR_MINIMAX_REQUEST_BODY.chat_template_kwargs ?? {}),
      ...((profileRequestBody.chat_template_kwargs as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

/** BR MiniMax 适配器负责 replay 物化与 diagnostics 感知的 fallback 形状。 */
export const minimaxAdapter: ProviderAdapter = {
  id: "br-minimax",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages).map((message) => materializeMiniMaxReplayMessage(message));
  },

  prepareRequest(context, input) {
    const mergedBody = buildMiniMaxBody(context.profile, input);
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
