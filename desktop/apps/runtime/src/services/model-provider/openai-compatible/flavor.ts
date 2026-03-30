import type { ModelProfile } from "@myclaw-desktop/shared";

import { normalizeBaseUrl } from "../shared/http";
import type { OpenAiCompatibleFlavor } from "./types";

/** 根据 baseUrl 与 model 判断 OpenAI-compatible 厂商差异。 */
export function resolveOpenAiCompatibleFlavor(profile: ModelProfile): OpenAiCompatibleFlavor {
  const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl).toLowerCase();
  const normalizedModel = profile.model.toLowerCase();

  if (normalizedBaseUrl.includes("dashscope.aliyuncs.com") || normalizedModel.startsWith("qwen")) {
    return "qwen";
  }

  if (normalizedBaseUrl.includes("minimax") || normalizedBaseUrl.includes("minimaxi")) {
    return "minimax";
  }

  return "generic";
}

/** Qwen 的 tool-call 不支持 stream=true，这里统一做能力裁剪。 */
export function shouldStreamOpenAiCompatibleStep(input: {
  profile: ModelProfile;
  includeTools: boolean;
  requestedStream: boolean;
}): boolean {
  if (!input.requestedStream) {
    return false;
  }

  const flavor = resolveOpenAiCompatibleFlavor(input.profile);
  if (flavor === "qwen" && input.includeTools) {
    return false;
  }

  return true;
}
