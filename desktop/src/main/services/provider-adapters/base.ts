import type { ModelProfile, SessionReasoningEffort } from "@shared/contracts";

export type ProviderAdapterId =
  | "openai-compatible"
  | "openai-native"
  | "anthropic-native"
  | "qwen"
  | "kimi"
  | "deepseek"
  | "volcengine-ark"
  | "minimax"
  | "br-minimax";

export type ProviderAdapterTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ProviderAdapterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ProviderAdapterContext = {
  profile: ModelProfile;
  reasoningEnabled?: boolean;
  reasoningEffort?: SessionReasoningEffort;
};

export type ProviderAdapterRequestInput = {
  messages: ProviderAdapterMessage[];
  tools?: ProviderAdapterTool[];
};

export type ProviderAdapterFallbackReason =
  | "reasoning_split_unsupported"
  | "openai_native_vendor_patch_unsupported"
  | "qwen_vendor_patch_unsupported"
  | "kimi_vendor_patch_unsupported"
  | "ark_vendor_patch_unsupported"
  | "minimax_vendor_patch_unsupported"
  | null;

export type ProviderAdapterRequestVariant = {
  id: "primary" | "compatibility-fallback";
  fallbackReason: ProviderAdapterFallbackReason;
  body: Record<string, unknown>;
};

export type ProviderAdapterNormalizedResponse = {
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    argumentsJson: string;
    input: Record<string, unknown>;
  }>;
  finishReason?: string | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  raw?: unknown;
};

export interface ProviderAdapter {
  id: ProviderAdapterId;
  materializeReplayMessages(
    context: ProviderAdapterContext,
    input: ProviderAdapterRequestInput,
  ): ProviderAdapterMessage[];
  prepareRequest(
    context: ProviderAdapterContext,
    input: ProviderAdapterRequestInput,
  ): ProviderAdapterRequestVariant[];
  normalizeResponse(payload: unknown): ProviderAdapterNormalizedResponse;
}

/** 生成稳定的请求变体结构，统一主请求与回退请求的描述方式。 */
export function createRequestVariant(
  id: ProviderAdapterRequestVariant["id"],
  body: Record<string, unknown>,
  fallbackReason: ProviderAdapterFallbackReason = null,
): ProviderAdapterRequestVariant {
  return {
    id,
    fallbackReason,
    body,
  };
}

/** 对重放消息做浅拷贝，避免适配器在原数组上产生副作用。 */
export function cloneReplayMessages(messages: ProviderAdapterMessage[]): ProviderAdapterMessage[] {
  return messages.map((message) => ({
    ...message,
    tool_calls: message.tool_calls?.map((toolCall) => ({
      ...toolCall,
      function: { ...toolCall.function },
    })),
  }));
}

/** 将 assistant reasoning 映射到指定字段，便于不同兼容协议保持统一重放语义。 */
export function mapAssistantReasoningToReplayField(
  messages: ProviderAdapterMessage[],
  fieldName: string,
): ProviderAdapterMessage[] {
  return cloneReplayMessages(messages).map((message) => {
    if (message.role !== "assistant" || !("reasoning" in message)) {
      return message;
    }

    const { reasoning, ...rest } = message;
    (rest as Record<string, unknown>)[fieldName] = reasoning ?? "";
    return rest as ProviderAdapterMessage;
  });
}

/** 为标准 OpenAI 兼容请求补齐通用字段。 */
export function buildOpenAiCompatibleBody(
  profile: ModelProfile,
  input: ProviderAdapterRequestInput,
): Record<string, unknown> {
  const hasTools = !!(input.tools && input.tools.length > 0);
  return {
    model: profile.model,
    messages: input.messages,
    stream: true,
    ...(hasTools ? { tools: input.tools, tool_choice: "auto" } : {}),
    ...(profile.requestBody ?? {}),
  };
}

/** 构造一个去掉指定字段的回退请求体，避免兼容路径继续带上高风险补丁。 */
export function omitBodyKeys(
  body: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const next = { ...body };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

/** 默认响应归一化仅保留原始负载，供 Phase 1 传输层后续接入。 */
export function normalizeAdapterResponse(payload: unknown): ProviderAdapterNormalizedResponse {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const extractTextLike = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const entry = part as Record<string, unknown>;
            if (typeof entry.text === "string") return entry.text;
            if (typeof entry.thinking === "string") return entry.thinking;
          }
          return "";
        })
        .join("");
    }
    if (value && typeof value === "object") {
      const entry = value as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text;
      if (typeof entry.thinking === "string") return entry.thinking;
    }
    return undefined;
  };

  const outputItems = Array.isArray(record.output) ? record.output as Array<Record<string, unknown>> : [];
  const outputMessage = outputItems.find((item) => item.type === "message");
  const choices = Array.isArray(record.choices) ? record.choices as Array<Record<string, unknown>> : [];
  const firstChoice = choices[0];
  const message = firstChoice?.message && typeof firstChoice.message === "object"
    ? firstChoice.message as Record<string, unknown>
    : outputMessage && typeof outputMessage === "object"
      ? outputMessage
      : null;
  const content = typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content
        .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
        .map((part) => {
          if (part.type === "output_text" && typeof part.text === "string") return part.text;
          if (part.type === "text" && typeof part.text === "string") return part.text;
          return "";
        })
        .join("")
      : typeof record.output_text === "string"
        ? record.output_text
        : undefined;
  const reasoningFromReasoningContent = extractTextLike(message?.reasoning_content);
  const reasoning = reasoningFromReasoningContent
    ?? (Array.isArray(message?.reasoning_details)
      ? message.reasoning_details
        .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
        .map((part) => typeof part.text === "string" ? part.text : "")
        .join("")
      : Array.isArray(message?.content)
        ? message.content
          .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
          .map((part) => {
            if (part.type === "reasoning") {
              return extractTextLike(part.text ?? part.summary) ?? "";
            }
            return "";
          })
          .join("")
        : undefined);
  const toolCallsFromMessage = Array.isArray(message?.tool_calls)
    ? message.tool_calls
      .filter((toolCall): toolCall is Record<string, unknown> => !!toolCall && typeof toolCall === "object")
      .map((toolCall) => {
        const fn = toolCall.function && typeof toolCall.function === "object"
          ? toolCall.function as Record<string, unknown>
          : {};
        const argumentsJson = typeof fn.arguments === "string" ? fn.arguments : "{}";
        let input: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(argumentsJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
        return {
          id: typeof toolCall.id === "string" ? toolCall.id : "toolcall-unknown",
          name: typeof fn.name === "string" ? fn.name : "",
          argumentsJson,
          input,
        };
      })
    : undefined;
  const toolCallsFromLegacyFunctionCall = message?.function_call && typeof message.function_call === "object"
    ? (() => {
        const fn = message.function_call as Record<string, unknown>;
        const argumentsJson = typeof fn.arguments === "string" ? fn.arguments : "{}";
        let input: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(argumentsJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
        return [{
          id: "toolcall-legacy-function",
          name: typeof fn.name === "string" ? fn.name : "",
          argumentsJson,
          input,
        }];
      })()
    : undefined;
  const toolCallsFromOutput = outputItems.length > 0
    ? outputItems
      .filter((item) => item.type === "function_call")
      .map((item) => {
        const argumentsJson = typeof item.arguments === "string" ? item.arguments : "{}";
        let input: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(argumentsJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
        return {
          id: typeof item.call_id === "string"
            ? item.call_id
            : typeof item.id === "string"
              ? item.id
              : "toolcall-unknown",
          name: typeof item.name === "string" ? item.name : "",
          argumentsJson,
          input,
        };
      })
    : undefined;
  const toolCalls = toolCallsFromMessage ?? toolCallsFromLegacyFunctionCall ?? toolCallsFromOutput;
  const usage = record.usage && typeof record.usage === "object"
    ? record.usage as Record<string, unknown>
    : null;

  return {
    ...(content ? { content } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(typeof firstChoice?.finish_reason === "string"
      ? { finishReason: firstChoice.finish_reason === "function_call" ? "tool_calls" : firstChoice.finish_reason }
      : toolCalls && toolCalls.length > 0
        ? { finishReason: "tool_calls" }
        : typeof record.stop_reason === "string"
          ? { finishReason: record.stop_reason === "tool_use" ? "tool_calls" : record.stop_reason }
          : {}),
    ...(usage ? {
      usage: {
        promptTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
        completionTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? ((Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)) + (Number(usage.completion_tokens ?? usage.output_tokens ?? 0)))),
      },
    } : {}),
    raw: payload,
  };
}

/** 基于现有适配器创建一个仅替换 id 的别名适配器，便于逐步把厂商接入统一 adapter 入口。 */
export function aliasProviderAdapter(
  id: ProviderAdapterId,
  baseAdapter: ProviderAdapter,
): ProviderAdapter {
  return {
    ...baseAdapter,
    id,
  };
}
