import type {
  ExecutionPlan,
  ExperienceProfileId,
  ModelCapability,
  ModelProfile,
  ProtocolTarget,
  ProviderFamily,
  SessionRuntimeIntent,
  TurnExecutionPlan,
  VendorFamily,
} from "@shared/contracts";
import { SESSION_RUNTIME_VERSION } from "@shared/contracts";

import { buildExecutionPlan } from "../reasoning-runtime";
import { resolveCapabilityRoutes } from "./capability-router";
import { resolveFamilyPolicy } from "./family-policy-resolver";
import { resolveRegistryToolCompileMode } from "./vendor-policy-registry";
import { resolveVendorRuntimePolicy } from "./vendor-runtime-policy-resolver";

export type ResolveTurnExecutionPlanInput = {
  profile: Pick<
    ModelProfile,
    | "id"
    | "provider"
    | "providerFlavor"
    | "providerFamily"
    | "vendorFamily"
    | "protocolTarget"
    | "savedProtocolPreferences"
    | "experienceProfileId"
    | "baseUrl"
    | "model"
    | "deploymentProfile"
  >;
  legacyExecutionPlan?: ExecutionPlan | null;
  capability?: Pick<
    ModelCapability,
    | "supportsReasoning"
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
    | "thinkingControlKind"
    | "toolChoiceConstraint"
    | "nativeToolStackId"
  > | null;
  session?: { runtimeIntent?: SessionRuntimeIntent | null } | null;
  intent?: SessionRuntimeIntent | null;
  modelProfileId?: string;
  selectedModelProfileId?: string;
  requestedExperienceProfileId?: ExperienceProfileId | null;
  requestedProviderFamily?: ProviderFamily | null;
  requestedVendorFamily?: VendorFamily | null;
  requestedProtocolTarget?: ProtocolTarget | null;
  role?: "plan" | "execute" | "review" | "fast" | "long-context" | "balanced";
};

/** 解析 provider family 对应的工具编译模式，供 gateway / telemetry / tests 共享。 */
export function resolveToolCompileMode(providerFamily: TurnExecutionPlan["providerFamily"]): string {
  const registryMode = resolveRegistryToolCompileMode(providerFamily);
  if (registryMode) {
    return registryMode;
  }

  switch (providerFamily) {
    case "openai-native":
      return "openai-strict";
    case "anthropic-native":
      return "anthropic-detailed-description";
    case "qwen-native":
    case "qwen-dashscope":
      return "openai-compatible-conservative";
    case "br-minimax":
      return "openai-compatible-reasoning";
    case "volcengine-ark":
      return "openai-compatible-ark";
    default:
      return "openai-compatible-relaxed";
  }
}

/** 从能力路由中提取本轮真正启用的工具栈来源，供 telemetry/UI 统一消费。 */
function resolveToolStackSource(capabilityRoutes: TurnExecutionPlan["capabilityRoutes"]): "vendor-native" | "managed-local" | "hybrid" | "none" {
  const vendorNativeCount = capabilityRoutes?.filter((route) => route.routeType === "vendor-native").length ?? 0;
  const managedLocalCount = capabilityRoutes?.filter((route) => route.routeType === "managed-local").length ?? 0;
  if (vendorNativeCount > 0 && managedLocalCount > 0) {
    return "hybrid";
  }
  if (vendorNativeCount > 0) {
    return "vendor-native";
  }
  if (managedLocalCount > 0) {
    return "managed-local";
  }
  return "none";
}

/** 解析本轮活跃的原生工具栈标识，优先取 capability 声明，再回落到路由推断。 */
function resolveActiveNativeToolStackId(input: {
  declaredNativeToolStackId?: string | null;
  capabilityRoutes: TurnExecutionPlan["capabilityRoutes"];
}): string | null {
  const routedToolStackId = input.capabilityRoutes?.find((route) => route.nativeToolStackId)?.nativeToolStackId ?? null;
  return input.declaredNativeToolStackId ?? routedToolStackId ?? null;
}

/** 在保留 legacy execution plan 的同时补齐 family / protocol / policy / telemetry 维度。 */
export function resolveTurnExecutionPlan(
  input: ResolveTurnExecutionPlanInput,
): TurnExecutionPlan {
  const legacyExecutionPlan = input.legacyExecutionPlan ?? buildExecutionPlan({
    profile: input.profile,
    capability: input.capability ?? null,
    session: input.session ?? null,
    intent: input.intent ?? null,
  });
  const vendorRuntimePolicy = resolveVendorRuntimePolicy({
    profile: {
      ...input.profile,
      ...(input.requestedVendorFamily ? { vendorFamily: input.requestedVendorFamily } : {}),
    },
    legacyExecutionPlan,
    requestedProtocolTarget: input.requestedProtocolTarget ?? null,
  });

  const familyPolicy = resolveFamilyPolicy({
    profile: {
      ...input.profile,
      providerFamily: input.requestedProviderFamily ?? vendorRuntimePolicy.providerFamily,
      protocolTarget: vendorRuntimePolicy.selectedProtocolTarget,
    },
    legacyExecutionPlan,
    requestedExperienceProfileId: input.requestedExperienceProfileId ?? null,
    requestedProviderFamily: input.requestedProviderFamily ?? vendorRuntimePolicy.providerFamily,
    requestedProtocolTarget: vendorRuntimePolicy.selectedProtocolTarget,
    role: input.role,
  });
  const capabilityRoutes = resolveCapabilityRoutes({
    profile: {
      ...input.profile,
      providerFamily: familyPolicy.providerFamily,
      protocolTarget: familyPolicy.protocolTarget,
    },
    capability: input.capability ?? null,
    protocolTarget: familyPolicy.protocolTarget,
    reasoningEnabled: (legacyExecutionPlan as { reasoningEnabled?: boolean } | null)?.reasoningEnabled,
    reasoningEffort: (legacyExecutionPlan as { reasoningEffort?: TurnExecutionPlan["reasoningEffort"] } | null)?.reasoningEffort,
  });
  const toolStackSource = resolveToolStackSource(capabilityRoutes);
  const nativeToolStackId = resolveActiveNativeToolStackId({
    declaredNativeToolStackId: input.capability?.nativeToolStackId ?? null,
    capabilityRoutes,
  });

  return {
    runtimeVersion: SESSION_RUNTIME_VERSION,
    legacyExecutionPlan,
    providerFamily: familyPolicy.providerFamily,
    vendorFamily: vendorRuntimePolicy.vendorFamily,
    supportedProtocolTargets: vendorRuntimePolicy.supportedProtocolTargets,
    recommendedProtocolTarget: vendorRuntimePolicy.recommendedProtocolTarget,
    fallbackChain: vendorRuntimePolicy.fallbackChain,
    deploymentProfile: vendorRuntimePolicy.deploymentProfile,
    protocolSelectionSource: vendorRuntimePolicy.protocolSelectionSource,
    protocolSelectionReason: vendorRuntimePolicy.protocolSelectionReason,
    protocolTarget: familyPolicy.protocolTarget,
    selectedModelProfileId: input.selectedModelProfileId ?? input.modelProfileId ?? input.profile.id,
    experienceProfileId: familyPolicy.experienceProfileId,
    reasoningProfileId: familyPolicy.reasoningProfileId,
    promptPolicyId: familyPolicy.promptPolicyId,
    taskPolicyId: familyPolicy.taskPolicyId,
    toolPolicyId: familyPolicy.toolPolicyId,
    contextPolicyId: familyPolicy.contextPolicyId,
    reliabilityPolicyId: familyPolicy.reliabilityPolicyId,
    replayMode: familyPolicy.replayMode,
    cacheMode: familyPolicy.cacheMode,
    multimodalMode: familyPolicy.multimodalMode,
    toolCompileTarget: familyPolicy.providerFamily,
    reasoningEnabled: (legacyExecutionPlan as { reasoningEnabled?: boolean } | null)?.reasoningEnabled,
    reasoningEffort: (legacyExecutionPlan as { reasoningEffort?: TurnExecutionPlan["reasoningEffort"] } | null)?.reasoningEffort,
    thinkingControlKind: input.capability?.thinkingControlKind,
    toolChoiceConstraint: input.capability?.toolChoiceConstraint,
    nativeToolStackId,
    capabilityRoutes,
    fallbackCandidates: familyPolicy.fallbackFamilies.map((family) => ({
      modelProfileId: input.selectedModelProfileId ?? input.modelProfileId ?? input.profile.id,
      providerFamily: family,
      vendorFamily: vendorRuntimePolicy.vendorFamily,
      protocolTarget: family === "anthropic-native"
        ? "anthropic-messages"
        : family === "openai-native"
          ? "openai-responses"
          : "openai-chat-compatible",
      reason: `${familyPolicy.providerFamily}-fallback`,
    })),
    telemetryTags: {
      providerFamily: familyPolicy.providerFamily,
      protocolTarget: familyPolicy.protocolTarget,
      experienceProfileId: familyPolicy.experienceProfileId,
      promptPolicyId: familyPolicy.promptPolicyId,
      taskPolicyId: familyPolicy.taskPolicyId,
      toolPolicyId: familyPolicy.toolPolicyId,
      contextPolicyId: familyPolicy.contextPolicyId,
      reliabilityPolicyId: familyPolicy.reliabilityPolicyId,
      toolCompileMode: resolveToolCompileMode(familyPolicy.providerFamily),
      reasoningEnabled: String((legacyExecutionPlan as { reasoningEnabled?: boolean } | null)?.reasoningEnabled ?? "auto"),
      thinkingControlKind: input.capability?.thinkingControlKind ?? "unknown",
      toolChoiceConstraint: input.capability?.toolChoiceConstraint ?? "none",
      nativeToolStackId: nativeToolStackId ?? "none",
      toolStackSource,
    },
  };
}

export const buildTurnExecutionPlan = resolveTurnExecutionPlan;
