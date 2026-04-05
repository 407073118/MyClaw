import type { ModelProfile } from "@shared/contracts";
import { isBrMiniMaxProfile } from "@shared/br-minimax";

import type { ProviderAdapter, ProviderAdapterId } from "./base";
import { minimaxAdapter } from "./minimax";
import { openAiCompatibleAdapter } from "./openai-compatible";

const ADAPTERS: Record<ProviderAdapterId, ProviderAdapter> = {
  "br-minimax": minimaxAdapter,
  "openai-compatible": openAiCompatibleAdapter,
};

/** 列出当前已注册的 Provider Adapter，供运行时或测试枚举。 */
export function listProviderAdapters(): ProviderAdapter[] {
  return [ADAPTERS["br-minimax"], ADAPTERS["openai-compatible"]];
}

/** 根据 profile 推导当前 Phase 1 应选择的 adapter。 */
export function resolveProviderAdapterId(
  profile: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model">,
): ProviderAdapterId {
  return isBrMiniMaxProfile(profile) ? "br-minimax" : "openai-compatible";
}

/** 按显式 id 或 profile 选择 adapter，统一运行时入口。 */
export function getProviderAdapter(
  input: ProviderAdapterId | Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "model">,
): ProviderAdapter {
  const id = typeof input === "string" ? input : resolveProviderAdapterId(input);
  return ADAPTERS[id];
}

export type * from "./base";
export { minimaxAdapter } from "./minimax";
export { openAiCompatibleAdapter } from "./openai-compatible";
