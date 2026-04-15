import type {
  CapabilityExecutionRoute,
  ModelCapability,
  ModelProfile,
  ProtocolTarget,
} from "@shared/contracts";

import { resolveProviderNativeCapabilities } from "./provider-capability-matrix";
import { resolveNativeFileSearchConfig } from "./tool-middleware";

export type ResolveCapabilityRoutesInput = {
  profile: Pick<ModelProfile, "providerFamily" | "vendorFamily" | "protocolTarget" | "providerFlavor" | "model" | "responsesApiConfig" | "requestBody" | "defaultReasoningEffort">;
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
    | "nativeToolStackId"
    | "thinkingControlKind"
  > | null;
  protocolTarget: ProtocolTarget;
  reasoningEnabled?: boolean;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
};

/** 统一推断当前协议分支下的原生工具栈标识。 */
function resolveNativeToolStackId(input: ResolveCapabilityRoutesInput): string | null {
  if (input.capability?.nativeToolStackId) {
    return input.capability.nativeToolStackId;
  }

  const providerFamily = input.profile.providerFamily ?? "generic-openai-compatible";
  if (providerFamily === "qwen-native") {
    return "qwen-native";
  }
  return null;
}

function requiresQwenThinkingForAdvancedNativeTools(model: string): boolean {
  return model.toLowerCase().startsWith("qwen3-max");
}

function isQwenThinkingActive(input: ResolveCapabilityRoutesInput): boolean {
  if (input.capability?.thinkingControlKind === "unsupported") {
    return false;
  }
  if (input.reasoningEnabled === false) {
    return false;
  }
  if (input.reasoningEnabled === true) {
    return true;
  }
  if (input.profile.requestBody?.["enable_thinking"] === true) {
    return true;
  }
  return !!(input.reasoningEffort ?? input.profile.defaultReasoningEffort);
}

/** 根据 capability route 统一标记工具栈来源，便于 telemetry 与 UI 复用。 */
function resolveToolStackSource(
  routeType: CapabilityExecutionRoute["routeType"],
  nativeToolStackId: string | null,
): CapabilityExecutionRoute["toolStackSource"] {
  if (routeType === "vendor-native" && nativeToolStackId) {
    return "vendor-native";
  }
  if (routeType === "managed-local") {
    return "managed-local";
  }
  return "none";
}

/** 构造统一的 capability route 记录，避免同一批字段在六类能力上重复展开。 */
function buildCapabilityRoute(input: {
  capabilityId: CapabilityExecutionRoute["capabilityId"];
  routeType: CapabilityExecutionRoute["routeType"];
  providerFamily: CapabilityExecutionRoute["providerFamily"];
  protocolTarget: CapabilityExecutionRoute["protocolTarget"];
  nativeToolName?: string | null;
  nativeToolStackId: string | null;
  fallbackToolChain?: string[];
  reason?: string | null;
}): CapabilityExecutionRoute {
  return {
    capabilityId: input.capabilityId,
    routeType: input.routeType,
    providerFamily: input.providerFamily,
    protocolTarget: input.protocolTarget,
    nativeToolName: input.nativeToolName ?? null,
    nativeToolStackId: input.routeType === "vendor-native" ? input.nativeToolStackId : null,
    toolStackSource: resolveToolStackSource(input.routeType, input.nativeToolStackId),
    fallbackToolChain: input.fallbackToolChain ?? [],
    reason: input.reason ?? null,
  };
}

/** 为本轮执行生成能力路由，统一描述厂商原生与本地 fallback 的落点。 */
export function resolveCapabilityRoutes(input: ResolveCapabilityRoutesInput): CapabilityExecutionRoute[] {
  const providerFamily = input.profile.providerFamily ?? "generic-openai-compatible";
  const vendorFamily = input.profile.vendorFamily ?? "generic-openai-compatible";
  const nativeToolStackId = resolveNativeToolStackId(input);
  const nativeFileSearch = resolveNativeFileSearchConfig(input.profile);
  const capabilities = resolveProviderNativeCapabilities({
    ...input.profile,
    protocolTarget: input.protocolTarget,
  }, input.capability ?? null);
  const isQwenResponses = providerFamily === "qwen-native" && input.protocolTarget === "openai-responses";
  const isQwenChatCompatible = providerFamily === "qwen-native" && input.protocolTarget === "openai-chat-compatible";
  const isMoonshotChatCompatible = providerFamily === "moonshot-native" && input.protocolTarget === "openai-chat-compatible";
  const isMoonshotAnthropic = providerFamily === "moonshot-native" && input.protocolTarget === "anthropic-messages";
  const qwenThinkingRequired = isQwenResponses && requiresQwenThinkingForAdvancedNativeTools(input.profile.model);
  const qwenThinkingActive = isQwenThinkingActive(input);
  const qwenCanUseAdvancedNativeTools = !qwenThinkingRequired || qwenThinkingActive;

  const searchNativeToolName = capabilities.preferredSearchRoute === "vendor-native"
    ? isQwenChatCompatible
      ? "enable_search"
      : "web_search"
    : null;
  const searchReason = capabilities.preferredSearchRoute === "vendor-native"
    ? "native_web_search_available"
    : isMoonshotAnthropic
      ? "anthropic_agent_route_uses_local_tools"
      : isMoonshotChatCompatible
        ? "moonshot_formula_bridge_unavailable"
      : "native_web_search_unavailable";
  const qwenRequiresSearchForExtractor = isQwenResponses
    && capabilities.supportsNativeWebExtractor
    && capabilities.preferredSearchRoute !== "vendor-native";
  const pageReadRouteType = isQwenResponses && capabilities.supportsNativeWebExtractor && !qwenRequiresSearchForExtractor && qwenCanUseAdvancedNativeTools
    ? "vendor-native"
    : "managed-local";
  const pageReadReason = pageReadRouteType === "vendor-native"
    ? "native_web_extractor_available"
    : qwenRequiresSearchForExtractor
      ? "qwen_web_extractor_requires_web_search"
      : qwenThinkingRequired && !qwenThinkingActive
        ? "qwen_native_tool_requires_thinking"
        : "managed_page_read_default";
  const computerNativeToolName = capabilities.preferredComputerRoute === "vendor-native"
    ? isQwenResponses
      ? "code_interpreter"
      : isQwenChatCompatible
        ? "enable_code_interpreter"
        : "computer"
    : null;
  const computerRouteType = isQwenResponses && qwenThinkingRequired && !qwenThinkingActive
    ? "managed-local"
    : capabilities.preferredComputerRoute;
  const computerReason = computerRouteType === "vendor-native"
    ? "native_computer_available"
    : isMoonshotAnthropic
      ? "anthropic_agent_route_uses_local_tools"
      : isMoonshotChatCompatible
        ? "moonshot_formula_bridge_unavailable"
      : qwenThinkingRequired && !qwenThinkingActive
        ? "qwen_native_tool_requires_thinking"
      : "native_computer_unavailable";
  const knowledgeRouteType = capabilities.preferredKnowledgeRoute === "vendor-native" && nativeFileSearch
    ? "vendor-native"
    : "disabled";
  const researchRouteType = isQwenResponses && capabilities.supportsContinuation
    ? "vendor-native"
    : capabilities.supportsBackgroundMode
      ? "vendor-native"
      : "managed-local";
  const researchNativeToolName = isQwenResponses && capabilities.supportsContinuation
    ? "previous_response_id"
    : capabilities.supportsBackgroundMode
      ? "background_response"
      : null;
  const citationRouteType = capabilities.preferredSearchRoute === "vendor-native" && !isMoonshotAnthropic
    ? "vendor-native"
    : "managed-local";

  return [
    buildCapabilityRoute({
      capabilityId: "search",
      routeType: capabilities.preferredSearchRoute,
      providerFamily,
      protocolTarget: input.protocolTarget,
      nativeToolName: searchNativeToolName,
      nativeToolStackId,
      fallbackToolChain: capabilities.preferredSearchRoute === "managed-local"
        ? ["web.search", "http.fetch", "browser.open", "browser.snapshot"]
        : [],
      reason: searchReason,
    }),
    buildCapabilityRoute({
      capabilityId: "page-read",
      routeType: pageReadRouteType,
      providerFamily,
      protocolTarget: input.protocolTarget,
      nativeToolName: pageReadRouteType === "vendor-native" ? "web_extractor" : null,
      nativeToolStackId,
      fallbackToolChain: pageReadRouteType === "vendor-native" ? [] : ["http.fetch", "browser.open", "browser.snapshot"],
      reason: pageReadReason,
    }),
    buildCapabilityRoute({
      capabilityId: "computer",
      routeType: computerRouteType,
      providerFamily,
      protocolTarget: input.protocolTarget,
      nativeToolName: computerRouteType === "vendor-native" ? computerNativeToolName : null,
      nativeToolStackId,
      fallbackToolChain: computerRouteType === "managed-local"
        ? ["browser.open", "browser.snapshot", "browser.click", "browser.type"]
        : [],
      reason: computerReason,
    }),
    buildCapabilityRoute({
      capabilityId: "knowledge-retrieval",
      routeType: knowledgeRouteType,
      providerFamily,
      protocolTarget: input.protocolTarget,
      nativeToolName: knowledgeRouteType === "vendor-native" ? "file_search" : null,
      nativeToolStackId,
      reason: knowledgeRouteType === "vendor-native"
        ? "native_file_search_available"
        : "native_file_search_unconfigured",
    }),
    buildCapabilityRoute({
      capabilityId: "research-task",
      routeType: researchRouteType,
      providerFamily,
      protocolTarget: input.protocolTarget,
      nativeToolName: researchNativeToolName,
      nativeToolStackId,
      fallbackToolChain: researchRouteType === "vendor-native" ? [] : ["web.search", "http.fetch", "browser.open"],
      reason: isQwenResponses && capabilities.supportsContinuation
        ? "native_continuation_available"
        : capabilities.supportsBackgroundMode
          ? "native_background_available"
          : "native_background_unavailable",
    }),
    buildCapabilityRoute({
      capabilityId: "citation",
      routeType: citationRouteType,
      providerFamily,
      protocolTarget: input.protocolTarget,
      nativeToolName: citationRouteType === "vendor-native" ? "url_citation" : null,
      nativeToolStackId,
      fallbackToolChain: citationRouteType === "vendor-native" ? [] : ["web.search", "http.fetch", "browser.open"],
      reason: citationRouteType === "vendor-native"
        ? vendorFamily === "qwen"
          ? "native_qwen_citation_available"
          : "native_citation_available"
        : "native_citation_unavailable",
    }),
  ];
}
