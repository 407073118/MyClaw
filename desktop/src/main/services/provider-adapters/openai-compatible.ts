import type { ProviderAdapter, ProviderAdapterMessage } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
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
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content") as ProviderAdapterMessage[];
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
