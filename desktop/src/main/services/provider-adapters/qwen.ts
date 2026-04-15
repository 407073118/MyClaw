import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

/** 将通用推理档位映射到 Qwen 兼容路由允许的档位。 */
function resolveQwenReasoningEffort(
  effort: "low" | "medium" | "high" | "xhigh" | undefined,
): "low" | "medium" | undefined {
  if (!effort) return undefined;
  const mapped = effort === "low" ? "low" : "medium";
  if (effort !== mapped) {
    console.info(`[qwen-adapter] Qwen 推理等级截断: ${effort} -> ${mapped}（Qwen API 仅支持 low/medium）`);
  }
  return mapped;
}

/** Qwen coder 系列当前不支持显式 thinking 控制。 */
function supportsQwenThinking(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return lowerModel !== "qwen3-coder-plus" && lowerModel !== "qwen3-coder-next";
}

/** `preserve_thinking` 当前仅在 qwen3.6-plus 系列聊天兼容路由上开放。 */
function supportsQwenPreserveThinking(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return lowerModel === "qwen3.6-plus" || lowerModel === "qwen3.6-plus-2026-04-02";
}

/** 将通用 effort 映射为 Qwen 的 `thinking_budget`。 */
function resolveQwenThinkingBudget(
  effort: "low" | "medium" | "high" | "xhigh" | undefined,
): number | undefined {
  switch (effort) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    case "xhigh":
      return 16384;
    default:
      return undefined;
  }
}

/** Qwen 兼容适配器优先使用官方字段，并保留一个去 vendor patch 的回退变体。 */
export const qwenAdapter: ProviderAdapter = {
  id: "qwen",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const primaryBody = buildOpenAiCompatibleBody(context.profile, input);
    const effort = resolveQwenReasoningEffort(context.reasoningEffort);
    const thinkingBudget = resolveQwenThinkingBudget(context.reasoningEffort);
    const thinkingEnabled = supportsQwenThinking(context.profile.model) && !!thinkingBudget;

    if (primaryBody["preserve_thinking"] !== undefined && !supportsQwenPreserveThinking(context.profile.model)) {
      delete primaryBody["preserve_thinking"];
      console.info(`[qwen-adapter] 当前模型不支持 preserve_thinking，已忽略: ${context.profile.model}`);
    }

    if (thinkingEnabled) {
      primaryBody["enable_thinking"] = true;
      primaryBody["thinking_budget"] = thinkingBudget;
      // Qwen thinking 模式下不允许强制 tool_choice。
      delete primaryBody["tool_choice"];
    } else if (context.reasoningEffort && !supportsQwenThinking(context.profile.model)) {
      console.info(`[qwen-adapter] 当前模型不支持 thinking 控制，已忽略: ${context.profile.model}`);
    }

    if (input.tools && input.tools.length > 0) {
      primaryBody["parallel_tool_calls"] = true;
    }

    console.info(
      `[qwen-adapter] 已生成 Qwen 官方请求，reasoningEffort=${effort ?? "none"}，thinking=${thinkingEnabled ? "on" : "off"}，tools=${input.tools?.length ?? 0}`,
    );

    const fallbackBody = omitBodyKeys(primaryBody, [
      "enable_thinking",
      "thinking_budget",
      "enable_search",
      "search_options",
      "enable_code_interpreter",
      "preserve_thinking",
      "parallel_tool_calls",
    ]);
    if (input.tools && input.tools.length > 0) {
      fallbackBody["tool_choice"] = "auto";
    }

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
