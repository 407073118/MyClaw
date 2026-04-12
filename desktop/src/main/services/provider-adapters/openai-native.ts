import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

/** OpenAI 原生适配器在兼容请求里补齐更贴近 OpenAI 的增强字段，并保留兼容回退。 */
export const openAiNativeAdapter: ProviderAdapter = {
  id: "openai-native",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages);
  },

  prepareRequest(context, input) {
    const primaryBody = buildOpenAiCompatibleBody(context.profile, input);
    if (context.reasoningEffort) {
      primaryBody["reasoning"] = { effort: context.reasoningEffort };
    }
    primaryBody["parallel_tool_calls"] = false;
    primaryBody["stream_options"] = { include_usage: true };
    console.info("[openai-native-adapter] 已生成 OpenAI 原生增强请求，并附带兼容回退。");

    const fallbackBody = omitBodyKeys(primaryBody, ["parallel_tool_calls", "stream_options"]);
    return [
      createRequestVariant("primary", primaryBody),
      createRequestVariant(
        "compatibility-fallback",
        fallbackBody,
        "openai_native_vendor_patch_unsupported",
      ),
    ];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
