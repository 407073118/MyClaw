import type { JsonValue } from "@shared/contracts";

import type { ProviderAdapter } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

/** 公开 MiniMax 兼容路径需要先清理低价值噪声参数，避免继续表现成纯 generic alias。 */
function sanitizeMiniMaxCompatibleRequestBody(requestBody: Record<string, unknown>): Record<string, unknown> {
  const next = { ...requestBody };
  delete next["presence_penalty"];
  delete next["frequency_penalty"];
  delete next["logit_bias"];
  delete next["function_call"];
  return next;
}

/** 公开 MiniMax adapter 先走兼容主链，但保留独立的参数清洗和回退语义。 */
export const minimaxCompatibleAdapter: ProviderAdapter = {
  id: "minimax",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const profile = {
      ...context.profile,
      requestBody: sanitizeMiniMaxCompatibleRequestBody((context.profile.requestBody ?? {}) as Record<string, unknown>) as Record<string, JsonValue>,
    };
    const primaryBody = buildOpenAiCompatibleBody(profile, input);
    if (context.reasoningEffort) {
      primaryBody["reasoning"] = { effort: context.reasoningEffort };
    }
    console.info("[minimax-compatible-adapter] 已生成公开 MiniMax 兼容请求，并清理噪声参数。");

    const fallbackBody = omitBodyKeys(primaryBody, ["reasoning"]);
    return [
      createRequestVariant("primary", primaryBody),
      createRequestVariant(
        "compatibility-fallback",
        fallbackBody,
        "minimax_vendor_patch_unsupported",
      ),
    ];
  },

  normalizeResponse(payload) {
    const normalized = normalizeAdapterResponse(payload);
    if (!normalized.content || typeof normalized.content !== "string") {
      return normalized;
    }

    let remaining = normalized.content;
    const reasoningParts: string[] = [];

    while (true) {
      const thinkMatch = remaining.match(/^\s*<think>([\s\S]*?)<\/think>\s*/s);
      if (!thinkMatch) {
        break;
      }

      const reasoning = thinkMatch[1]?.trim() ?? "";
      if (reasoning) {
        reasoningParts.push(reasoning);
      }
      remaining = remaining.slice(thinkMatch[0].length);
    }

    if (reasoningParts.length === 0) {
      return normalized;
    }

    return {
      ...normalized,
      reasoning: reasoningParts.join("\n"),
      content: remaining.trim(),
    };
  },
};
