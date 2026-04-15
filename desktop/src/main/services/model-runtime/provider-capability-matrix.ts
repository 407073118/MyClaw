import type { ModelCapability, ModelProfile } from "@shared/contracts";

export type ProviderNativeCapabilities = {
  supportsNativeWebSearch: boolean;
  supportsNativeWebExtractor: boolean;
  supportsNativeComputer: boolean;
  supportsNativeCodeInterpreter: boolean;
  supportsNativeFileSearch: boolean;
  supportsBackgroundMode: boolean;
  supportsContinuation: boolean;
  supportsToolSearch: boolean;
  supportsCompaction: boolean;
  requiresReasoningReplay: boolean;
  preferredSearchRoute: "vendor-native" | "managed-local";
  preferredComputerRoute: "vendor-native" | "managed-local";
  preferredKnowledgeRoute: "vendor-native" | "disabled";
};

/** 基于 provider family 与已探测能力，统一推断厂商原生能力矩阵。 */
export function resolveProviderNativeCapabilities(
  profile: Pick<ModelProfile, "providerFamily" | "vendorFamily" | "protocolTarget" | "providerFlavor" | "model">,
  capability?: Pick<
    ModelCapability,
    | "supportsTools"
    | "supportsNativeWebSearch"
    | "supportsNativeWebExtractor"
    | "supportsNativeComputer"
    | "supportsNativeCodeInterpreter"
    | "supportsNativeFileSearch"
    | "supportsBackgroundMode"
    | "supportsContinuation"
    | "supportsToolSearch"
    | "supportsCompaction"
    | "requiresReasoningReplay"
  > | null,
): ProviderNativeCapabilities {
  const providerFamily = profile.providerFamily ?? "generic-openai-compatible";
  const protocolTarget = profile.protocolTarget
    ?? (
      providerFamily === "openai-native" || providerFamily === "qwen-native"
        ? "openai-responses"
        : providerFamily === "anthropic-native" || providerFamily === "moonshot-native"
          ? "anthropic-messages"
          : "openai-chat-compatible"
    );
  const canUseNativeTools = capability?.supportsTools !== false;
  const isOpenAiNative = providerFamily === "openai-native" && protocolTarget === "openai-responses";
  const isQwenResponses = providerFamily === "qwen-native" && protocolTarget === "openai-responses";
  const isQwenChatCompatible = providerFamily === "qwen-native" && protocolTarget === "openai-chat-compatible";
  const isMoonshotChatCompatible = providerFamily === "moonshot-native" && protocolTarget === "openai-chat-compatible";
  const isMoonshotAnthropic = providerFamily === "moonshot-native" && protocolTarget === "anthropic-messages";
  // Moonshot chat-compatible currently relies on managed-local tools until a real Formula bridge exists.
  const supportsVendorToolRoute = canUseNativeTools && !isMoonshotAnthropic && !isMoonshotChatCompatible;

  const supportsNativeWebSearch = capability?.supportsNativeWebSearch
    ?? ((isOpenAiNative || isQwenResponses || isQwenChatCompatible || isMoonshotChatCompatible) && supportsVendorToolRoute);
  const supportsNativeWebExtractor = capability?.supportsNativeWebExtractor
    ?? (isQwenResponses && supportsVendorToolRoute);
  const supportsNativeComputer = capability?.supportsNativeComputer
    ?? (isOpenAiNative && canUseNativeTools);
  const supportsNativeCodeInterpreter = capability?.supportsNativeCodeInterpreter
    ?? ((isQwenResponses || isQwenChatCompatible || isMoonshotChatCompatible) && supportsVendorToolRoute);
  const supportsNativeFileSearch = capability?.supportsNativeFileSearch
    ?? ((isOpenAiNative || isQwenResponses) && supportsVendorToolRoute);
  const supportsBackgroundMode = capability?.supportsBackgroundMode
    ?? isOpenAiNative;
  const supportsContinuation = capability?.supportsContinuation
    ?? ((isOpenAiNative || isQwenResponses) && supportsVendorToolRoute);
  const supportsToolSearch = capability?.supportsToolSearch
    ?? ((isOpenAiNative || isQwenResponses) && supportsVendorToolRoute);
  const supportsCompaction = capability?.supportsCompaction
    ?? isOpenAiNative;
  const requiresReasoningReplay = capability?.requiresReasoningReplay ?? isMoonshotChatCompatible;

  const isMoonshotManagedLocalOnly = isMoonshotAnthropic || isMoonshotChatCompatible;
  const effectiveNativeWebSearch = isMoonshotManagedLocalOnly ? false : supportsNativeWebSearch;
  const effectiveNativeWebExtractor = isMoonshotManagedLocalOnly ? false : supportsNativeWebExtractor;
  const effectiveNativeComputer = isMoonshotManagedLocalOnly ? false : supportsNativeComputer;
  const effectiveNativeCodeInterpreter = isMoonshotManagedLocalOnly ? false : supportsNativeCodeInterpreter;
  const effectiveNativeFileSearch = isMoonshotManagedLocalOnly ? false : supportsNativeFileSearch;

  return {
    supportsNativeWebSearch: effectiveNativeWebSearch,
    supportsNativeWebExtractor: effectiveNativeWebExtractor,
    supportsNativeComputer: effectiveNativeComputer,
    supportsNativeCodeInterpreter: effectiveNativeCodeInterpreter,
    supportsNativeFileSearch: effectiveNativeFileSearch,
    supportsBackgroundMode,
    supportsContinuation,
    supportsToolSearch,
    supportsCompaction,
    requiresReasoningReplay,
    preferredSearchRoute: effectiveNativeWebSearch ? "vendor-native" : "managed-local",
    preferredComputerRoute: (effectiveNativeComputer || effectiveNativeCodeInterpreter) ? "vendor-native" : "managed-local",
    preferredKnowledgeRoute: effectiveNativeFileSearch ? "vendor-native" : "disabled",
  };
}
