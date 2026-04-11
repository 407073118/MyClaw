import type { ModelProfile } from "@shared/contracts";
import { isBrMiniMaxProfile } from "@shared/br-minimax";
import { inferVendorFamily } from "../model-runtime/vendor-runtime-policy-resolver";

import type { ProviderAdapter, ProviderAdapterId } from "./base";
import { anthropicNativeAdapter } from "./anthropic-native";
import { kimiAdapter } from "./kimi";
import { minimaxAdapter } from "./minimax";
import { minimaxCompatibleAdapter } from "./minimax-compatible";
import { openAiNativeAdapter } from "./openai-native";
import { openAiCompatibleAdapter } from "./openai-compatible";
import { qwenAdapter } from "./qwen";
import { volcengineArkAdapter } from "./volcengine-ark";

const ADAPTERS: Record<ProviderAdapterId, ProviderAdapter> = {
  "openai-compatible": openAiCompatibleAdapter,
  "openai-native": openAiNativeAdapter,
  "anthropic-native": anthropicNativeAdapter,
  "qwen": qwenAdapter,
  "kimi": kimiAdapter,
  "volcengine-ark": volcengineArkAdapter,
  "minimax": minimaxCompatibleAdapter,
  "br-minimax": minimaxAdapter,
};

/** 列出当前已注册的 Provider Adapter，供运行时或测试枚举。 */
export function listProviderAdapters(): ProviderAdapter[] {
  return [
    ADAPTERS["openai-compatible"],
    ADAPTERS["openai-native"],
    ADAPTERS["anthropic-native"],
    ADAPTERS["qwen"],
    ADAPTERS["kimi"],
    ADAPTERS["volcengine-ark"],
    ADAPTERS["minimax"],
    ADAPTERS["br-minimax"],
  ];
}

/** 根据 profile 推导当前 Phase 1 应选择的 adapter。 */
export function resolveProviderAdapterId(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model" | "vendorFamily" | "deploymentProfile">,
): ProviderAdapterId {
  const vendorFamily = inferVendorFamily(profile);

  // 先兼容 BR MiniMax 的既有专用链路；其它一梯队厂商当前仍通过 openai-compatible
  // 主链运行，等后续专用 adapter 深化后再在各自文件中补 request/replay 差异。
  if (isBrMiniMaxProfile(profile) || (vendorFamily === "minimax" && profile.deploymentProfile === "br-private")) {
    return "br-minimax";
  }

  switch (vendorFamily) {
    case "openai":
      return "openai-native";
    case "anthropic":
      return "anthropic-native";
    case "qwen":
      return "qwen";
    case "kimi":
      return "kimi";
    case "volcengine-ark":
      return "volcengine-ark";
    case "minimax":
      return "minimax";
    default:
      return "openai-compatible";
  }
}

/** 按显式 id 或 profile 选择 adapter，统一运行时入口。 */
export function getProviderAdapter(
  input: ProviderAdapterId | Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model" | "vendorFamily" | "deploymentProfile">,
): ProviderAdapter {
  const id = typeof input === "string" ? input : resolveProviderAdapterId(input);
  return ADAPTERS[id];
}

export type * from "./base";
export { anthropicNativeAdapter } from "./anthropic-native";
export { kimiAdapter } from "./kimi";
export { minimaxAdapter } from "./minimax";
export { minimaxCompatibleAdapter } from "./minimax-compatible";
export { openAiNativeAdapter } from "./openai-native";
export { openAiCompatibleAdapter } from "./openai-compatible";
export { qwenAdapter } from "./qwen";
export { volcengineArkAdapter } from "./volcengine-ark";
