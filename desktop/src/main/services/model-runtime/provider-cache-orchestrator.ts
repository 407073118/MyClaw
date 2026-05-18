import type { ProviderFamily, TurnOutcomeUsage, VendorFamily } from "@shared/contracts";

type ProviderCacheIdentity = VendorFamily | ProviderFamily | string;

const MAX_RAW_ARRAY_ITEMS = 20;
const MAX_RAW_STRING_LENGTH = 500;
const MAX_RAW_DEPTH = 4;

/** 判断一个值是否是普通对象，避免把数组和空值当作可排序对象处理。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 按稳定 key 顺序序列化对象，保证同一语义的工具和 prompt 可以得到相同 hash。 */
function stableSerialize(value: unknown): string {
  if (value === undefined) {
    return '"[undefined]"';
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? '"[unserializable]"';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

/** 从 provider usage 对象中安全读取数字字段，空值和非法数字按 undefined 处理。 */
function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const value = record?.[key];
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 从 provider usage 对象中读取嵌套对象字段。 */
function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

/** 截断原始 usage，保留排障必要字段，同时避免把超大对象写入 session/outcome。 */
function sanitizeRawUsage(value: unknown, depth = 0): unknown {
  if (depth >= MAX_RAW_DEPTH) {
    return "[truncated-depth]";
  }
  if (typeof value === "string") {
    return value.length > MAX_RAW_STRING_LENGTH
      ? `${value.slice(0, MAX_RAW_STRING_LENGTH)}...[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_RAW_ARRAY_ITEMS).map((item) => sanitizeRawUsage(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeRawUsage(entry, depth + 1)]),
    );
  }
  return value;
}

/** 计算缓存稳定区 hash，输出短 hash 便于日志和请求参数携带。 */
export function hashCacheStableValue(value: unknown): string {
  const text = stableSerialize(value);
  let left = 0x811c9dc5;
  let right = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193);
    right ^= code + index;
    right = Math.imul(right, 0x811c9dc5);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}${text.length.toString(16).padStart(8, "0")}`;
}

/** 构造 OpenAI Responses 等路线可复用的 prompt cache key。 */
export function buildPromptCacheKey(input: {
  profileId: string;
  stablePrefixHash: string;
  toolBundleHash: string;
}): string {
  const safeProfileId = input.profileId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return `myclaw:${safeProfileId}:${input.stablePrefixHash}:${input.toolBundleHash}`;
}

/** 判断 provider 标识是否属于 Anthropic Messages 原生缓存语义。 */
function isAnthropicLike(identity: ProviderCacheIdentity): boolean {
  const normalized = String(identity).toLowerCase();
  return normalized.includes("anthropic");
}

/** 判断 provider 标识是否属于 DeepSeek 官方自动缓存语义。 */
function isDeepSeekLike(identity: ProviderCacheIdentity): boolean {
  return String(identity).toLowerCase().includes("deepseek");
}

/** 汇总可缓存字段，补齐 total/effective/efficiency 等通用指标。 */
function finalizeUsage(input: {
  identity: ProviderCacheIdentity;
  rawUsage: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  cacheObserved?: boolean;
}): TurnOutcomeUsage {
  const cachedInputTokens = input.cachedInputTokens
    ?? input.cacheHitInputTokens
    ?? input.cacheReadInputTokens
    ?? 0;
  const cacheMissInputTokens = input.cacheMissInputTokens
    ?? (input.promptTokens > 0 ? Math.max(input.promptTokens - cachedInputTokens, 0) : undefined);
  const effectiveBillableInputTokens = input.promptTokens > 0
    ? Math.max(input.promptTokens - cachedInputTokens, 0)
    : undefined;
  const cacheEfficiency = input.promptTokens > 0
    ? cachedInputTokens / input.promptTokens
    : undefined;
  const cacheObserved = input.cacheObserved === true;

  const usage: TurnOutcomeUsage = {
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens ?? (input.promptTokens + input.completionTokens),
    ...(input.reasoningTokens !== undefined ? { reasoningTokens: input.reasoningTokens } : {}),
    ...(cacheObserved && cachedInputTokens >= 0 ? { cachedInputTokens } : {}),
    ...(cacheObserved && input.cacheHitInputTokens !== undefined ? { cacheHitInputTokens: input.cacheHitInputTokens } : {}),
    ...(cacheObserved && cacheMissInputTokens !== undefined ? { cacheMissInputTokens } : {}),
    ...(cacheObserved && input.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: input.cacheReadInputTokens } : {}),
    ...(cacheObserved && input.cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens: input.cacheWriteInputTokens } : {}),
    ...(cacheObserved && effectiveBillableInputTokens !== undefined ? { effectiveBillableInputTokens } : {}),
    ...(cacheObserved && cacheEfficiency !== undefined ? { cacheEfficiency } : {}),
    rawProviderUsage: sanitizeRawUsage(input.rawUsage) as Record<string, unknown>,
  };

  console.info("[provider-cache] 已归一化模型缓存用量", {
    provider: input.identity,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheHitInputTokens: usage.cacheHitInputTokens ?? usage.cacheReadInputTokens ?? usage.cachedInputTokens ?? 0,
    cacheMissInputTokens: usage.cacheMissInputTokens ?? 0,
    cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
    cacheEfficiency: usage.cacheEfficiency ?? 0,
  });

  return usage;
}

/** 把 DeepSeek / Anthropic / OpenAI-Compatible usage 字段统一成 TurnOutcomeUsage。 */
export function normalizeProviderCacheUsage(
  vendorFamily: ProviderCacheIdentity,
  rawUsage: Record<string, unknown> | null | undefined,
): TurnOutcomeUsage | undefined {
  if (!rawUsage) {
    return undefined;
  }

  const promptTokens = readNumber(rawUsage, "prompt_tokens")
    ?? readNumber(rawUsage, "input_tokens")
    ?? 0;
  const completionTokens = readNumber(rawUsage, "completion_tokens")
    ?? readNumber(rawUsage, "output_tokens")
    ?? 0;
  const totalTokens = readNumber(rawUsage, "total_tokens");
  const reasoningTokens = readNumber(rawUsage, "reasoning_tokens")
    ?? readNumber(readRecord(rawUsage, "completion_tokens_details"), "reasoning_tokens")
    ?? readNumber(readRecord(rawUsage, "output_tokens_details"), "reasoning_tokens");

  if (
    isDeepSeekLike(vendorFamily)
    || rawUsage.prompt_cache_hit_tokens !== undefined
    || rawUsage.prompt_cache_miss_tokens !== undefined
  ) {
    const cacheHitInputTokens = readNumber(rawUsage, "prompt_cache_hit_tokens") ?? 0;
    const cacheMissInputTokens = readNumber(rawUsage, "prompt_cache_miss_tokens");
    return finalizeUsage({
      identity: vendorFamily,
      rawUsage,
      promptTokens,
      completionTokens,
      totalTokens,
      reasoningTokens,
      cachedInputTokens: cacheHitInputTokens,
      cacheHitInputTokens,
      cacheMissInputTokens,
      cacheObserved: true,
    });
  }

  if (
    isAnthropicLike(vendorFamily)
    || rawUsage.cache_read_input_tokens !== undefined
    || rawUsage.cache_creation_input_tokens !== undefined
  ) {
    const cacheReadInputTokens = readNumber(rawUsage, "cache_read_input_tokens") ?? 0;
    const cacheWriteInputTokens = readNumber(rawUsage, "cache_creation_input_tokens") ?? 0;
    return finalizeUsage({
      identity: vendorFamily,
      rawUsage,
      promptTokens,
      completionTokens,
      totalTokens,
      reasoningTokens,
      cachedInputTokens: cacheReadInputTokens,
      cacheHitInputTokens: cacheReadInputTokens,
      cacheReadInputTokens,
      cacheWriteInputTokens,
      cacheObserved: true,
    });
  }

  const inputDetails = readRecord(rawUsage, "input_tokens_details");
  const promptDetails = readRecord(rawUsage, "prompt_tokens_details");
  const cachedTokenValue = readNumber(inputDetails, "cached_tokens")
    ?? readNumber(promptDetails, "cached_tokens")
    ?? readNumber(rawUsage, "cached_tokens");
  const cachedInputTokens = cachedTokenValue ?? 0;

  return finalizeUsage({
    identity: vendorFamily,
    rawUsage,
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    cachedInputTokens,
    cacheHitInputTokens: cachedInputTokens,
    cacheObserved: cachedTokenValue !== undefined,
  });
}
