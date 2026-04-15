import type { ProviderAdapter, ProviderAdapterContext } from "./base";
import {
  buildOpenAiCompatibleBody,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
  omitBodyKeys,
} from "./base";

type KimiThinkingType = "enabled" | "disabled";

/** 统一识别 Moonshot/Kimi 模型的 thinking 控制模式，优先相信能力注册表。 */
function resolveKimiThinkingControlKind(context: ProviderAdapterContext): string {
  const capabilityKind = context.profile.discoveredCapabilities?.thinkingControlKind;
  if (capabilityKind) {
    return capabilityKind;
  }

  const lowerModel = context.profile.model.toLowerCase();
  if (lowerModel.startsWith("kimi-k2-thinking") || lowerModel.startsWith("k2-thinking")) {
    return "always_on";
  }
  if (lowerModel.startsWith("kimi-k2.5") || lowerModel.startsWith("k2.5")) {
    return "boolean";
  }
  return "boolean";
}

/** Kimi K2.5 系列存在固定采样参数约束，需要在适配层提前剔除。 */
function shouldStripFixedSamplingParams(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("kimi-k2.5") || lowerModel.startsWith("k2.5");
}

/** 解析本轮是否应该显式开启 Kimi thinking。 */
function resolveKimiThinkingType(context: ProviderAdapterContext): KimiThinkingType {
  const controlKind = resolveKimiThinkingControlKind(context);
  if (controlKind === "always_on") {
    return "enabled";
  }

  if (context.reasoningEnabled === false) {
    return "disabled";
  }

  if (context.reasoningEnabled === true) {
    return "enabled";
  }

  return context.reasoningEffort ? "enabled" : "enabled";
}

/** 在 thinking 开启时，只允许 auto/none，避免 Moonshot 直接拒绝请求。 */
function normalizeKimiToolChoice(body: Record<string, unknown>, hasTools: boolean, thinkingType: KimiThinkingType): void {
  if (!hasTools) {
    delete body["tool_choice"];
    return;
  }

  if (thinkingType !== "enabled") {
    if (body["tool_choice"] === undefined) {
      body["tool_choice"] = "auto";
    }
    return;
  }

  const currentValue = body["tool_choice"];
  if (currentValue !== "auto" && currentValue !== "none") {
    body["tool_choice"] = "auto";
  }
}

/** 清理 K2.5 不接受的固定采样参数，避免主请求因为历史兼容字段被拒绝。 */
function stripKimiFixedSamplingParams(body: Record<string, unknown>, model: string): void {
  if (!shouldStripFixedSamplingParams(model)) {
    return;
  }

  delete body["temperature"];
  delete body["top_p"];
  delete body["presence_penalty"];
  delete body["frequency_penalty"];
  delete body["n"];
}

/** Moonshot 原生 thinking + reasoning_content 回放适配。 */
export const kimiAdapter: ProviderAdapter = {
  id: "kimi",

  materializeReplayMessages(_context, input) {
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const primaryBody = buildOpenAiCompatibleBody(context.profile, input);
    const thinkingControlKind = resolveKimiThinkingControlKind(context);
    const thinkingType = resolveKimiThinkingType(context);
    const hasTools = !!(input.tools && input.tools.length > 0);

    primaryBody["thinking"] = { type: thinkingType };
    normalizeKimiToolChoice(primaryBody, hasTools, thinkingType);
    stripKimiFixedSamplingParams(primaryBody, context.profile.model);

    if (thinkingControlKind === "always_on" && thinkingType === "disabled") {
      primaryBody["thinking"] = { type: "enabled" };
      console.info(`[kimi-adapter] ${context.profile.model} 为 always_on thinking，已忽略关闭请求并保持开启。`);
    }

    console.info(
      `[kimi-adapter] 已生成 Moonshot 原生请求，thinking=${String((primaryBody["thinking"] as { type: string }).type)}，reasoningEnabled=${context.reasoningEnabled ?? "auto"}，tools=${hasTools ? "on" : "off"}`,
    );

    const fallbackBody = omitBodyKeys(primaryBody, [
      "thinking",
      "parallel_tool_calls",
    ]);
    if (hasTools) {
      fallbackBody["tool_choice"] = "auto";
    }

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
