import { buildRequestHeaders, resolveModelEndpointUrl, callModel } from "../../model-client";
import { executeRequestVariants } from "../../model-transport";
import { buildAnthropicThinkingPatch } from "../../anthropic-thinking";
import { canonicalTurnContentToLegacyMessages } from "../canonical-turn-content";
import { normalizeProviderCacheUsage } from "../provider-cache-orchestrator";
import { renderPromptSectionsByCacheTier } from "../prompt-composer";

import type { ProtocolDriver, ProtocolExecutionOutput } from "./shared";
import { buildLegacyShimTransportMetadata, flattenMessageParts } from "./shared";
import type { CanonicalMessagePart, CanonicalTurnContent } from "@shared/contracts";

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
  streamCompleted: boolean;
  errorMessage: string | null;
  rawUsage: Record<string, unknown>;
  usage: ProtocolExecutionOutput["usage"];
};

const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const MAX_SAFE_ANTHROPIC_OUTPUT_TOKENS = 64000;

type AnthropicSystemPrompt = {
  stablePrefixText: string;
  semiStableText: string;
  volatileTailText: string;
  uncachedTailText: string;
  fullText: string;
};

/** 判断 baseUrl 是否指向 Anthropic 官方 API，只有官方路线默认注入专属 cache_control。 */
function isOfficialAnthropicApiBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

/** 判断 profile 是否显式声明自己支持 Anthropic prompt cache 控制字段。 */
function hasExplicitAnthropicPromptCacheSupport(input: Parameters<NonNullable<ProtocolDriver["buildRequestBody"]>>[0]): boolean {
  const declaredAnthropic = input.profile.provider === "anthropic"
    || input.profile.providerFlavor === "anthropic"
    || input.plan.vendorFamily === "anthropic"
    || input.plan.providerFamily === "anthropic-native";
  return declaredAnthropic && (
    input.profile.capabilityOverrides?.supportsPromptCaching === true
    || input.profile.discoveredCapabilities?.supportsPromptCaching === true
  );
}

/** 判断当前 Anthropic Messages 路线是否应该注入 cache_control。 */
function shouldUseAnthropicCacheControl(input: Parameters<NonNullable<ProtocolDriver["buildRequestBody"]>>[0]): boolean {
  const providerIdentity = `${input.plan.vendorFamily ?? ""}:${input.plan.providerFamily ?? ""}:${input.profile.providerFlavor ?? ""}`.toLowerCase();
  if (providerIdentity.includes("deepseek")) {
    console.info("[anthropic-messages-driver] 已跳过 cache_control，DeepSeek Anthropic 兼容路线依赖官方自动前缀缓存");
    return false;
  }
  if (isOfficialAnthropicApiBaseUrl(input.profile.baseUrl) || hasExplicitAnthropicPromptCacheSupport(input)) {
    return true;
  }
  console.info("[anthropic-messages-driver] 已跳过 cache_control，当前 Anthropic 兼容路线未确认支持官方缓存控制字段", {
    providerFamily: input.plan.providerFamily,
    vendorFamily: input.plan.vendorFamily,
    providerFlavor: input.profile.providerFlavor,
  });
  return false;
}

/** 向 Anthropic system block 列表追加文本块，并按稳定性决定是否放置缓存断点。 */
function appendAnthropicSystemBlock(
  blocks: Array<Record<string, unknown>>,
  text: string,
  cacheable: boolean,
): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  blocks.push({
    type: "text",
    text: trimmed,
    ...(cacheable ? { cache_control: { type: "ephemeral" } } : {}),
  });
}

/** 给 Anthropic system 稳定块增加缓存断点，避免 volatile tail 污染官方前缀缓存。 */
function buildAnthropicSystem(system: AnthropicSystemPrompt, enableCacheControl: boolean): string | Array<Record<string, unknown>> {
  if (!enableCacheControl || !system.fullText.trim()) {
    return system.fullText;
  }

  const blocks: Array<Record<string, unknown>> = [];
  appendAnthropicSystemBlock(blocks, system.stablePrefixText, true);
  appendAnthropicSystemBlock(blocks, system.semiStableText, true);
  appendAnthropicSystemBlock(blocks, system.volatileTailText, false);
  appendAnthropicSystemBlock(blocks, system.uncachedTailText, false);
  return blocks.length > 0 ? blocks : system.fullText;
}

/** 统计 Anthropic system 中实际写入的缓存断点数量，便于日志核验。 */
function countAnthropicSystemBreakpoints(system: string | Array<Record<string, unknown>>): number {
  if (!Array.isArray(system)) {
    return 0;
  }
  return system.filter((block) => !!block.cache_control).length;
}

/** 给最后一个工具增加缓存断点，避免每轮重复写入完整工具列表。 */
function buildAnthropicTools(tools: unknown[], enableCacheControl: boolean): unknown[] {
  if (!enableCacheControl || tools.length === 0) {
    return tools;
  }
  return tools.map((tool, index) => {
    if (index !== tools.length - 1 || !tool || typeof tool !== "object" || Array.isArray(tool)) {
      return tool;
    }
    return {
      ...(tool as Record<string, unknown>),
      cache_control: { type: "ephemeral" },
    };
  });
}

/** 清理用户 requestBody 中会覆盖运行时消息、工具和流式契约的字段。 */
function sanitizeAnthropicRequestBody(requestBody: Record<string, unknown> | undefined): Record<string, unknown> {
  const body = { ...(requestBody ?? {}) };
  const ignoredKeys = ["model", "messages", "system", "stream", "tools", "tool_choice"];
  const removedKeys = ignoredKeys.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  for (const key of removedKeys) {
    delete body[key];
  }
  if (removedKeys.length > 0) {
    console.warn("[anthropic-messages-driver] 已忽略 profile.requestBody 中会覆盖运行时 Anthropic 契约的字段", {
      keys: removedKeys,
    });
  }
  return body;
}

/** 解析 Anthropic 必需的 max_tokens，优先使用显式配置，其次使用能力上限，最后落到安全默认值。 */
function resolveAnthropicMaxTokens(
  profile: Parameters<NonNullable<ProtocolDriver["buildRequestBody"]>>[0]["profile"],
  requestBody: Record<string, unknown>,
  thinkingPatch: Record<string, unknown>,
): number {
  const explicit = Number(requestBody.max_tokens);
  const thinking = thinkingPatch.thinking && typeof thinkingPatch.thinking === "object" && !Array.isArray(thinkingPatch.thinking)
    ? thinkingPatch.thinking as Record<string, unknown>
    : null;
  const budgetTokens = Number(thinking?.budget_tokens);
  const minForBudget = Number.isFinite(budgetTokens) && budgetTokens > 0
    ? Math.floor(budgetTokens) + 1024
    : 0;

  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(Math.floor(explicit), minForBudget);
  }

  const capabilityLimit = profile.capabilityOverrides?.maxOutputTokens
    ?? profile.discoveredCapabilities?.maxOutputTokens;
  if (typeof capabilityLimit === "number" && Number.isFinite(capabilityLimit) && capabilityLimit > 0) {
    return Math.max(Math.min(Math.floor(capabilityLimit), MAX_SAFE_ANTHROPIC_OUTPUT_TOKENS), minForBudget);
  }

  return Math.max(DEFAULT_ANTHROPIC_MAX_TOKENS, minForBudget);
}

/** 将 canonical 文本/多模态内容转换为 Anthropic content block，避免把 OpenAI 消息形状透传给 Claude。 */
function buildAnthropicTextBlocks(content: string | CanonicalMessagePart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }

  const text = flattenMessageParts(content).trim();
  return text ? [{ type: "text", text }] : [];
}

/** 解析工具参数 JSON，确保回放 assistant tool_use 时 input 始终是对象。 */
function parseToolUseInput(argumentsJson: string, fallbackInput?: Record<string, unknown> | null): Record<string, unknown> {
  if (fallbackInput && typeof fallbackInput === "object" && !Array.isArray(fallbackInput)) {
    return fallbackInput;
  }
  try {
    const parsed = JSON.parse(argumentsJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 历史消息中可能存在半截 JSON；回放给 Anthropic 时降级为空对象，避免请求体非法。
  }
  return {};
}

/** 将连续 tool 消息合并成 Anthropic 要求的 user/tool_result blocks，并保证 tool_result 排在文本之前。 */
function buildAnthropicToolResultBlocks(
  messages: CanonicalTurnContent["messages"],
  startIndex: number,
): { blocks: Array<Record<string, unknown>>; nextIndex: number } {
  const blocks: Array<Record<string, unknown>> = [];
  let index = startIndex;
  while (index < messages.length && messages[index]?.role === "tool") {
    const message = messages[index];
    if (message?.toolCallId) {
      const text = typeof message.content === "string" ? message.content : flattenMessageParts(message.content);
      blocks.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: text,
      });
    }
    index++;
  }
  return { blocks, nextIndex: index };
}

/** 构造 Anthropic Messages 专用消息列表；tools/skills/MCP 的结果必须回放为 tool_use/tool_result block。 */
function buildAnthropicRequestMessages(content: CanonicalTurnContent): {
  system: AnthropicSystemPrompt;
  messages: Array<Record<string, unknown>>;
} {
  const tieredSystem = renderPromptSectionsByCacheTier(content.systemSections);
  const uncachedSystemTailParts: string[] = [];

  const messages: Array<Record<string, unknown>> = [];
  if (content.userSections.length > 0) {
    messages.push({
      role: "user",
      content: content.userSections.map((section) => section.content).join("\n\n"),
    });
  }

  for (let index = 0; index < content.messages.length;) {
    const message = content.messages[index];
    if (message.role === "system") {
      const text = typeof message.content === "string" ? message.content : flattenMessageParts(message.content);
      if (text.trim()) {
        if (messages.length === 0) {
          uncachedSystemTailParts.push(text);
        } else {
          // 中文注释：历史里的 system 消息通常是运行时续行/恢复指令，必须保留顺序，避免 Anthropic 看到最后一条仍是 assistant。
          messages.push({ role: "user", content: text });
        }
      }
      index++;
      continue;
    }

    if (message.role === "tool") {
      const { blocks, nextIndex } = buildAnthropicToolResultBlocks(content.messages, index);
      if (blocks.length > 0) {
        messages.push({ role: "user", content: blocks });
      }
      index = nextIndex;
      continue;
    }

    const blocks = buildAnthropicTextBlocks(message.content);
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      for (const toolCall of message.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: parseToolUseInput(toolCall.argumentsJson, toolCall.input),
        });
      }
      messages.push({ role: "assistant", content: blocks });
      index++;
      continue;
    }

    const contentValue = blocks.length === 1 && blocks[0]?.type === "text"
      ? blocks[0].text
      : blocks;
    messages.push({ role: message.role, content: contentValue });
    index++;
  }

  const uncachedTailText = uncachedSystemTailParts.join("\n\n").trim();
  return {
    system: {
      ...tieredSystem,
      uncachedTailText,
      fullText: [tieredSystem.fullText, uncachedTailText].filter(Boolean).join("\n\n"),
    },
    messages,
  };
}

export function buildAnthropicMessagesRequestBody(input: Parameters<NonNullable<ProtocolDriver["buildRequestBody"]>>[0]): Record<string, unknown> {
  const { messages, system } = buildAnthropicRequestMessages(input.content);
  const reasoningEffort = (input.plan.legacyExecutionPlan as { reasoningEffort?: "low" | "medium" | "high" | "xhigh" } | null)?.reasoningEffort
    ?? input.profile.defaultReasoningEffort;
  const enableCacheControl = shouldUseAnthropicCacheControl(input);
  const tools = buildAnthropicTools(input.toolBundle.tools, enableCacheControl);
  const requestBody = sanitizeAnthropicRequestBody(input.profile.requestBody as Record<string, unknown> | undefined);
  const thinkingPatch = buildAnthropicThinkingPatch(input.profile, reasoningEffort);
  const maxTokens = resolveAnthropicMaxTokens(input.profile, requestBody, thinkingPatch);
  const systemBody = buildAnthropicSystem(system, enableCacheControl);
  if (enableCacheControl) {
    console.info("[anthropic-messages-driver] 已注入 Anthropic 缓存断点", {
      systemBreakpointCount: countAnthropicSystemBreakpoints(systemBody),
      toolBreakpointCount: tools.length > 0 ? 1 : 0,
    });
  }
  return {
    ...requestBody,
    model: input.profile.model,
    system: systemBody,
    messages,
    tools,
    stream: true,
    max_tokens: maxTokens,
    ...thinkingPatch,
  };
}

/** 把 Anthropic 工具调用累积状态物化为共享协议结果。 */
function materializeToolCalls(
  toolCallsByIndex: Map<number, AnthropicToolCallAccumulator>,
): ProtocolExecutionOutput["toolCalls"] {
  return [...toolCallsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, toolCall]) => {
      const argumentsJson = toolCall.argumentsJson.trim() || "{}";
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(argumentsJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch (error) {
        console.warn("[anthropic-messages-driver] 工具调用 arguments JSON 解析失败，已跳过该工具调用以避免执行错误参数", {
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : String(error),
          argumentsSnippet: argumentsJson.slice(0, 300),
          argumentsLength: argumentsJson.length,
        });
        return [];
      }

      return [{
        id: toolCall.id,
        name: toolCall.name,
        argumentsJson,
        input,
      }];
    });
}

/** 合并 Anthropic streaming usage 分片，message_start 提供缓存字段，message_delta 常只补输出 token。 */
function mergeAnthropicStreamUsage(
  state: AnthropicStreamState,
  providerIdentity: string,
  usage: Record<string, unknown>,
): void {
  state.rawUsage = {
    ...state.rawUsage,
    ...usage,
  };
  state.usage = normalizeProviderCacheUsage(providerIdentity, state.rawUsage);
}

/** 将 Anthropic SSE 事件合并回共享执行结果。 */
function applyAnthropicEvent(
  event: string,
  data: unknown,
  state: AnthropicStreamState,
  providerIdentity: string,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): void {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};

  if (event === "error") {
    const errorBody = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
      ? payload.error as Record<string, unknown>
      : payload;
    const errorType = typeof errorBody.type === "string" ? errorBody.type : "stream_error";
    const errorMessage = typeof errorBody.message === "string" ? errorBody.message : JSON.stringify(errorBody);
    state.errorMessage = `${errorType}: ${errorMessage}`;
    console.warn("[anthropic-messages-driver] Anthropic SSE 返回 error 事件，已中断当前流", {
      errorType,
      errorMessage,
    });
    return;
  }

  if (event === "message_start") {
    const message = payload.message && typeof payload.message === "object" && !Array.isArray(payload.message)
      ? payload.message as Record<string, unknown>
      : null;
    const usage = message?.usage && typeof message.usage === "object" && !Array.isArray(message.usage)
      ? message.usage as Record<string, unknown>
      : payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage)
        ? payload.usage as Record<string, unknown>
        : null;
    if (usage) {
      mergeAnthropicStreamUsage(state, providerIdentity, usage);
    }
    return;
  }

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
      mergeAnthropicStreamUsage(state, providerIdentity, usage);
    }
  }

  if (event === "message_stop") {
    state.streamCompleted = true;
  }
}

/** 逐条读取 Anthropic SSE 事件，兼容标准 `event:` / `data:` 帧。 */
async function consumeAnthropicStream(
  response: Response,
  providerIdentity: string,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): Promise<ProtocolExecutionOutput> {
  const state: AnthropicStreamState = {
    contentParts: [],
    reasoningParts: [],
    toolCallsByIndex: new Map(),
    finishReason: null,
    streamCompleted: false,
    errorMessage: null,
    rawUsage: {},
    usage: undefined,
  };

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      content: "",
      toolCalls: [],
      finishReason: "stop",
      streamCompleted: false,
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
      applyAnthropicEvent(currentEvent, payload, state, providerIdentity, onDelta, onToolCallDelta);
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

  if (state.errorMessage) {
    throw new Error(`Anthropic stream error: ${state.errorMessage}`);
  }

  return {
    content: state.contentParts.join(""),
    ...(state.reasoningParts.length > 0 ? { reasoning: state.reasoningParts.join("") } : {}),
    toolCalls: materializeToolCalls(state.toolCallsByIndex),
    finishReason: state.finishReason ?? (state.toolCallsByIndex.size > 0 ? "tool_calls" : "stop"),
    streamCompleted: state.streamCompleted,
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
        protocolTarget: "anthropic-messages",
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
        streamCompleted: result.streamCompleted,
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
      input.plan.vendorFamily ?? input.plan.providerFamily ?? input.profile.providerFlavor ?? "anthropic",
      input.onDelta,
      input.onToolCallDelta,
    );

    return {
      content: parsed.content,
      reasoning: parsed.reasoning,
      toolCalls: parsed.toolCalls,
      finishReason: parsed.finishReason,
      streamCompleted: parsed.streamCompleted,
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
