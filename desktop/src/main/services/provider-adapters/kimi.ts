import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

/** Kimi 兼容路由保留 reasoning breadcrumb，但增强补丁始终要带明确回退。 */
export const kimiAdapter: ProviderAdapter = {
  id: "kimi",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const primaryBody = buildOpenAiCompatibleBody(context.profile, input);
    if (context.reasoningEffort) {
      primaryBody["reasoning"] = { effort: context.reasoningEffort };
    }
    console.info(`[kimi-adapter] 已生成 Kimi 兼容增强请求，reasoningEffort=${context.reasoningEffort ?? "none"}。`);

    const fallbackBody = omitBodyKeys(primaryBody, ["reasoning"]);
    return [
      createRequestVariant("primary", primaryBody),
      createRequestVariant(
        "compatibility-fallback",
        fallbackBody,
        "kimi_vendor_patch_unsupported",
      ),
    ];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
