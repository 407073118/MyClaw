import type { SessionReasoningEffort } from "@shared/contracts";

import type { ProviderAdapter, ProviderAdapterTool } from "./base";
import {
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
} from "./base";

const ANTHROPIC_THINKING_BUDGET_MAP: Record<SessionReasoningEffort, number> = {
  low: 4096,
  medium: 16384,
  high: 32768,
  xhigh: 65536,
};

/** 把 OpenAI 风格函数工具转换成 Anthropic messages 更友好的 `input_schema` 结构。 */
function normalizeAnthropicTools(tools: ProviderAdapterTool[] | undefined): Array<Record<string, unknown>> {
  return (tools ?? []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

/** Anthropic 原生适配器在 legacy 通路里也尽量输出接近 messages API 的请求形状。 */
export const anthropicNativeAdapter: ProviderAdapter = {
  id: "anthropic-native",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages);
  },

  prepareRequest(context, input) {
    const systemParts = input.messages
      .filter((message) => message.role === "system")
      .map((message) => String(message.content ?? ""))
      .filter((item) => item.trim().length > 0);
    const messages = input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    const body: Record<string, unknown> = {
      model: context.profile.model,
      messages,
      tools: normalizeAnthropicTools(input.tools),
      stream: true,
    };
    if (systemParts.length > 0) {
      body["system"] = systemParts.join("\n\n");
    }
    if (context.reasoningEffort) {
      body["thinking"] = {
        type: "enabled",
        budget_tokens: ANTHROPIC_THINKING_BUDGET_MAP[context.reasoningEffort],
      };
    }
    console.info("[anthropic-native-adapter] 已生成 Anthropic messages 兼容请求体。");
    return [createRequestVariant("primary", body)];
  },

  normalizeResponse(payload) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const contentBlocks = Array.isArray(record.content) ? record.content as Array<Record<string, unknown>> : [];
    const content = contentBlocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    const reasoning = contentBlocks
      .filter((block) => (block.type === "thinking" || block.type === "reasoning") && typeof (block.thinking ?? block.text) === "string")
      .map((block) => String(block.thinking ?? block.text))
      .join("");
    const toolCalls = contentBlocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: typeof block.id === "string" ? block.id : "toolcall-unknown",
        name: typeof block.name === "string" ? block.name : "",
        argumentsJson: JSON.stringify(block.input ?? {}),
        input: block.input && typeof block.input === "object" && !Array.isArray(block.input)
          ? block.input as Record<string, unknown>
          : {},
      }));
    const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;

    return {
      ...(content ? { content } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(typeof record.stop_reason === "string"
        ? { finishReason: record.stop_reason === "tool_use" ? "tool_calls" : record.stop_reason }
        : {}),
      ...(usage ? {
        usage: {
          promptTokens: Number(usage.input_tokens ?? 0),
          completionTokens: Number(usage.output_tokens ?? 0),
          totalTokens: Number((usage.input_tokens ?? 0)) + Number((usage.output_tokens ?? 0)),
        },
      } : {}),
      raw: payload,
    };
  },
};
