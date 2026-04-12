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
  capability?: Pick<ModelCapability, "supportsReasoning"> | null;
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
    },
  };
}

export const buildTurnExecutionPlan = resolveTurnExecutionPlan;
