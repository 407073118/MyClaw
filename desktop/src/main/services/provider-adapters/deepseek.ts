import type { ProviderAdapter, ProviderAdapterContext, ProviderAdapterMessage } from "./base";
import {
  buildOpenAiCompatibleBody,
  cloneReplayMessages,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
} from "./base";

/**
 * DeepSeek 适配器。
 * DeepSeek V4 支持 thinking 开关与 high/max reasoning effort；
 * 旧版 deepseek-reasoner 仍按兼容路径处理，避免历史行为回归。
 *
 * 重放分支策略：
 * - DeepSeek-Reasoner 不允许在输入消息中携带 reasoning_content（官方文档明确返回 400），
 *   且不支持 function calling，所以重放阶段需剥离 assistant.reasoning，避免历史推理被回传。
 * - DeepSeek-Chat / DeepSeek-V3.2 thinking + tool_calls 多轮中仍要求历史 assistant
 *   携带 reasoning_content，沿用 base helper（空内容时由 helper 自行省略字段）。
 */
function isDeepSeekReasonerModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower === "deepseek-reasoner" || lower.startsWith("deepseek-reasoner-");
}

/** 判断当前模型是否为 DeepSeek V4 官方模型，只有该分支注入 V4 thinking 控制字段。 */
function isDeepSeekV4Model(model: string): boolean {
  return /^deepseek-v4-(pro|flash)(?:$|[-_:.])/i.test(model ?? "");
}

/** 将本地 effort 档位映射为 DeepSeek V4 官方支持的 high/max。 */
function mapDeepSeekV4ReasoningEffort(effort: ProviderAdapterContext["reasoningEffort"]): "high" | "max" {
  return effort === "xhigh" ? "max" : "high";
}

/** 读取用户自定义 requestBody 中的 thinking.type，用于避免覆盖显式开关。 */
function readThinkingType(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return null;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

/** 为 DeepSeek V4 请求补齐 thinking 控制，用户 requestBody 的显式字段优先。 */
function applyDeepSeekV4ThinkingControl(
  context: ProviderAdapterContext,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!isDeepSeekV4Model(context.profile.model)) {
    return body;
  }

  const hasThinkingOverride = Object.prototype.hasOwnProperty.call(body, "thinking");
  const hasEffortOverride = Object.prototype.hasOwnProperty.call(body, "reasoning_effort");
  const explicitThinkingType = hasThinkingOverride ? readThinkingType(body.thinking) : null;
  const shouldDisableThinking = explicitThinkingType === "disabled" || (!hasThinkingOverride && context.reasoningEnabled === false);
  const patch: Record<string, unknown> = {};

  if (!hasThinkingOverride) {
    patch.thinking = { type: shouldDisableThinking ? "disabled" : "enabled" };
  }
  if (!shouldDisableThinking && !hasEffortOverride) {
    patch.reasoning_effort = mapDeepSeekV4ReasoningEffort(context.reasoningEffort);
  }

  console.info(
    `[deepseek-adapter] 已应用 DeepSeek V4 thinking 控制：model=${context.profile.model}, thinking=${hasThinkingOverride ? "requestBody" : (shouldDisableThinking ? "disabled" : "enabled")}, effort=${hasEffortOverride || shouldDisableThinking ? "requestBody/none" : patch.reasoning_effort}`,
  );
  return { ...body, ...patch };
}

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",

  materializeReplayMessages(context, input) {
    if (isDeepSeekReasonerModel(context.profile.model)) {
      console.info(
        `[deepseek-adapter] 检测到 deepseek-reasoner 模型，已剥离历史 assistant.reasoning，避免输入 reasoning_content 触发 400: ${context.profile.model}`,
      );
      return cloneReplayMessages(input.messages).map((message) => {
        if (message.role !== "assistant" || !("reasoning" in message)) {
          return message;
        }
        const { reasoning: _omitted, ...rest } = message;
        void _omitted;
        return rest as ProviderAdapterMessage;
      });
    }
    // 其他 DeepSeek 模型（deepseek-chat / deepseek-v3.2*）在 thinking + tool_calls 多轮中
    // 仍要求历史 assistant 携带 reasoning_content；当本地无内容时由 base helper 自行省略。
    return mapAssistantReasoningToReplayField(input.messages, "reasoning_content");
  },

  prepareRequest(context, input) {
    const body = applyDeepSeekV4ThinkingControl(
      context,
      buildOpenAiCompatibleBody(context.profile, input),
    );
    console.info("[deepseek-adapter] 已生成 DeepSeek 兼容请求。");
    return [createRequestVariant("primary", body)];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
