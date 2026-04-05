import type { ModelProfile } from "@shared/contracts";

export type ProviderAdapterId = "br-minimax" | "openai-compatible";

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
};

export type ProviderAdapterRequestInput = {
  messages: ProviderAdapterMessage[];
  tools?: ProviderAdapterTool[];
};

export type ProviderAdapterFallbackReason = "reasoning_split_unsupported" | null;

export type ProviderAdapterRequestVariant = {
  id: "primary" | "compatibility-fallback";
  fallbackReason: ProviderAdapterFallbackReason;
  body: Record<string, unknown>;
};

export type ProviderAdapterNormalizedResponse = {
  content?: string;
  reasoning?: string;
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

/** 默认响应归一化仅保留原始负载，供 Phase 1 传输层后续接入。 */
export function normalizeAdapterResponse(payload: unknown): ProviderAdapterNormalizedResponse {
  return { raw: payload };
}
