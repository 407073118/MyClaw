import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
} from "./base";

/**
 * DeepSeek 适配器。
 * DeepSeek-R1 系列内置推理能力（always-on），不通过 reasoning effort 控制；
 * DeepSeek-V3 不支持推理。两者均使用 `reasoning_content` 字段回传思考内容。
 * 不向请求体注入 reasoning effort，避免触发 400。
 */
export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const body = buildOpenAiCompatibleBody(context.profile, input);
    console.info("[deepseek-adapter] 已生成 DeepSeek 兼容请求（不注入 reasoning effort）。");
    return [createRequestVariant("primary", body)];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
