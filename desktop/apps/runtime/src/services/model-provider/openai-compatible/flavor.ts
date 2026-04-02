import type { ModelProfile } from "@myclaw-desktop/shared";

import { normalizeBaseUrl } from "../shared/http";
import type { OpenAiCompatibleFlavor } from "./types";

/** 根据 baseUrl 与 model 判断 OpenAI-compatible 厂商差异。 */
export function resolveOpenAiCompatibleFlavor(profile: ModelProfile): OpenAiCompatibleFlavor {
  const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl).toLowerCase();
  const normalizedModel = profile.model.toLowerCase();

  if (normalizedBaseUrl.includes("dashscope.aliyuncs.com") || normalizedModel.startsWith("qwen")) {
    // coding.dashscope.aliyuncs.com 是标准 OpenAI 兼容接口，不需要 /compatible-mode 前缀。
    if (normalizedBaseUrl.includes("coding.dashscope")) {
      return "qwen-coding";
    }
    return "qwen";
  }

  if (normalizedBaseUrl.includes("minimax") || normalizedBaseUrl.includes("minimaxi")) {
    return "minimax";
  }

  return "generic";
}

/** 判断是否为 Qwen 系列（含 coding 子域名变体）。 */
export function isQwenFlavor(flavor: OpenAiCompatibleFlavor): boolean {
  return flavor === "qwen" || flavor === "qwen-coding";
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
  // 只有 compatible-mode 接口 (qwen) 不支持 stream + tools，coding.dashscope (qwen-coding) 支持。
  if (flavor === "qwen" && input.includeTools) {
    return false;
  }

  return true;
}
