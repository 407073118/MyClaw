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
    const flavor = resolveAnthropicFlavor({
      ...profile,
      baseUrl: normalizedBaseUrl,
    });
    if (flavor === "minimax") {
      return appendMiniMaxAnthropicRoot(normalizedBaseUrl);
    }
    return appendPathSegment(normalizedBaseUrl, "/v1");
  }

  if (profile.provider !== "openai-compatible") {
    return normalizedBaseUrl;
  }

  const flavor = resolveOpenAiCompatibleFlavor({
    ...profile,
    baseUrl: normalizedBaseUrl,
  });

  if (flavor === "qwen") {
    return appendPathSegment(normalizedBaseUrl, "/compatible-mode/v1");
  }

  return appendPathSegment(normalizedBaseUrl, "/v1");
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
