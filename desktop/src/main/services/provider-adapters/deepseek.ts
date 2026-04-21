import type { ProviderAdapter, ProviderAdapterMessage } from "./base";
import {
  buildOpenAiCompatibleBody,
  cloneReplayMessages,
  createRequestVariant,
  mapAssistantReasoningToReplayField,
  normalizeAdapterResponse,
} from "./base";

/**
 * DeepSeek 适配器。
 * DeepSeek-R1 系列内置推理能力（always-on），不通过 reasoning effort 控制；
 * DeepSeek-V3 不支持推理。两者均使用 `reasoning_content` 字段回传思考内容。
 * 不向请求体注入 reasoning effort，避免触发 400。
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
    const body = buildOpenAiCompatibleBody(context.profile, input);
    console.info("[deepseek-adapter] 已生成 DeepSeek 兼容请求（不注入 reasoning effort）。");
    return [createRequestVariant("primary", body)];
  },

  normalizeResponse(payload) {
    return normalizeAdapterResponse(payload);
  },
};
