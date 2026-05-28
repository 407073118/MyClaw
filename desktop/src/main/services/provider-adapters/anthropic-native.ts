import type { ModelProfile } from "@shared/contracts";
import type { ProviderAdapter, ProviderAdapterMessage, ProviderAdapterTool } from "./base";
import {
  cloneReplayMessages,
  createRequestVariant,
  normalizeAdapterResponse,
} from "./base";
import { buildAnthropicThinkingPatch } from "../anthropic-thinking";
import { normalizeProviderCacheUsage } from "../model-runtime/provider-cache-orchestrator";

type AnthropicInputSchemaTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const MAX_SAFE_ANTHROPIC_OUTPUT_TOKENS = 64000;

/** 判断 baseUrl 是否指向 Anthropic 官方 API，legacy 路线只在官方端点默认发送 cache_control。 */
function isOfficialAnthropicApiBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

/** 判断当前 profile 是否明确声明支持 Anthropic 官方 prompt cache 控制字段。 */
function shouldUseAnthropicCacheControl(profile: ModelProfile): boolean {
  const declaredAnthropic = profile.provider === "anthropic"
    || profile.providerFlavor === "anthropic"
    || profile.providerFamily === "anthropic-native"
    || profile.vendorFamily === "anthropic";
  return declaredAnthropic && (
    isOfficialAnthropicApiBaseUrl(profile.baseUrl)
    || profile.capabilityOverrides?.supportsPromptCaching === true
    || profile.discoveredCapabilities?.supportsPromptCaching === true
  );
}

/** 判断工具是否已经是 Anthropic messages 原生 input_schema 形状。 */
function isAnthropicInputSchemaTool(tool: unknown): tool is AnthropicInputSchemaTool {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return false;
  }
  const record = tool as Record<string, unknown>;
  return typeof record.name === "string"
    && !!record.input_schema
    && typeof record.input_schema === "object"
    && !Array.isArray(record.input_schema);
}

/** 判断工具是否仍是 OpenAI function wrapper 形状。 */
function isOpenAiFunctionTool(tool: unknown): tool is ProviderAdapterTool {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return false;
  }
  const record = tool as Record<string, unknown>;
  const fn = record.function;
  return record.type === "function"
    && !!fn
    && typeof fn === "object"
    && !Array.isArray(fn)
    && typeof (fn as Record<string, unknown>).name === "string";
}

/** 把 OpenAI 风格函数工具转换成 Anthropic messages 更友好的 `input_schema` 结构。 */
function normalizeAnthropicTools(tools: ProviderAdapterTool[] | undefined): Array<Record<string, unknown>> {
  return (tools ?? []).map((tool) => {
    if (isAnthropicInputSchemaTool(tool)) {
      return {
        name: tool.name,
        description: tool.description ?? "",
        input_schema: tool.input_schema,
      };
    }
    if (isOpenAiFunctionTool(tool)) {
      return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      };
    }
    throw new Error("Anthropic 工具定义不完整：缺少 function.name 或 input_schema.name");
  });
}

/** 给最后一个 Anthropic 工具 schema 加缓存断点，legacy 路线至少能复用稳定工具前缀。 */
function applyAnthropicToolCacheControl(
  tools: Array<Record<string, unknown>>,
  enableCacheControl: boolean,
): Array<Record<string, unknown>> {
  if (!enableCacheControl || tools.length === 0) {
    return tools;
  }
  return tools.map((tool, index) => index === tools.length - 1
    ? { ...tool, cache_control: { type: "ephemeral" } }
    : tool);
}

/** 清理会覆盖 Anthropic 原生运行时契约的自定义请求体字段。 */
function sanitizeAnthropicRequestBody(requestBody: ModelProfile["requestBody"] | undefined): Record<string, unknown> {
  const body = { ...(requestBody ?? {}) } as Record<string, unknown>;
  const ignoredKeys = ["model", "messages", "system", "stream", "tools", "tool_choice"];
  const removedKeys = ignoredKeys.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  for (const key of removedKeys) {
    delete body[key];
  }
  if (removedKeys.length > 0) {
    console.warn("[anthropic-native-adapter] 已忽略 profile.requestBody 中会覆盖 Anthropic 运行时契约的字段", {
      keys: removedKeys,
    });
  }
  return body;
}

/** 解析 Anthropic 必填的 max_tokens，并保证 thinking budget 不会等于或超过输出上限。 */
function resolveAnthropicMaxTokens(
  profile: ModelProfile,
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

/** 将历史消息内容收敛成 Anthropic 可接受的文本，避免透传 OpenAI 专用片段。 */
function stringifyAnthropicContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") {
            return record.text;
          }
          if (typeof record.content === "string") {
            return record.content;
          }
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
  }
  return JSON.stringify(content);
}

/** 给带工具调用的 assistant 历史消息生成 Anthropic text/tool_use blocks。 */
function buildAnthropicAssistantBlocks(message: ProviderAdapterMessage): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const text = stringifyAnthropicContent(message.content);
  if (text.trim()) {
    blocks.push({ type: "text", text });
  }

  for (const toolCall of message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(toolCall.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("[anthropic-native-adapter] 历史工具调用 arguments JSON 解析失败，已降级为空对象", {
        toolName: toolCall.function.name,
        error: error instanceof Error ? error.message : String(error),
        argumentsSnippet: toolCall.function.arguments.slice(0, 300),
        argumentsLength: toolCall.function.arguments.length,
      });
    }
    blocks.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input,
    });
  }

  return blocks;
}

/** 合并连续 tool 消息为 Anthropic 要求的 user/tool_result blocks。 */
function buildAnthropicToolResultBlocks(
  messages: ProviderAdapterMessage[],
  startIndex: number,
): { blocks: Array<Record<string, unknown>>; nextIndex: number } {
  const blocks: Array<Record<string, unknown>> = [];
  let index = startIndex;
  while (index < messages.length && messages[index]?.role === "tool") {
    const message = messages[index];
    if (message?.tool_call_id) {
      blocks.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: stringifyAnthropicContent(message.content),
      });
    }
    index++;
  }
  return { blocks, nextIndex: index };
}

/** 构造 Anthropic 原生回放消息，禁止把 OpenAI 的 role/tool_calls 形态发给 Claude。 */
function buildAnthropicReplayMessages(messages: ProviderAdapterMessage[]): {
  system: string;
  messages: Array<Record<string, unknown>>;
} {
  const systemParts: string[] = [];
  const replayMessages: Array<Record<string, unknown>> = [];

  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (!message) {
      index++;
      continue;
    }
    if (message.role === "system") {
      const systemText = stringifyAnthropicContent(message.content);
      if (systemText.trim()) {
        if (replayMessages.length === 0) {
          systemParts.push(systemText);
        } else {
          // 中文注释：legacy 回放中的 system 消息是会话内续行指令，按 user turn 保留顺序。
          replayMessages.push({ role: "user", content: systemText });
        }
      }
      index++;
      continue;
    }
    if (message.role === "tool") {
      const { blocks, nextIndex } = buildAnthropicToolResultBlocks(messages, index);
      if (blocks.length > 0) {
        replayMessages.push({ role: "user", content: blocks });
      }
      index = nextIndex;
      continue;
    }
    if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      replayMessages.push({
        role: "assistant",
        content: buildAnthropicAssistantBlocks(message),
      });
      index++;
      continue;
    }
    replayMessages.push({
      role: message.role,
      content: stringifyAnthropicContent(message.content),
    });
    index++;
  }

  return {
    system: systemParts.join("\n\n"),
    messages: replayMessages,
  };
}

/** Anthropic 原生适配器在 legacy 通路里也尽量输出接近 messages API 的请求形状。 */
export const anthropicNativeAdapter: ProviderAdapter = {
  id: "anthropic-native",

  materializeReplayMessages(_context, input) {
    return cloneReplayMessages(input.messages);
  },

  prepareRequest(context, input) {
    const { system, messages } = buildAnthropicReplayMessages(input.messages);
    const requestBody = sanitizeAnthropicRequestBody(context.profile.requestBody);
    const thinkingPatch = buildAnthropicThinkingPatch(context.profile, context.reasoningEffort);
    const maxTokens = resolveAnthropicMaxTokens(context.profile, requestBody, thinkingPatch);
    const enableCacheControl = shouldUseAnthropicCacheControl(context.profile);
    const tools = applyAnthropicToolCacheControl(normalizeAnthropicTools(input.tools), enableCacheControl);
    const body: Record<string, unknown> = {
      ...requestBody,
      model: context.profile.model,
      messages,
      tools,
      stream: true,
      max_tokens: maxTokens,
      ...thinkingPatch,
    };
    if (system.trim()) {
      body["system"] = system;
    }
    console.info("[anthropic-native-adapter] 已生成 Anthropic messages 兼容请求体", {
      messageCount: messages.length,
      hasSystem: system.trim().length > 0,
      toolCount: input.tools?.length ?? 0,
      cacheControlEnabled: enableCacheControl,
      maxTokens,
    });
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
    const normalizedUsage = usage ? normalizeProviderCacheUsage("anthropic-native", usage) : undefined;

    return {
      ...(content ? { content } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(typeof record.stop_reason === "string"
        ? { finishReason: record.stop_reason === "tool_use" ? "tool_calls" : record.stop_reason }
        : {}),
      ...(normalizedUsage ? { usage: normalizedUsage } : {}),
      raw: payload,
    };
  },
};
