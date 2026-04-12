import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

function resolveQwenReasoningEffort(
  effort: "low" | "medium" | "high" | "xhigh" | undefined,
): "low" | "medium" | undefined {
  if (!effort) return undefined;
  return effort === "low" ? "low" : "medium";
}

/** Qwen 适配器保守暴露增强字段：能用则用，失败则回退到更稳的兼容请求。 */
export const qwenAdapter: ProviderAdapter = {
  id: "qwen",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const primaryBody = buildOpenAiCompatibleBody(context.profile, input);
    const effort = resolveQwenReasoningEffort(context.reasoningEffort);
    if (effort) {
      primaryBody["reasoning"] = { effort };
    }
    primaryBody["parallel_tool_calls"] = false;
    console.info(`[qwen-adapter] 已生成保守增强请求，reasoningEffort=${effort ?? "none"}。`);

    const fallbackBody = omitBodyKeys(primaryBody, ["reasoning", "parallel_tool_calls"]);
    return [
      createRequestVariant("primary", primaryBody),
      createRequestVariant(
        "compatibility-fallback",
        fallbackBody,
        "qwen_vendor_patch_unsupported",
      ),
    ];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
