import type { ModelProfile } from "@myclaw-desktop/shared";

import { normalizeBaseUrl } from "../shared/http";

export type AnthropicFlavor = "generic" | "minimax";

/** 根据 baseUrl 与 model 判断 Anthropic-compatible 厂商差异。 */
export function resolveAnthropicFlavor(profile: ModelProfile): AnthropicFlavor {
  const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl).toLowerCase();
  const normalizedModel = profile.model.toLowerCase();

  if (
    normalizedBaseUrl.includes("minimax") ||
    normalizedBaseUrl.includes("minimaxi") ||
    normalizedModel.startsWith("minimax")
  ) {
    return "minimax";
  }

  return "generic";
}
