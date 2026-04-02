/**
 * OpenAI-compatible (and Anthropic) model client for the main process.
 * Uses native fetch only. Self-contained — no imports from desktop packages.
 */

import type { ModelProfile } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
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

/** Token usage from the API response. */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Result returned after a single streaming model call. */
export type ModelCallResult = {
  content: string;
  reasoning?: string;
  toolCalls: ResolvedToolCall[];
  finishReason: string | null;
  usage?: TokenUsage;
};

/** A fully materialised tool call after SSE accumulation. */
export type ResolvedToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  input: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * Normalise a base URL by stripping trailing slashes.
 */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Strip known endpoint suffixes that users may accidentally include in the
 * baseUrl field, so that we can safely append the correct suffix ourselves.
 *
 * E.g. "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
 *  →   "https://dashscope.aliyuncs.com"
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
 * Determine which URL and header flavour to use for a given profile.
 *
 * Logic mirrors desktop runtime's resolveOpenAiCompatibleFlavor +
 * resolveProviderApiBaseUrl without importing those packages.
 */
function resolveProviderFlavor(profile: ModelProfile): ProviderFlavor {
  if (profile.provider === "anthropic") {
    return "anthropic";
  }

  const lowerUrl = normalizeBaseUrl(profile.baseUrl).toLowerCase();
  const lowerModel = profile.model.toLowerCase();

  if (lowerUrl.includes("dashscope.aliyuncs.com") || lowerModel.startsWith("qwen")) {
    // coding.dashscope uses the standard OpenAI path, not /compatible-mode
    if (lowerUrl.includes("coding.dashscope")) {
      return "qwen-coding";
    }
    return "qwen";
  }

  return "generic";
}

/**
 * Resolve the API root (everything before /chat/completions or /v1/messages).
 *
 * When baseUrlMode is "provider-root" the user has supplied only the host/root
 * and we must append the correct path.  When it's "manual" (or absent) the
 * user has already given us a complete URL base and we just normalise it.
 */
function resolveApiRoot(profile: ModelProfile): string {
  const normalized = normalizeBaseUrl(profile.baseUrl);

  if (profile.baseUrlMode !== "provider-root") {
    // In manual mode the user may still have included path suffixes; keep as-is.
    return normalized;
  }

  // provider-root: strip any accidental suffixes first.
  const cleaned = stripKnownEndpointSuffixes(normalized);
  const flavor = resolveProviderFlavor(profile);

  switch (flavor) {
    case "anthropic":
      // Anthropic root → append /v1
      return appendIfMissing(cleaned, "/v1");

    case "qwen":
      // Non-coding dashscope requires /compatible-mode/v1
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
 * Build the full chat completions (or Anthropic messages) endpoint URL.
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
// Headers
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

  // Allow profile-level header overrides (e.g. custom auth schemes).
  return { ...base, ...(profile.headers ?? {}) };
}

// ---------------------------------------------------------------------------
// SSE parsing helpers
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
 * Try to read a string out of a value that may be a plain string, an array of
 * content parts, or a nested object with a "text" field (Anthropic style).
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
 * Read reasoning/thinking delta from an OpenAI-compatible delta object.
 * Checks all known field names used across providers.
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
 * Apply a single parsed SSE payload chunk to the accumulated state and fire
 * the onDelta callback.
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

  // --- tool_calls (index-keyed accumulation for parallel tool calls) ---
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

  // --- usage (some providers send usage in the final SSE chunk) ---
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
 * Parse a JSON string — returns null on any error.
 */
function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Materialise accumulated tool-call fragments into resolved calls.
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
        // keep empty object
      }
      return { id: acc.id, name: acc.name, argumentsJson, input };
    });
}

// ---------------------------------------------------------------------------
// Core streaming consumer
// ---------------------------------------------------------------------------

/**
 * Read an SSE response body and accumulate content, reasoning, and tool calls.
 *
 * Handles \r\n and \n line endings, trailing buffer, and malformed chunks.
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
    // No streaming body — fall back to reading the full text and treating each
    // line as a potential SSE data line.
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
    // Normalise Windows line endings
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

  // Flush any remaining content in the buffer (no trailing newline)
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
// Retry logic
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts for transient API errors. */
const MAX_RETRIES = 3;

/** Exponential backoff delays in milliseconds: 1s → 2s → 4s. */
const RETRY_DELAYS = [1000, 2000, 4000];

/**
 * Determine whether an error or HTTP response status is retryable.
 *
 * Retryable: network errors, timeouts, 429 (rate limit), 5xx (server errors).
 * Not retryable: user abort, 400/401/403/404 (client errors).
 */
export function isRetryableError(err: unknown, response?: Response | null): boolean {
  // User-initiated abort is never retryable
  if (err instanceof Error && err.name === "AbortError") return false;

  // Network errors (TypeError from fetch) and timeouts are retryable
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === "TimeoutError") return true;

  // HTTP status based retryability
  if (response) {
    const status = response.status;
    return status === 429 || status >= 500;
  }

  // Unknown errors with no response — assume retryable (network issue)
  if (err) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call a model and stream back content.
 *
 * Supports OpenAI-compatible providers (including dashscope / Qwen variants)
 * as well as Anthropic.  Provider-specific headers and URL paths are resolved
 * automatically from `options.profile`.
 *
 * Tool calls are accumulated across SSE frames and returned in `toolCalls`.
 */
export async function callModel(options: ModelCallOptions): Promise<ModelCallResult> {
  const { profile, messages, tools, onDelta, signal, timeoutMs = 120_000 } = options;

  const url = resolveModelEndpointUrl(profile);
  const headers = buildRequestHeaders(profile);

  // Build the wire-format message list; strip internal fields (reasoning, etc.)
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

  // Set up timeout via AbortController, composing with any caller-supplied signal.
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

  // Compose signals: abort if either the caller cancels or timeout fires.
  let effectiveSignal: AbortSignal;
  if (signal) {
    // If the caller provided a signal, chain them.
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
        // Non-retryable HTTP error
        clearTimeout(timeoutHandle);
        const detail = await response.text().catch(() => "(no body)");
        throw new Error(
          `Model API error ${response.status} ${response.statusText}: ${detail}`,
        );
      }

      // Success — break out of retry loop
      break;
    } catch (err) {
      // User abort — never retry
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

  // If we exhausted retries without a successful response, throw the last error
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

  // Non-streaming JSON response (e.g., connectivity test with stream: false)
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
