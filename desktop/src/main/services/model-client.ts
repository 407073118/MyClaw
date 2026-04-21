/**
 * 主进程使用的 OpenAI 兼容（以及 Anthropic）模型客户端。
 * 仅使用原生 fetch，自包含实现，不依赖 desktop 其他包。
 */

import type {
  ExecutionPlan,
  ModelProfile,
  ProtocolTarget,
  SessionReplayPolicy,
} from "@shared/contracts";
import { isBrMiniMaxProfile } from "@shared/br-minimax";

import {
  getProviderAdapter,
  type ProviderAdapterMessage,
  type ProviderAdapterRequestInput,
  type ProviderAdapterTool,
} from "./provider-adapters";
import { consumeSseStream, extractText, tryParseJson } from "./model-sse-parser";
import { executeRequestVariants } from "./model-transport";

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

type AdapterExecutionPlan = Pick<ExecutionPlan, "adapterId" | "replayPolicy"> & {
  reasoningEnabled?: boolean;
  reasoningEffort?: string;
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
  executionPlan?: AdapterExecutionPlan | null;
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
  /** 流是否正常结束。false 表示连接异常截断（未收到 [DONE] 或 finish_reason）。 */
  streamCompleted: boolean;
  usage?: TokenUsage;
  transport?: {
    requestVariantId: string;
    fallbackReason?: string | null;
    retryCount: number;
    variantIndex: number;
    streamRetryCount?: number;
    fallbackEvents?: Array<{
      fromVariant: string;
      toVariant: string;
      reason: string;
    }>;
  };
};

/** SSE 累积完成后得到的完整工具调用对象。 */
export type ResolvedToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  input: Record<string, unknown>;
};

type RequestTool = NonNullable<ModelCallOptions["tools"]>[number];
type BuildRequestBodyVariantsInput = {
  profile: ModelProfile;
  messages: Array<Record<string, unknown>>;
  tools?: RequestTool[];
  adapterId?: ExecutionPlan["adapterId"];
  reasoningEnabled?: boolean;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
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

/**
 * 判断当前 Base URL 是否指向阿里云 Coding Plan 专属域名。
 */
function isCodingDashscopeBaseUrl(baseUrl: string): boolean {
  return normalizeBaseUrl(baseUrl).toLowerCase().includes("coding.dashscope.aliyuncs.com");
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
  // 域名级匹配：检查 URL host 部分是否包含 minimax，避免路径中偶然出现 minimax 导致误判
  if (isBrMiniMaxProfile(profile)
    || profile.providerFlavor === "minimax-anthropic"
    || /[:./]minimax[i]?\./.test(lowerUrl)
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
export function resolveModelEndpointUrl(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "model">,
  protocolTarget?: ProtocolTarget,
): string {
  return resolveProtocolEndpointUrl(
    profile,
    protocolTarget ?? (profile.provider === "anthropic" || profile.providerFlavor === "anthropic"
      ? "anthropic-messages"
      : "openai-chat-compatible"),
  );
}

/** 按协议目标解析真正的接口地址，避免“协议选对了但 URL 还停留在旧路径”。 */
export function resolveProtocolEndpointUrl(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "model">,
  protocolTarget: ProtocolTarget,
): string {
  const normalized = normalizeBaseUrl(profile.baseUrl);
  const cleaned = stripKnownEndpointSuffixes(normalized);

  if (protocolTarget === "openai-chat-compatible") {
    const root = resolveApiRoot(profile as ModelProfile);
    return appendIfMissing(root, "/chat/completions");
  }

  if (protocolTarget === "openai-responses") {
    const root = resolveApiRoot(profile as ModelProfile);
    return appendIfMissing(root, "/responses");
  }

  if (protocolTarget === "anthropic-messages" && isCodingDashscopeBaseUrl(cleaned)) {
    const anthropicRoot = cleaned.toLowerCase().includes("/apps/anthropic")
      ? cleaned
      : `${cleaned}/apps/anthropic`;
    return appendIfMissing(anthropicRoot, "/messages");
  }

  const protocolRoot = profile.baseUrlMode === "provider-root"
    ? appendIfMissing(cleaned, "/v1")
    : cleaned;

  if (protocolTarget === "anthropic-messages") {
    return appendIfMissing(protocolRoot, "/messages");
  }
  return appendIfMissing(protocolRoot, "/responses");
}

// ---------------------------------------------------------------------------
// 请求头
// ---------------------------------------------------------------------------

/** 根据 provider 类型构造统一请求头，供聊天、探测与目录接口复用。 */
export function buildRequestHeaders(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "apiKey" | "model" | "headers" | "responsesApiConfig">,
  protocolTarget?: ProtocolTarget,
): Record<string, string> {
  return buildProtocolRequestHeaders(
    profile,
    protocolTarget ?? (profile.provider === "anthropic" || profile.providerFlavor === "anthropic"
      ? "anthropic-messages"
      : "openai-chat-compatible"),
  );
}

/** 按协议目标构造请求头，允许兼容 Anthropic 路由时继续使用 Bearer 认证。 */
export function buildProtocolRequestHeaders(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "apiKey" | "model" | "headers" | "responsesApiConfig">,
  protocolTarget: ProtocolTarget,
): Record<string, string> {
  const flavor = resolveProviderFlavor(profile as ModelProfile);

  const base: Record<string, string> = {
    "content-type": "application/json",
  };

  const usesAnthropicNativeHeaders = protocolTarget === "anthropic-messages"
    && (profile.provider === "anthropic" || flavor === "anthropic");

  if (usesAnthropicNativeHeaders) {
    base["x-api-key"] = profile.apiKey;
    base["anthropic-version"] = "2023-06-01";
  } else {
    base["authorization"] = `Bearer ${profile.apiKey}`;
  }
  if (
    protocolTarget === "openai-responses"
    && (flavor === "qwen" || flavor === "qwen-coding")
    && (profile.responsesApiConfig?.sessionCache === "enable" || profile.responsesApiConfig?.sessionCache === "disable")
  ) {
    base["x-dashscope-session-cache"] = profile.responsesApiConfig.sessionCache;
  }

  // 允许通过 profile 覆盖请求头（例如自定义认证方案）。
  return { ...base, ...(profile.headers ?? {}) };
}

// ---------------------------------------------------------------------------
// 重试逻辑
// ---------------------------------------------------------------------------

/** 临时性 API 错误的最大重试次数（transport 层连接阶段）。 */
const MAX_RETRIES = 3;

/** 指数退避等待时长（毫秒）：1s → 2s → 4s。 */
const RETRY_DELAYS = [1000, 2000, 4000];

/** 流式响应异常截断后的最大重试次数。 */
const STREAM_RETRY_MAX = 3;

/** 流式重试退避时长（毫秒）：2s → 4s → 8s，比连接重试更宽松。 */
const STREAM_RETRY_DELAYS = [2000, 4000, 8000];

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

/** 解析本轮请求应采用的 replay 策略，优先使用 execution plan。 */
function resolveReplayPolicy(
  profile: ModelProfile,
  executionPlan?: Pick<ExecutionPlan, "replayPolicy"> | null,
): SessionReplayPolicy {
  if (executionPlan?.replayPolicy) {
    return executionPlan.replayPolicy;
  }
  return isBrMiniMaxProfile(profile) ? "assistant-turn-with-reasoning" : "content-only";
}

/** 根据 replay 策略物化发送给 adapter 的标准消息数组。 */
function buildWireMessages(
  messages: ChatMessage[],
  replayPolicy: SessionReplayPolicy,
): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const base: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };

    const shouldReplayReasoning = message.role === "assistant"
      && replayPolicy === "assistant-turn-with-reasoning";
    if (shouldReplayReasoning) {
      // 始终包含 reasoning，即使为空。
      // 启用 thinking 的 API 要求所有 assistant 消息都带此字段。
      base["reasoning"] = message.reasoning || "";
    }
    if (message.tool_call_id) {
      base["tool_call_id"] = message.tool_call_id;
    }
    if (message.tool_calls && message.tool_calls.length > 0) {
      base["tool_calls"] = message.tool_calls;
    }
    return base;
  });
}

/** 构建 provider-aware 请求体变体，优先返回最佳实践请求，再返回兼容回退。 */
export function buildRequestBodyVariants(input: BuildRequestBodyVariantsInput): Record<string, unknown>[] {
  const adapter = getProviderAdapter(input.adapterId ?? input.profile);
  const adapterInput: ProviderAdapterRequestInput = {
    messages: input.messages as ProviderAdapterMessage[],
    tools: input.tools as ProviderAdapterTool[] | undefined,
  };
  const replayMessages = adapter.materializeReplayMessages(
    {
      profile: input.profile,
      reasoningEnabled: input.reasoningEnabled,
      reasoningEffort: input.reasoningEffort,
    },
    adapterInput,
  );
  return adapter.prepareRequest(
    {
      profile: input.profile,
      reasoningEnabled: input.reasoningEnabled,
      reasoningEffort: input.reasoningEffort,
    },
    { ...adapterInput, messages: replayMessages },
  ).map((variant) => variant.body);
}

/**
 * 调用模型并流式返回内容。
 *
 * 支持 OpenAI 兼容提供商（包括 dashscope / Qwen 变体）以及 Anthropic。
 * 提供商特定的请求头与 URL 路径会根据 `options.profile` 自动解析。
 *
 * 工具调用会跨多个 SSE 帧累计，最终通过 `toolCalls` 返回。
 */
export async function callModel(options: ModelCallOptions): Promise<ModelCallResult> {
  const {
    profile,
    messages,
    tools,
    onDelta,
    onToolCallDelta,
    signal,
    timeoutMs = 120_000,
    executionPlan,
  } = options;

  const url = resolveModelEndpointUrl(profile);
  const headers = buildRequestHeaders(profile);
  const adapter = getProviderAdapter(executionPlan?.adapterId ?? profile);
  const replayPolicy = resolveReplayPolicy(profile, executionPlan ?? null);

  // 构建发送给接口的消息列表，并按 replay policy 决定是否保留 reasoning。
  const wireMessages = buildWireMessages(messages, replayPolicy);
  const adapterInput: ProviderAdapterRequestInput = {
    messages: wireMessages as ProviderAdapterMessage[],
    tools: tools as ProviderAdapterTool[] | undefined,
  };
  const adapterContext = {
    profile,
    reasoningEnabled: (executionPlan as { reasoningEnabled?: boolean } | null)?.reasoningEnabled,
    reasoningEffort: (executionPlan as { reasoningEffort?: "low" | "medium" | "high" | "xhigh" } | null)?.reasoningEffort,
  };
  const replayMessages = adapter.materializeReplayMessages(
    adapterContext,
    adapterInput,
  );
  const requestVariants = adapter.prepareRequest(
    adapterContext,
    { ...adapterInput, messages: replayMessages },
  );

  // DEBUG：记录实际请求 URL 与打码后的 apiKey
  const maskedKey = profile.apiKey
    ? `${profile.apiKey.slice(0, 6)}...${profile.apiKey.slice(-4)} (len=${profile.apiKey.length})`
    : "(empty)";

  // 流级别重试循环：当 SSE 流异常截断（未收到 [DONE] 或 finish_reason）时，
  // 整体重发请求。对比 transport 层只覆盖连接建立阶段，此处覆盖流式传输阶段。
  for (let streamAttempt = 0; ; streamAttempt++) {
    // 在每次重试前检查调用方是否已中止
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Aborted", "AbortError");
    }

    if (streamAttempt > 0) {
      console.info(`[model-client] Stream retry attempt ${streamAttempt}/${STREAM_RETRY_MAX} for ${profile.model}`);
    }

    console.info(`[model-client] POST ${url} | apiKey=${maskedKey} | model=${profile.model} | adapter=${adapter.id} | reasoningEnabled=${adapterContext.reasoningEnabled ?? "(auto)"} | reasoningEffort=${adapterContext.reasoningEffort ?? "(none)"} | tools=${tools?.length ?? 0}${streamAttempt > 0 ? ` | streamRetry=${streamAttempt}` : ""}`);
    const transportResult = await executeRequestVariants({
      url,
      headers,
      requestVariants,
      signal,
      timeoutMs,
      maxRetries: MAX_RETRIES,
      retryDelaysMs: RETRY_DELAYS,
      isRetryableError,
    });
    const { response } = transportResult;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const isEventStream = contentType.includes("text/event-stream");

    if (isEventStream) {
      const result = await consumeSseStream(response, onDelta, onToolCallDelta);

      // 流异常截断检测：未收到 [DONE] 且没有 finish_reason
      if (!result.streamCompleted && streamAttempt < STREAM_RETRY_MAX) {
        const delay = STREAM_RETRY_DELAYS[Math.min(streamAttempt, STREAM_RETRY_DELAYS.length - 1)] ?? 4000;
        console.warn(
          `[model-client] Stream interrupted without completion signal (finishReason=${result.finishReason}, content=${result.content.length} chars, toolCalls=${result.toolCalls.length}). Retrying in ${delay}ms...`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!result.streamCompleted) {
        console.warn(`[model-client] Stream incomplete after ${STREAM_RETRY_MAX} retries, returning partial result`);
      }

      return {
        content: result.content,
        ...(result.reasoning ? { reasoning: result.reasoning } : {}),
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        streamCompleted: result.streamCompleted,
        ...(result.usage ? { usage: result.usage } : {}),
        transport: {
          requestVariantId: transportResult.variant.id,
          fallbackReason: transportResult.variant.fallbackReason ?? null,
          retryCount: transportResult.attempt,
          variantIndex: transportResult.variantIndex,
          streamRetryCount: streamAttempt,
          fallbackEvents: transportResult.fallbackEvents,
        },
      };
    }

    // 非流式 JSON 响应（例如 stream: false 的连通性测试）
    const rawBody = await response.text();
    const parsed = tryParseJson(rawBody);
    const normalized = adapter.normalizeResponse(parsed);

    return {
      content: normalized.content ?? "",
      ...(normalized.reasoning ? { reasoning: normalized.reasoning } : {}),
      toolCalls: normalized.toolCalls ?? [],
      finishReason: normalized.finishReason ?? null,
      streamCompleted: true,
      ...(normalized.usage ? { usage: normalized.usage } : {}),
      transport: {
        requestVariantId: transportResult.variant.id,
        fallbackReason: transportResult.variant.fallbackReason ?? null,
        retryCount: transportResult.attempt,
        variantIndex: transportResult.variantIndex,
        streamRetryCount: streamAttempt,
        fallbackEvents: transportResult.fallbackEvents,
      },
    };
  }
}
