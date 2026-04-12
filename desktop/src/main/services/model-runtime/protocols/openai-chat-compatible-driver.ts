import { callModel } from "../../model-client";
import { canonicalTurnContentToLegacyMessages } from "../canonical-turn-content";
import type { ProtocolDriver } from "./shared";
import { buildCanonicalRequestMessages } from "./shared";

/** OpenAI-compatible 协议驱动：复用当前 transport / adapter 主链。 */
export const openAiChatCompatibleDriver: ProtocolDriver = {
  protocolTarget: "openai-chat-compatible",
  buildRequestBody(input) {
    return {
      model: input.profile.model,
      messages: buildCanonicalRequestMessages(input.content),
      tools: input.toolBundle.tools,
    };
  },

  async execute(input) {
    if (input.signal?.aborted) {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";
      throw abortError;
    }
    const result = await callModel({
      profile: input.profile,
      messages: canonicalTurnContentToLegacyMessages(input.content),
      tools: input.toolBundle.tools as never,
      executionPlan: input.plan.legacyExecutionPlan as never,
      signal: input.signal,
      onDelta: input.onDelta,
      onToolCallDelta: input.onToolCallDelta,
    });
    return {
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      usage: result.usage,
      requestVariantId: result.transport?.requestVariantId ?? "primary",
      fallbackReason: result.transport?.fallbackReason ?? null,
      retryCount: result.transport?.retryCount ?? 0,
      fallbackEvents: result.transport?.fallbackEvents ?? [],
    };
  },
};

/** 兼容单元测试的便捷入口。 */
export async function executeOpenAiChatCompatibleTurn(
  input: Parameters<typeof openAiChatCompatibleDriver.execute>[0],
) {
  return openAiChatCompatibleDriver.execute(input);
}
