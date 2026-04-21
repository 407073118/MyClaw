import type { JsonValue, ModelProfile, TurnExecutionPlan } from "@shared/contracts";

import { callModel } from "../../model-client";
import { canonicalTurnContentToLegacyMessages } from "../canonical-turn-content";
import type { ProtocolDriver } from "./shared";
import { buildCanonicalRequestMessages } from "./shared";

/** 针对 Qwen compatible 路径补齐 vendor-native capability route 到 requestBody。 */
function buildQwenCompatibleCapabilityOverrides(plan: TurnExecutionPlan): Record<string, JsonValue> {
  if (plan.vendorFamily !== "qwen" || plan.protocolTarget !== "openai-chat-compatible") {
    return {};
  }

  const enableSearch = plan.capabilityRoutes?.some((route) =>
    route.routeType === "vendor-native"
    && route.nativeToolName === "enable_search",
  ) ?? false;
  const enableCodeInterpreter = plan.capabilityRoutes?.some((route) =>
    route.routeType === "vendor-native"
    && route.nativeToolName === "enable_code_interpreter",
  ) ?? false;

  return {
    ...(enableSearch ? { enable_search: true } : {}),
    ...(enableCodeInterpreter ? { enable_code_interpreter: true } : {}),
  };
}

/** 为 compatible driver 构造执行期 profile 视图，最小化桥接 Qwen 原生 capability 开关。 */
function buildCompatibleExecutionProfile(
  profile: ModelProfile,
  plan: TurnExecutionPlan,
): ModelProfile {
  const capabilityOverrides = buildQwenCompatibleCapabilityOverrides(plan);
  if (Object.keys(capabilityOverrides).length === 0) {
    return profile;
  }

  console.info(`[openai-chat-compatible-driver] 已桥接 Qwen capability routes -> requestBody: ${Object.keys(capabilityOverrides).join(", ")}`);
  return {
    ...profile,
    requestBody: {
      ...(profile.requestBody ?? {}),
      ...capabilityOverrides,
    },
  };
}

/** OpenAI-compatible 协议驱动：复用当前 transport / adapter 主链。 */
export const openAiChatCompatibleDriver: ProtocolDriver = {
  protocolTarget: "openai-chat-compatible",
  buildRequestBody(input) {
    const executionProfile = buildCompatibleExecutionProfile(input.profile, input.plan);
    return {
      model: executionProfile.model,
      messages: buildCanonicalRequestMessages(input.content),
      tools: input.toolBundle.tools,
      ...(executionProfile.requestBody ?? {}),
    };
  },

  async execute(input) {
    if (input.signal?.aborted) {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";
      throw abortError;
    }

    const executionProfile = buildCompatibleExecutionProfile(input.profile, input.plan);
    const result = await callModel({
      profile: executionProfile,
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
      streamCompleted: result.streamCompleted,
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
