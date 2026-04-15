import { buildRequestHeaders, resolveModelEndpointUrl, callModel } from "../../model-client";
import { executeRequestVariants } from "../../model-transport";
import { canonicalTurnContentToLegacyMessages } from "../canonical-turn-content";

import type { ProtocolDriver, ProtocolExecutionOutput } from "./shared";
import { buildCanonicalRequestMessages, buildLegacyShimTransportMetadata } from "./shared";

const ANTHROPIC_THINKING_BUDGET_MAP: Record<"low" | "medium" | "high" | "xhigh", number> = {
  low: 4096,
  medium: 16384,
  high: 32768,
  xhigh: 65536,
};

type AnthropicToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

type AnthropicStreamState = {
  contentParts: string[];
  reasoningParts: string[];
  toolCallsByIndex: Map<number, AnthropicToolCallAccumulator>;
  finishReason: string | null;
  usage: ProtocolExecutionOutput["usage"];
};

/** 构造 Anthropic Messages 原生请求体。 */
export function buildAnthropicMessagesRequestBody(input: Parameters<NonNullable<ProtocolDriver["buildRequestBody"]>>[0]): Record<string, unknown> {
  const messages = buildCanonicalRequestMessages(input.content);
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content ?? ""))
    .join("\n\n");
  const reasoningEffort = (input.plan.legacyExecutionPlan as { reasoningEffort?: "low" | "medium" | "high" | "xhigh" } | null)?.reasoningEffort
    ?? input.profile.defaultReasoningEffort;
  return {
    model: input.profile.model,
    system,
    messages: messages.filter((message) => message.role !== "system"),
    tools: input.toolBundle.tools,
    stream: true,
    ...(reasoningEffort
      ? {
          thinking: {
            type: "enabled",
            budget_tokens: ANTHROPIC_THINKING_BUDGET_MAP[reasoningEffort],
          },
        }
      : {}),
  };
}

/** 把 Anthropic 工具调用累积状态物化为共享协议结果。 */
function materializeToolCalls(
  toolCallsByIndex: Map<number, AnthropicToolCallAccumulator>,
): ProtocolExecutionOutput["toolCalls"] {
  return [...toolCallsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => {
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

/** 将 Anthropic SSE 事件合并回共享执行结果。 */
function applyAnthropicEvent(
  event: string,
  data: unknown,
  state: AnthropicStreamState,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): void {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};

  if (event === "content_block_start") {
    const index = Number(payload.index ?? 0);
    const block = payload.content_block && typeof payload.content_block === "object"
      ? payload.content_block as Record<string, unknown>
      : null;
    if (block?.type === "text" && typeof block.text === "string" && block.text) {
      state.contentParts.push(block.text);
      onDelta?.({ content: block.text });
      return;
    }
    if ((block?.type === "thinking" || block?.type === "reasoning")
      && typeof (block.thinking ?? block.text) === "string"
      && String(block.thinking ?? block.text)) {
      const reasoning = String(block.thinking ?? block.text);
      state.reasoningParts.push(reasoning);
      onDelta?.({ reasoning });
      return;
    }
    if (!block || block.type !== "tool_use") {
      return;
    }

    const existingInput = block.input && typeof block.input === "object"
      ? (Object.keys(block.input as Record<string, unknown>).length > 0
          ? JSON.stringify(block.input)
          : "")
      : "";
    state.toolCallsByIndex.set(index, {
      id: typeof block.id === "string" ? block.id : `toolcall-${index}`,
      name: typeof block.name === "string" ? block.name : "",
      argumentsJson: existingInput,
    });
    return;
  }

  if (event === "content_block_delta") {
    const index = Number(payload.index ?? 0);
    const delta = payload.delta && typeof payload.delta === "object"
      ? payload.delta as Record<string, unknown>
      : {};

    if (delta.type === "text_delta" && typeof delta.text === "string") {
      state.contentParts.push(delta.text);
      onDelta?.({ content: delta.text });
      return;
    }

    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      state.reasoningParts.push(delta.thinking);
      onDelta?.({ reasoning: delta.thinking });
      return;
    }

    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const toolCall = state.toolCallsByIndex.get(index);
      if (!toolCall) {
        return;
      }

      toolCall.argumentsJson += delta.partial_json;
      onToolCallDelta?.({
        toolCallId: toolCall.id,
        name: toolCall.name,
        argumentsDelta: delta.partial_json,
      });
    }
    return;
  }

  if (event === "content_block_stop") {
    const index = Number(payload.index ?? 0);
    const block = payload.content_block && typeof payload.content_block === "object"
      ? payload.content_block as Record<string, unknown>
      : null;
    if (block?.type === "text" && typeof block.text === "string" && block.text) {
      state.contentParts.push(block.text);
      onDelta?.({ content: block.text });
      return;
    }
    if ((block?.type === "thinking" || block?.type === "reasoning")
      && typeof (block.thinking ?? block.text) === "string"
      && String(block.thinking ?? block.text)) {
      const reasoning = String(block.thinking ?? block.text);
      state.reasoningParts.push(reasoning);
      onDelta?.({ reasoning });
      return;
    }
    if (block?.type === "tool_use") {
      const existing = state.toolCallsByIndex.get(index);
      if (!existing) {
        return;
      }
      if (block.input && typeof block.input === "object" && !Array.isArray(block.input)) {
        existing.argumentsJson = JSON.stringify(block.input);
      }
    }
    return;
  }

  if (event === "message_delta") {
    const delta = payload.delta && typeof payload.delta === "object"
      ? payload.delta as Record<string, unknown>
      : {};
    const stopReason = typeof delta.stop_reason === "string" ? delta.stop_reason : null;
    if (stopReason === "tool_use") {
      state.finishReason = "tool_calls";
    } else if (stopReason === "end_turn") {
      state.finishReason = "stop";
    } else if (stopReason) {
      state.finishReason = stopReason;
    }

    const usage = payload.usage && typeof payload.usage === "object"
      ? payload.usage as Record<string, unknown>
      : null;
    if (usage) {
      const promptTokens = Number(usage.input_tokens ?? 0);
      const completionTokens = Number(usage.output_tokens ?? 0);
      state.usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    }
  }
}

/** 逐条读取 Anthropic SSE 事件，兼容标准 `event:` / `data:` 帧。 */
async function consumeAnthropicStream(
  response: Response,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): Promise<ProtocolExecutionOutput> {
  const state: AnthropicStreamState = {
    contentParts: [],
    reasoningParts: [],
    toolCallsByIndex: new Map(),
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
      citations: [],
      capabilityEvents: [],
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
      applyAnthropicEvent(currentEvent, payload, state, onDelta, onToolCallDelta);
    } catch {
      // 忽略无法解析的事件，避免脏包中断原生流。
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
    toolCalls: materializeToolCalls(state.toolCallsByIndex),
    finishReason: state.finishReason ?? (state.toolCallsByIndex.size > 0 ? "tool_calls" : "stop"),
    usage: state.usage,
    requestVariantId: null,
    fallbackReason: null,
    retryCount: 0,
    fallbackEvents: [],
    citations: [],
    capabilityEvents: [],
  };
}

/** Anthropic native 驱动：rollout 开启时直连 `/v1/messages`，关闭时回退 legacy shim。 */
export const anthropicMessagesDriver: ProtocolDriver = {
  protocolTarget: "anthropic-messages",
  buildRequestBody: buildAnthropicMessagesRequestBody,

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
      const transportMetadata = buildLegacyShimTransportMetadata("anthropic-messages", result.transport);
      return {
        content: result.content,
        reasoning: result.reasoning,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        usage: result.usage,
        requestVariantId: transportMetadata.requestVariantId,
        fallbackReason: transportMetadata.fallbackReason,
        retryCount: transportMetadata.retryCount,
        fallbackEvents: transportMetadata.fallbackEvents,
        citations: [],
        capabilityEvents: [],
      };
    }

    const requestBody = buildAnthropicMessagesRequestBody(input);
    const requestVariantId = input.plan.providerFamily === "moonshot-native"
      ? "anthropic-messages-moonshot"
      : input.plan.providerFamily === "qwen-native"
        ? "anthropic-messages-qwen"
        : "anthropic-messages";
    const transportResult = await executeRequestVariants({
      url: resolveModelEndpointUrl(input.profile, "anthropic-messages"),
      headers: buildRequestHeaders(input.profile, "anthropic-messages"),
      requestVariants: [{ id: requestVariantId, body: requestBody }],
      signal: input.signal,
    });
    const parsed = await consumeAnthropicStream(
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
      requestVariantId: requestVariantId,
      fallbackReason: transportResult.variant.fallbackReason ?? null,
      retryCount: transportResult.retryCount,
      fallbackEvents: transportResult.fallbackEvents,
      citations: parsed.citations ?? [],
      capabilityEvents: parsed.capabilityEvents ?? [],
    };
  },
};
