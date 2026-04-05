import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
} from "./base";

/** 通用 OpenAI 兼容适配器在 Phase 1 仅负责请求组装与重放透传。 */
export const openAiCompatibleAdapter: ProviderAdapter = {
  id: "openai-compatible",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages);
  },

  prepareRequest(context, input) {
    return [createRequestVariant("primary", buildOpenAiCompatibleBody(context.profile, input))];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
