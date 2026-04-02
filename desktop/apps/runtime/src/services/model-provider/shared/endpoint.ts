import type { ModelProfile } from "@myclaw-desktop/shared";

import { resolveAnthropicFlavor } from "../anthropic/flavor";
import { resolveOpenAiCompatibleFlavor } from "../openai-compatible/flavor";
import { normalizeBaseUrl } from "./http";

/** 在 provider-root 模式下补齐厂商约定的 API 根路径，手动模式保持原始地址。 */
export function resolveProviderApiBaseUrl(profile: ModelProfile): string {
  const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl);
  if (profile.baseUrlMode !== "provider-root") {
    return normalizedBaseUrl;
  }

  if (profile.provider === "anthropic") {
    const cleanedBaseUrl = stripKnownEndpointSuffixes(normalizedBaseUrl);
    const flavor = resolveAnthropicFlavor({
      ...profile,
      baseUrl: cleanedBaseUrl,
    });
    if (flavor === "minimax") {
      return appendMiniMaxAnthropicRoot(cleanedBaseUrl);
    }
    return appendPathSegment(cleanedBaseUrl, "/v1");
  }

  if (profile.provider !== "openai-compatible") {
    return normalizedBaseUrl;
  }

  // 用户可能误填了完整端点路径（如 .../v1/chat/completions），先剥离到根。
  const cleanedBaseUrl = stripKnownEndpointSuffixes(normalizedBaseUrl);

  const flavor = resolveOpenAiCompatibleFlavor({
    ...profile,
    baseUrl: cleanedBaseUrl,
  });

  if (flavor === "qwen") {
    return appendPathSegment(cleanedBaseUrl, "/compatible-mode/v1");
  }

  // qwen-coding (coding.dashscope.aliyuncs.com) 走标准 OpenAI 路径，不需要 /compatible-mode。
  return appendPathSegment(cleanedBaseUrl, "/v1");
}

/**
 * 剥离用户可能误填到 baseUrl 中的已知 API 端点路径。
 * 例如 `https://dashscope.aliyuncs.com/api/v1/chat/completions`
 * → `https://dashscope.aliyuncs.com/api`
 */
function stripKnownEndpointSuffixes(baseUrl: string): string {
  const suffixes = [
    "/chat/completions",
    "/compatible-mode/v1",
    "/v1/messages",
    "/v1",
  ];
  let url = baseUrl;
  for (const suffix of suffixes) {
    if (url.toLowerCase().endsWith(suffix.toLowerCase())) {
      url = url.slice(0, -suffix.length);
    }
  }
  return normalizeBaseUrl(url) || baseUrl;
}

/** 仅在路径片段缺失时追加，避免重复拼接 `/v1`。 */
function appendPathSegment(baseUrl: string, suffix: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl.toLowerCase().endsWith(suffix.toLowerCase())) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl}${suffix}`;
}

/** 将 MiniMax Anthropic 根地址规整到官方 `/anthropic` 路径。 */
function appendMiniMaxAnthropicRoot(baseUrl: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const loweredBaseUrl = normalizedBaseUrl.toLowerCase();

  if (loweredBaseUrl.endsWith("/anthropic")) {
    return normalizedBaseUrl;
  }

  if (loweredBaseUrl.endsWith("/anthropic/v1")) {
    return normalizedBaseUrl.slice(0, -3);
  }

  if (loweredBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl.slice(0, -3)}/anthropic`;
  }

  return `${normalizedBaseUrl}/anthropic`;
}
