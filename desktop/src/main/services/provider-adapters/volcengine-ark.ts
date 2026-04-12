import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

/** 火山方舟适配器先补 Ark 专属增强字段，再回退到更稳的兼容请求。 */
export const volcengineArkAdapter: ProviderAdapter = {
  id: "volcengine-ark",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const primaryBody = buildOpenAiCompatibleBody(context.profile, input);
    if (context.reasoningEffort) {
      primaryBody["reasoning"] = { effort: context.reasoningEffort };
    }
    primaryBody["stream_options"] = { include_usage: true };
    console.info("[volcengine-ark-adapter] 已生成 Ark 增强请求，并准备兼容回退。");

    const fallbackBody = omitBodyKeys(primaryBody, ["stream_options", "reasoning"]);
    return [
      createRequestVariant("primary", primaryBody),
      createRequestVariant(
        "compatibility-fallback",
        fallbackBody,
        "ark_vendor_patch_unsupported",
      ),
    ];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
