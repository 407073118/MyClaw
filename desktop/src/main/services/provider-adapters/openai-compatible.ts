import type { ProviderAdapter, ProviderAdapterMessage } from "./base";
import {
  buildOpenAiCompatibleBody,
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
} from "./base";

/**
 * 通用 OpenAI 兼容适配器。
 * Kimi / DeepSeek 等支持 thinking 的 API 使用 `reasoning_content`
 * 字段重放推理内容（而非 `reasoning`），此处做字段映射。
 */
export const openAiCompatibleAdapter: ProviderAdapter = {
  id: "openai-compatible",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages).map((msg) => {
      // 仅处理 assistant 消息中携带 reasoning 的情况
      if (msg.role !== "assistant" || !("reasoning" in msg)) return msg;
      // 将内部 reasoning 字段转为 OpenAI 兼容 API 期望的 reasoning_content
      const { reasoning, ...rest } = msg;
      (rest as Record<string, unknown>)["reasoning_content"] = reasoning ?? "";
      return rest as ProviderAdapterMessage;
    });
  },

  prepareRequest(context, input) {
    const body = buildOpenAiCompatibleBody(context.profile, input);
    if (context.reasoningEffort) {
      (body as Record<string, unknown>)["reasoning"] = {
        effort: context.reasoningEffort,
      };
    }
    return [createRequestVariant("primary", body)];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
