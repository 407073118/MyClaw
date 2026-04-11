import { buildRequestHeaders, callModel } from "../../model-client";
import { executeRequestVariants } from "../../model-transport";
import { canonicalTurnContentToLegacyMessages } from "../canonical-turn-content";
import type { ProtocolDriver, ProtocolExecutionOutput } from "./shared";
import { buildCanonicalRequestMessages, buildLegacyShimTransportMetadata } from "./shared";

type ResponsesToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

type ResponsesStreamState = {
  contentParts: string[];
  reasoningParts: string[];
  toolCalls: Map<string, ResponsesToolCallAccumulator>;
  activeToolCallId: string | null;
  finishReason: string | null;
  usage: ProtocolExecutionOutput["usage"];
};

/** 读取 Responses API 时，先去掉用户可能误带的接口后缀。 */
function stripEndpointSuffixes(url: string): string {
  return url
    .replace(/\/(chat\/completions|responses|messages)$/i, "")
    .replace(/\/(compatible-mode\/v1|v1)$/i, "")
    .replace(/\/+$/, "");
}

/** 解析 OpenAI Responses API 地址，兼容 manual / provider-root 两种 baseUrl 语义。 */
function resolveResponsesApiUrl(profile: { baseUrl: string }): string {
  return `${stripEndpointSuffixes(profile.baseUrl)}/v1/responses`;
}

/** 将文本或多模态内容转成 Responses API 可接受的输入块。 */
function normalizeResponsesContent(content: unknown): unknown {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }

  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((part) => {
    if (!part || typeof part !== "object") {
      return part;
    }

    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return { type: "input_text", text: record.text };
    }

    return record;
  });
}

/** 将 canonical request messages 转成 Responses API 的 instructions + input 形状。 */
function buildResponsesInput(messages: Array<{ role: string; content: unknown }>): {
  instructions?: string;
  input: Array<Record<string, unknown>>;
} {
  const instructions: string[] = [];
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") {
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      if (content.trim()) {
        instructions.push(content);
      }
      continue;
    }

    input.push({
      role: message.role,
      content: normalizeResponsesContent(message.content),
    });
  }

  return {
    ...(instructions.length > 0 ? { instructions: instructions.join("\n\n") } : {}),
    input,
  };
}

/** 将 openai-compatible 风格工具定义转换为 Responses API 所需的函数工具格式。 */
function normalizeResponsesTools(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") {
      return tool;
    }

    const record = tool as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object"
      ? record.function as Record<string, unknown>
      : null;

    if (!fn) {
      return record;
    }

    return {
      type: "function",
      name: typeof fn.name === "string" ? fn.name : "",
      description: typeof fn.description === "string" ? fn.description : "",
      parameters: fn.parameters ?? {},
    };
  });
}

/** 生成 OpenAI Responses 请求体，供 gateway requestShape 与直连执行共同复用。 */
export function buildOpenAiResponsesRequestBody(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  tools: unknown[],
  reasoningEffort?: "low" | "medium" | "high" | "xhigh",
): Record<string, unknown> {
  const { instructions, input } = buildResponsesInput(messages);
  return {
    model,
    input,
    tools: normalizeResponsesTools(tools),
    stream: true,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

/** 把 tool call 累积状态物化为共享协议输出。 */
function materializeToolCalls(toolCalls: Map<string, ResponsesToolCallAccumulator>): ProtocolExecutionOutput["toolCalls"] {
  return [...toolCalls.values()].map((toolCall) => {
    const argumentsJson = toolCall.argumentsJson.trim() || "{}";
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
      id: toolCall.id,
      name: toolCall.name,
      argumentsJson,
      input,
    };
  });
}

/** 处理单个 Responses SSE 事件，保持 content / reasoning / tool call 组装稳定。 */
function applyResponsesEvent(
  event: string,
  data: unknown,
  state: ResponsesStreamState,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): void {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};

  if (event === "response.output_text.delta" || event === "response.content_part.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (delta) {
      state.contentParts.push(delta);
      onDelta?.({ content: delta });
    }
    return;
  }

  if (event === "response.reasoning_summary_text.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (delta) {
      state.reasoningParts.push(delta);
      onDelta?.({ reasoning: delta });
    }
    return;
  }

  if (event === "response.output_item.added" && payload.type === "function_call") {
    const callId = typeof payload.call_id === "string"
      ? payload.call_id
      : typeof payload.id === "string"
        ? payload.id
        : "";
    if (!callId) {
      return;
    }

    state.toolCalls.set(callId, {
      id: callId,
      name: typeof payload.name === "string" ? payload.name : "",
      argumentsJson: typeof payload.arguments === "string" ? payload.arguments : "",
    });
    state.activeToolCallId = callId;
    return;
  }

  if (event === "response.function_call_arguments.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    const callId = typeof payload.call_id === "string"
      ? payload.call_id
      : typeof payload.item_id === "string"
        ? payload.item_id
        : state.activeToolCallId;
    if (!callId || !delta) {
      return;
    }

    const existing = state.toolCalls.get(callId);
    if (!existing) {
      return;
    }

    existing.argumentsJson += delta;
    onToolCallDelta?.({
      toolCallId: existing.id,
      name: existing.name,
      argumentsDelta: delta,
    });
    return;
  }

  if (event === "response.output_item.done" && payload.type === "function_call") {
    const callId = typeof payload.call_id === "string" ? payload.call_id : state.activeToolCallId;
    if (!callId) {
      return;
    }
    const existing = state.toolCalls.get(callId);
    if (!existing) {
      return;
    }
    if (typeof payload.arguments === "string" && payload.arguments.trim()) {
      existing.argumentsJson = payload.arguments;
    }
    state.activeToolCallId = null;
    return;
  }

  if (event === "response.completed") {
    const usage = payload.usage && typeof payload.usage === "object"
      ? payload.usage as Record<string, unknown>
      : payload.response && typeof payload.response === "object"
        && (payload.response as Record<string, unknown>).usage
          && typeof (payload.response as Record<string, unknown>).usage === "object"
        ? (payload.response as Record<string, unknown>).usage as Record<string, unknown>
        : null;

    state.finishReason = state.toolCalls.size > 0 ? "tool_calls" : "stop";
    if (usage) {
      const promptTokens = Number(usage.input_tokens ?? 0);
      const completionTokens = Number(usage.output_tokens ?? 0);
      state.usage = {
        promptTokens,
        completionTokens,
        totalTokens: Number(usage.total_tokens ?? (promptTokens + completionTokens)),
        ...(usage.reasoning_tokens !== undefined
          ? { reasoningTokens: Number(usage.reasoning_tokens ?? 0) }
          : {}),
        ...(usage.input_tokens_details
          && typeof usage.input_tokens_details === "object"
          && (usage.input_tokens_details as Record<string, unknown>).cached_tokens !== undefined
          ? { cachedInputTokens: Number((usage.input_tokens_details as Record<string, unknown>).cached_tokens ?? 0) }
          : {}),
      };
    }
  }
}

/** 逐条读取 SSE 事件，兼容 `event:` / `data:` 的标准格式。 */
async function consumeResponsesStream(
  response: Response,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): Promise<ProtocolExecutionOutput> {
  const state: ResponsesStreamState = {
    contentParts: [],
    reasoningParts: [],
    toolCalls: new Map(),
    activeToolCallId: null,
    finishReason: null,
    usage: undefined,
  };

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      content: "",
      toolCalls: [],
      finishReason: "stop",
      retryCount: 0,
      fallbackEvents: [],
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData: string[] = [];

  const flushEvent = (): void => {
    if (!currentEvent || currentData.length === 0) {
      currentEvent = "";
      currentData = [];
      return;
    }

    try {
      const payload = JSON.parse(currentData.join("\n"));
      applyResponsesEvent(currentEvent, payload, state, onDelta, onToolCallDelta);
    } catch {
      // 忽略无法解析的事件，避免单个脏包中断整个流。
    }

    currentEvent = "";
    currentData = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (!line.trim()) {
        flushEvent();
      } else if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        currentData.push(line.slice("data:".length).trim());
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      if (buffer.trim()) {
        if (buffer.startsWith("data:")) {
          currentData.push(buffer.slice("data:".length).trim());
        } else if (buffer.startsWith("event:")) {
          currentEvent = buffer.slice("event:".length).trim();
        }
      }
      flushEvent();
      break;
    }
  }

  return {
    content: state.contentParts.join(""),
    ...(state.reasoningParts.length > 0 ? { reasoning: state.reasoningParts.join("") } : {}),
    toolCalls: materializeToolCalls(state.toolCalls),
    finishReason: state.finishReason ?? "stop",
    usage: state.usage,
    requestVariantId: null,
    fallbackReason: null,
    retryCount: 0,
    fallbackEvents: [],
  };
}

/** OpenAI native 驱动：rollout 开启时直连 `/v1/responses`，关闭时回退到 legacy shim。 */
export const openAiResponsesDriver: ProtocolDriver = {
  protocolTarget: "openai-responses",
  buildRequestBody(input: {
    profile: { model: string };
    content: unknown;
    toolBundle: { tools: unknown[] };
  }) {
    return buildOpenAiResponsesRequestBody(
      input.profile.model,
      buildCanonicalRequestMessages(input.content as any) as Array<{ role: string; content: unknown }>,
      input.toolBundle.tools,
      input.plan.legacyExecutionPlan.reasoningEffort as "low" | "medium" | "high" | "xhigh" | undefined,
    );
  },

  async execute(input) {
    if (!input.rolloutGate.enabled) {
      const result = await callModel({
        profile: input.profile,
        messages: canonicalTurnContentToLegacyMessages(input.content),
        tools: input.toolBundle.tools as never,
        executionPlan: input.plan.legacyExecutionPlan as never,
        signal: input.signal,
        onDelta: input.onDelta,
        onToolCallDelta: input.onToolCallDelta,
      });
      const transportMetadata = buildLegacyShimTransportMetadata("openai-responses", result.transport);
      const rolloutFallbackEvents = [
        { fromVariant: "openai-responses", toVariant: "openai-chat-compatible", reason: "rollout_disabled" as const },
      ];

      return {
        content: result.content,
        reasoning: result.reasoning,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        usage: result.usage,
        requestVariantId: transportMetadata.requestVariantId,
        fallbackReason: result.transport?.fallbackReason
          ?? rolloutFallbackEvents[0].reason
          ?? transportMetadata.fallbackReason,
        retryCount: transportMetadata.retryCount,
        fallbackEvents: [...rolloutFallbackEvents, ...transportMetadata.fallbackEvents],
      };
    }

    const requestBody = buildOpenAiResponsesRequestBody(
      input.profile.model,
      buildCanonicalRequestMessages(input.content) as Array<{ role: string; content: unknown }>,
      input.toolBundle.tools,
      input.plan.legacyExecutionPlan.reasoningEffort as "low" | "medium" | "high" | "xhigh" | undefined,
    );
    const transportResult = await executeRequestVariants({
      url: resolveResponsesApiUrl(input.profile),
      headers: buildRequestHeaders(input.profile),
      requestVariants: [{ id: "openai-responses", body: requestBody }],
      signal: input.signal,
    });
    const parsed = await consumeResponsesStream(
      transportResult.response,
      input.onDelta,
      input.onToolCallDelta,
    );

    return {
      content: parsed.content,
      reasoning: parsed.reasoning,
      toolCalls: parsed.toolCalls,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
      requestVariantId: transportResult.variant.id,
      fallbackReason: transportResult.variant.fallbackReason ?? null,
      retryCount: transportResult.retryCount,
      fallbackEvents: transportResult.fallbackEvents,
    };
  },
};
