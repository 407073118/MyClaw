/**
 * 主进程使用的 OpenAI 兼容（以及 Anthropic）模型客户端。
 * 仅使用原生 fetch，自包含实现，不依赖 desktop 其他包。
 */

import type { ModelProfile } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 内容可以是纯字符串，也可以是多模态数组（用于视觉/截图场景）。 */
export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatMessageContent;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ModelCallOptions = {
  profile: ModelProfile;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** API 响应中的 Token 使用量。 */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** 单次流式模型调用完成后返回的结果。 */
export type ModelCallResult = {
  content: string;
  reasoning?: string;
  toolCalls: ResolvedToolCall[];
  finishReason: string | null;
  usage?: TokenUsage;
};

/** SSE 累积完成后得到的完整工具调用对象。 */
export type ResolvedToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  input: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// URL 解析
// ---------------------------------------------------------------------------

/**
 * 规范化 base URL，移除尾部多余斜杠。
 */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 去掉用户可能误填在 baseUrl 中的已知接口后缀，
 * 以便后续由程序安全地补上正确的后缀。
 *
 * 例如：
 * "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
 * 会被规整为 "https://dashscope.aliyuncs.com"
 */
function stripKnownEndpointSuffixes(baseUrl: string): string {
  const suffixes = [
    "/chat/completions",
    "/v1/messages",
    "/compatible-mode/v1",
    "/v1",
  ];
  let url = baseUrl;
  const lower = url.toLowerCase();
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      url = url.slice(0, -suffix.length);
      break;
    }
  }
  return normalizeBaseUrl(url) || baseUrl;
}

type ProviderFlavor = "anthropic" | "qwen" | "qwen-coding" | "generic";

/**
 * 根据 profile 判定应使用哪种 URL 与请求头风格。
 *
 * 逻辑与 desktop runtime 中的 resolveOpenAiCompatibleFlavor +
 * resolveProviderApiBaseUrl 保持一致，但不直接引入这些包。
 */
function resolveProviderFlavor(profile: ModelProfile): ProviderFlavor {
  const lowerUrl = normalizeBaseUrl(profile.baseUrl).toLowerCase();
  const lowerModel = profile.model.toLowerCase();

  // MiniMax 无论 provider 如何设置，都使用 OpenAI 兼容协议
  if (profile.providerFlavor === "minimax-anthropic"
    || lowerUrl.includes("minimax") || lowerUrl.includes("minimaxi")
    || lowerModel.startsWith("minimax")) {
    return "generic";
  }

  if (profile.provider === "anthropic") {
    return "anthropic";
  }

  if (lowerUrl.includes("dashscope.aliyuncs.com") || lowerModel.startsWith("qwen")) {
    // coding.dashscope 使用标准 OpenAI 路径，而不是 /compatible-mode
    if (lowerUrl.includes("coding.dashscope")) {
      return "qwen-coding";
    }
    return "qwen";
  }

  return "generic";
}

/**
 * 解析 API 根地址（即 /chat/completions 或 /v1/messages 之前的部分）。
 *
 * 当 baseUrlMode 为 "provider-root" 时，用户只提供了服务根地址，
 * 此时需要由程序补上正确路径；当它为 "manual"（或未提供）时，
 * 说明用户已经给出了完整 base URL，我们只做规范化处理。
 */
function resolveApiRoot(profile: ModelProfile): string {
  const normalized = normalizeBaseUrl(profile.baseUrl);

  if (profile.baseUrlMode !== "provider-root") {
    // manual 模式下，用户可能已经手动带上路径后缀，这里保持原样。
    return normalized;
  }

  // provider-root：先清理用户误带的路径后缀。
  const cleaned = stripKnownEndpointSuffixes(normalized);
  const flavor = resolveProviderFlavor(profile);

  switch (flavor) {
    case "anthropic":
      // Anthropic 根地址需要补上 /v1
      return appendIfMissing(cleaned, "/v1");

    case "qwen":
      // 非 coding 版 dashscope 需要补上 /compatible-mode/v1
      return appendIfMissing(cleaned, "/compatible-mode/v1");

    case "qwen-coding":
    case "generic":
    default:
      return appendIfMissing(cleaned, "/v1");
  }
}

function appendIfMissing(base: string, suffix: string): string {
  if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
    return base;
  }
  return `${base}${suffix}`;
}

/**
 * 构建完整的 chat completions（或 Anthropic messages）接口地址。
 */
export function resolveModelEndpointUrl(profile: ModelProfile): string {
  const root = resolveApiRoot(profile);
  const flavor = resolveProviderFlavor(profile);

  if (flavor === "anthropic") {
    return appendIfMissing(root, "/messages");
  }

  return appendIfMissing(root, "/chat/completions");
}

// ---------------------------------------------------------------------------
// 请求头
// ---------------------------------------------------------------------------

function buildRequestHeaders(profile: ModelProfile): Record<string, string> {
  const flavor = resolveProviderFlavor(profile);

  const base: Record<string, string> = {
    "content-type": "application/json",
  };

  if (flavor === "anthropic") {
    base["x-api-key"] = profile.apiKey;
    base["anthropic-version"] = "2023-06-01";
  } else {
    base["authorization"] = `Bearer ${profile.apiKey}`;
  }

  // 允许通过 profile 覆盖请求头（例如自定义认证方案）。
  return { ...base, ...(profile.headers ?? {}) };
}

// ---------------------------------------------------------------------------
// SSE 解析辅助方法
// ---------------------------------------------------------------------------

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

type SseState = {
  contentParts: string[];
  reasoningParts: string[];
  toolCallsByIndex: Map<number, ToolCallAccumulator>;
  finishReason: string | null;
  usage: TokenUsage | null;
};

function ensureToolCallAccumulator(
  map: Map<number, ToolCallAccumulator>,
  index: number,
): ToolCallAccumulator {
  const existing = map.get(index);
  if (existing) return existing;
  const next: ToolCallAccumulator = {
    id: `toolcall-${Math.random().toString(36).slice(2)}`,
    name: "",
    argumentsJson: "",
  };
  map.set(index, next);
  return next;
}

/**
 * 尝试从值中读取字符串；该值可能是普通字符串、数组，
 * 也可能是带有 "text" 字段的嵌套对象（Anthropic 风格）。
 */
function extractText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string" && text) parts.push(text);
      } else if (typeof item === "string" && item) {
        parts.push(item);
      }
    }
    return parts.join("") || null;
  }
  if (value && typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string" && text) return text;
  }
  return null;
}

/**
 * 从 OpenAI 兼容格式的 delta 对象中读取 reasoning / thinking 增量。
 * 这里会检查不同提供商常见的字段命名。
 */
function readReasoningDelta(delta: Record<string, unknown>): string | null {
  return (
    extractText(delta["reasoning_content"]) ??
    extractText(delta["reasoning_details"]) ??
    extractText(delta["reasoning"]) ??
    extractText(delta["thinking"]) ??
    null
  );
}

/**
 * 将单个已解析的 SSE chunk 应用到累计状态中，
 * 并触发 onDelta 回调。
 */
function applySseChunk(
  payload: unknown,
  state: SseState,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
): void {
  if (!payload || typeof payload !== "object") return;

  const choices = (payload as { choices?: unknown }).choices;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null;

  const delta =
    firstChoice && typeof firstChoice.delta === "object" && firstChoice.delta !== null
      ? (firstChoice.delta as Record<string, unknown>)
      : {};

  // --- content ---
  const contentVal = extractText(delta["content"]);
  if (contentVal) {
    state.contentParts.push(contentVal);
    onDelta?.({ content: contentVal });
  }

  // --- reasoning ---
  const reasoningVal = readReasoningDelta(delta);
  if (reasoningVal) {
    state.reasoningParts.push(reasoningVal);
    onDelta?.({ reasoning: reasoningVal });
  }

  // --- tool_calls（按 index 聚合，支持并行工具调用） ---
  const rawToolCalls = Array.isArray(delta["tool_calls"])
    ? (delta["tool_calls"] as unknown[])
    : [];

  for (const rawEntry of rawToolCalls) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;

    const rawIndex = entry["index"];
    const parsedIndex =
      typeof rawIndex === "number" && Number.isFinite(rawIndex)
        ? rawIndex
        : Number.parseInt(String(rawIndex ?? state.toolCallsByIndex.size), 10);
    const index = Number.isFinite(parsedIndex)
      ? parsedIndex
      : state.toolCallsByIndex.size;

    const acc = ensureToolCallAccumulator(state.toolCallsByIndex, index);

    if (typeof entry["id"] === "string" && entry["id"].trim()) {
      acc.id = entry["id"].trim();
    }

    const fn =
      entry["function"] && typeof entry["function"] === "object"
        ? (entry["function"] as Record<string, unknown>)
        : {};
    if (typeof fn["name"] === "string" && fn["name"].trim()) {
      acc.name = fn["name"].trim();
    }
    if (typeof fn["arguments"] === "string") {
      acc.argumentsJson += fn["arguments"];
    }
  }

  // --- finish_reason ---
  if (firstChoice && typeof firstChoice["finish_reason"] === "string") {
    const fr = firstChoice["finish_reason"].trim();
    if (fr) state.finishReason = fr;
  }

  // --- usage（部分提供商会在最后一个 SSE chunk 中返回） ---
  const rawUsage = (payload as Record<string, unknown>)["usage"];
  if (rawUsage && typeof rawUsage === "object") {
    const u = rawUsage as Record<string, unknown>;
    state.usage = {
      promptTokens: Number(u["prompt_tokens"] ?? u["input_tokens"] ?? 0),
      completionTokens: Number(u["completion_tokens"] ?? u["output_tokens"] ?? 0),
      totalTokens: Number(u["total_tokens"] ?? 0),
    };
    if (state.usage.totalTokens === 0) {
      state.usage.totalTokens = state.usage.promptTokens + state.usage.completionTokens;
    }
  }
}

/**
 * 解析 JSON 字符串；只要出错就返回 null。
 */
function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * 将累计的 tool-call 片段整理成最终可用的 resolved calls。
 */
function materializeToolCalls(state: SseState): ResolvedToolCall[] {
  return [...state.toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, acc]) => acc)
    .filter((acc) => acc.name.trim().length > 0)
    .map((acc) => {
      const argumentsJson = acc.argumentsJson.trim() || "{}";
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(argumentsJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        // 保持为空对象
      }
      return { id: acc.id, name: acc.name, argumentsJson, input };
    });
}

// ---------------------------------------------------------------------------
// 核心流式消费逻辑
// ---------------------------------------------------------------------------

/**
 * 读取 SSE 响应体，并累计 content、reasoning 与 tool calls。
 *
 * 兼容处理 \r\n / \n 行尾、尾部缓冲区以及格式异常的 chunk。
 */
async function consumeSseStream(
  response: Response,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
): Promise<{ content: string; reasoning: string; toolCalls: ResolvedToolCall[]; finishReason: string | null; usage: TokenUsage | null }> {
  const state: SseState = {
    contentParts: [],
    reasoningParts: [],
    toolCallsByIndex: new Map(),
    finishReason: null,
    usage: null,
  };

  if (!response.body) {
    // 如果没有流式响应体，就退回到读取完整文本，
    // 并把每一行都当作可能的 SSE data 行来处理。
    const rawText = await response.text();
    for (const rawLine of rawText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      const parsed = tryParseJson(payload);
      if (parsed !== null) applySseChunk(parsed, state, onDelta);
    }
    return finaliseSseState(state);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") return;
    const parsed = tryParseJson(payload);
    if (parsed !== null) applySseChunk(parsed, state, onDelta);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    // 统一处理 Windows 风格换行
    buffer = buffer.replace(/\r\n/g, "\n");

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
  }

  // 刷新缓冲区中剩余内容（例如最后没有换行符的情况）
  if (buffer.trim()) {
    processLine(buffer);
  }

  return finaliseSseState(state);
}

function finaliseSseState(state: SseState): {
  content: string;
  reasoning: string;
  toolCalls: ResolvedToolCall[];
  finishReason: string | null;
  usage: TokenUsage | null;
} {
  return {
    content: state.contentParts.join(""),
    reasoning: state.reasoningParts.join(""),
    toolCalls: materializeToolCalls(state),
    finishReason: state.finishReason,
    usage: state.usage,
  };
}

// ---------------------------------------------------------------------------
// 重试逻辑
// ---------------------------------------------------------------------------

/** 临时性 API 错误的最大重试次数。 */
const MAX_RETRIES = 3;

/** 指数退避等待时长（毫秒）：1s → 2s → 4s。 */
const RETRY_DELAYS = [1000, 2000, 4000];

/**
 * 判断某个错误或 HTTP 状态码是否适合重试。
 *
 * 可重试：网络错误、超时、429（限流）、5xx（服务端错误）。
 * 不可重试：用户主动中断、400/401/403/404（客户端错误）。
 */
export function isRetryableError(err: unknown, response?: Response | null): boolean {
  // 用户主动中断永远不应重试
  if (err instanceof Error && err.name === "AbortError") return false;

  // 网络错误（fetch 抛出的 TypeError）和超时可以重试
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === "TimeoutError") return true;

  // 基于 HTTP 状态码判断是否可重试
  if (response) {
    const status = response.status;
    return status === 429 || status >= 500;
  }

  // 对于没有 response 的未知错误，默认按可重试处理（通常是网络问题）
  if (err) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 调用模型并流式返回内容。
 *
 * 支持 OpenAI 兼容提供商（包括 dashscope / Qwen 变体）以及 Anthropic。
 * 提供商特定的请求头与 URL 路径会根据 `options.profile` 自动解析。
 *
 * 工具调用会跨多个 SSE 帧累计，最终通过 `toolCalls` 返回。
 */
export async function callModel(options: ModelCallOptions): Promise<ModelCallResult> {
  const { profile, messages, tools, onDelta, signal, timeoutMs = 120_000 } = options;

  const url = resolveModelEndpointUrl(profile);
  const headers = buildRequestHeaders(profile);

  // 构建发送给接口的消息列表，并移除内部字段（如 reasoning）
  const wireMessages = messages.map((m) => {
    const base: Record<string, unknown> = {
      role: m.role,
      content: m.content,
    };
    if (m.tool_call_id) base["tool_call_id"] = m.tool_call_id;
    if (m.tool_calls && m.tool_calls.length > 0) base["tool_calls"] = m.tool_calls;
    return base;
  });

  const hasTools = tools && tools.length > 0;
  const requestBody: Record<string, unknown> = {
    model: profile.model,
    messages: wireMessages,
    stream: true,
    ...(hasTools ? { tools, tool_choice: "auto" } : {}),
    ...(profile.requestBody ?? {}),
  };

  // 使用 AbortController 处理超时，并与调用方传入的 signal 组合
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

  // 组合中止信号：调用方取消或超时任一触发都应中止请求
  let effectiveSignal: AbortSignal;
  if (signal) {
    // 如果调用方传入了 signal，则把它与当前 signal 串联
    const composite = new AbortController();
    const cancelOnCaller = () => composite.abort(signal.reason);
    const cancelOnTimeout = () => composite.abort(new DOMException("Model request timed out", "TimeoutError"));
    signal.addEventListener("abort", cancelOnCaller, { once: true });
    timeoutController.signal.addEventListener("abort", cancelOnTimeout, { once: true });
    effectiveSignal = composite.signal;
  } else {
    effectiveSignal = timeoutController.signal;
  }

  let response: Response;
  let lastError: Error | null = null;

  // DEBUG：记录实际请求 URL 与打码后的 apiKey
  const maskedKey = profile.apiKey
    ? `${profile.apiKey.slice(0, 6)}...${profile.apiKey.slice(-4)} (len=${profile.apiKey.length})`
    : "(empty)";
  console.info(`[model-client] POST ${url} | apiKey=${maskedKey} | model=${profile.model}`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: effectiveSignal,
      });

      if (!response.ok) {
        if (isRetryableError(null, response) && attempt < MAX_RETRIES) {
          const detail = await response.text().catch(() => "(no body)");
          lastError = new Error(`Model API error ${response.status}: ${detail}`);
          console.warn(
            `[model-client] Retryable error ${response.status}, attempt ${attempt + 1}/${MAX_RETRIES}. Retrying in ${RETRY_DELAYS[attempt]}ms...`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        // 不可重试的 HTTP 错误
        clearTimeout(timeoutHandle);
        const detail = await response.text().catch(() => "(no body)");
        throw new Error(
          `Model API error ${response.status} ${response.statusText}: ${detail}`,
        );
      }

      // 成功后跳出重试循环
      break;
    } catch (err) {
      // 用户主动中断，不进行重试
      if (err instanceof Error && err.name === "AbortError") {
        clearTimeout(timeoutHandle);
        throw new Error(`Model request timed out after ${timeoutMs}ms`);
      }

      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[model-client] Network error, attempt ${attempt + 1}/${MAX_RETRIES}. Retrying in ${RETRY_DELAYS[attempt]}ms...`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }

      clearTimeout(timeoutHandle);
      throw err;
    }
  }

  // 如果重试耗尽仍未成功，则抛出最后一次错误
  if (!response!) {
    clearTimeout(timeoutHandle);
    throw lastError ?? new Error("Model request failed after retries");
  }

  clearTimeout(timeoutHandle);

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (isEventStream || response.body) {
    const result = await consumeSseStream(response, onDelta);
    return {
      content: result.content,
      ...(result.reasoning ? { reasoning: result.reasoning } : {}),
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  }

  // 非流式 JSON 响应（例如 stream: false 的连通性测试）
  const rawBody = await response.text();
  const parsed = tryParseJson(rawBody);
  const content = extractText(
    parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { choices?: unknown }).choices)
      ? ((parsed as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]?.message?.content)
      : null,
  ) ?? "";

  return {
    content,
    toolCalls: [],
    finishReason: null,
  };
}
