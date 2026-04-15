import type {
  ExperienceProfileId,
  ExecutionPlan,
  ModelProfile,
  ProtocolTarget,
  ProviderFamily,
  TurnExecutionPlan,
} from "@shared/contracts";

import { resolveExperienceProfileId } from "./experience-profile-resolver";
import {
  resolvePromptPolicyId,
  resolveReasoningProfileId,
  resolveToolPolicyId,
} from "./vendor-policy-registry";

export type FamilyPolicy = {
  providerFamily: ProviderFamily;
  protocolTarget: ProtocolTarget;
  experienceProfileId: ExperienceProfileId;
  reasoningProfileId: string;
  promptPolicyId: string;
  taskPolicyId: string;
  toolPolicyId: string;
  contextPolicyId: string;
  reliabilityPolicyId: string;
  replayMode: TurnExecutionPlan["replayMode"];
  cacheMode: TurnExecutionPlan["cacheMode"];
  multimodalMode: TurnExecutionPlan["multimodalMode"];
  toolCompileMode: string;
  fallbackFamilies: ProviderFamily[];
};

export type FamilyPolicyResolutionInput = {
  profile: Pick<
    ModelProfile,
    | "provider"
    | "providerFlavor"
    | "providerFamily"
    | "protocolTarget"
    | "experienceProfileId"
    | "baseUrl"
    | "model"
  >;
  legacyExecutionPlan?: Pick<ExecutionPlan, "replayPolicy" | "adapterId"> | null;
  requestedExperienceProfileId?: ExperienceProfileId | null;
  requestedProviderFamily?: ProviderFamily | null;
  requestedProtocolTarget?: ProtocolTarget | null;
  role?: "plan" | "execute" | "review" | "fast" | "long-context" | "balanced";
  multimodalMode?: TurnExecutionPlan["multimodalMode"];
};

/** 优先根据显式供应商信号解析 provider family，避免模型名前缀覆盖更强配置。 */
function resolveExplicitProviderFamily(profile: FamilyPolicyResolutionInput["profile"]): ProviderFamily | null {
  const explicitProviderFamily = profile.providerFamily;
  const flavor = (profile.providerFlavor ?? "").toLowerCase();
  const provider = profile.provider.toLowerCase();
  const baseUrl = profile.baseUrl.toLowerCase();

  if (flavor === "br-minimax" || explicitProviderFamily === "br-minimax" || baseUrl.includes("cybotforge.100credit.cn")) {
    return "br-minimax";
  }

  if (flavor === "volcengine-ark" || explicitProviderFamily === "volcengine-ark" || baseUrl.includes("ark.cn-beijing.volces.com") || baseUrl.includes("volces.com")) {
    return "volcengine-ark";
  }

  if (flavor === "anthropic" || explicitProviderFamily === "anthropic-native" || provider === "anthropic" || baseUrl.includes("anthropic.com")) {
    return "anthropic-native";
  }

  if (
    flavor === "qwen"
    || explicitProviderFamily === "qwen-native"
    || explicitProviderFamily === "qwen-dashscope"
    || baseUrl.includes("dashscope.aliyuncs.com")
    || baseUrl.includes("coding.dashscope")
  ) {
    return "qwen-native";
  }

  if (
    flavor === "moonshot"
    || explicitProviderFamily === "moonshot-native"
    || baseUrl.includes("moonshot")
    || baseUrl.includes("platform.kimi")
  ) {
    return "moonshot-native";
  }

  if (flavor === "deepseek" || explicitProviderFamily === "deepseek" || baseUrl.includes("api.deepseek.com")) {
    return "deepseek";
  }

  if (flavor === "openai" || explicitProviderFamily === "openai-native" || (provider === "openai-compatible" && baseUrl.includes("api.openai.com"))) {
    return "openai-native";
  }

  return explicitProviderFamily ?? null;
}

/** 根据 profile/baseUrl/flavor 推断 provider family。 */
export function inferProviderFamily(profile: FamilyPolicyResolutionInput["profile"]): ProviderFamily {
  const explicitProviderFamily = resolveExplicitProviderFamily(profile);
  if (explicitProviderFamily) {
    return explicitProviderFamily;
  }

  const model = profile.model.toLowerCase();

  if (model.startsWith("claude")) {
    return "anthropic-native";
  }

  if (model.startsWith("qwen")) {
    return "qwen-native";
  }

  if (model.startsWith("kimi") || model.startsWith("k2")) {
    return "moonshot-native";
  }

  if (model.startsWith("deepseek")) {
    return "deepseek";
  }

  return "generic-openai-compatible";
}

/** family 与 wire protocol 分离：体验归 family，协议归 protocol target。 */
export function resolveProtocolTarget(
  profile: FamilyPolicyResolutionInput["profile"],
  providerFamily: ProviderFamily,
): ProtocolTarget {
  if (profile.protocolTarget) {
    return profile.protocolTarget;
  }

  if (providerFamily === "openai-native") return "openai-responses";
  if (providerFamily === "anthropic-native") return "anthropic-messages";
  if (providerFamily === "qwen-native") return "openai-responses";
  if (providerFamily === "moonshot-native") return "anthropic-messages";
  return "openai-chat-compatible";
}

function resolveReplayMode(
  providerFamily: ProviderFamily,
  legacyExecutionPlan?: Pick<ExecutionPlan, "replayPolicy"> | null,
): TurnExecutionPlan["replayMode"] {
  if (legacyExecutionPlan?.replayPolicy === "assistant-turn-with-reasoning") {
    return providerFamily === "br-minimax" ? "family-specific" : "reasoning-aware";
  }
  if (legacyExecutionPlan?.replayPolicy === "assistant-turn") {
    return "assistant-turn";
  }
  if (providerFamily === "br-minimax") {
    return "family-specific";
  }
  return "none";
}

function resolveCacheMode(providerFamily: ProviderFamily): TurnExecutionPlan["cacheMode"] {
  if (providerFamily === "openai-native") return "openai-prefix";
  if (providerFamily === "anthropic-native") return "anthropic-breakpoint";
  if (providerFamily === "br-minimax") return "family-specific";
  return "none";
}

function resolveToolCompileMode(providerFamily: ProviderFamily): string {
  if (providerFamily === "openai-native") return "openai-strict";
  if (providerFamily === "anthropic-native") return "anthropic-detailed-description";
  if (providerFamily === "br-minimax") return "openai-compatible-reasoning";
  if (providerFamily === "qwen-native") return "openai-compatible-conservative";
  if (providerFamily === "qwen-dashscope") return "openai-compatible-conservative";
  if (providerFamily === "moonshot-native") return "openai-compatible-relaxed";
  if (providerFamily === "deepseek") return "openai-compatible-relaxed";
  if (providerFamily === "volcengine-ark") return "openai-compatible-ark";
  return "openai-compatible-relaxed";
}

function resolveFallbackFamilies(providerFamily: ProviderFamily): ProviderFamily[] {
  if (providerFamily === "generic-openai-compatible") {
    return [];
  }
  return ["generic-openai-compatible"];
}

/** 生成 family-aware policy，供 turn plan、gateway、telemetry 与 rollout gate 统一消费。 */
export function resolveFamilyPolicy(input: FamilyPolicyResolutionInput): FamilyPolicy {
  const providerFamily = input.requestedProviderFamily ?? inferProviderFamily(input.profile);
  const protocolTarget = input.requestedProtocolTarget ?? resolveProtocolTarget(input.profile, providerFamily);
  const experienceProfileId = resolveExperienceProfileId({
    requestedProfileId: input.requestedExperienceProfileId ?? null,
    providerFamily,
    role: input.role,
    profile: input.profile,
  });
  const multimodalMode = input.multimodalMode ?? "canonical-parts";

  return {
    providerFamily,
    protocolTarget,
    experienceProfileId,
    reasoningProfileId: resolveReasoningProfileId(providerFamily, protocolTarget),
    promptPolicyId: resolvePromptPolicyId(providerFamily, protocolTarget),
    taskPolicyId: `${providerFamily}.task.default`,
    toolPolicyId: resolveToolPolicyId(providerFamily, protocolTarget),
    contextPolicyId: `${providerFamily}.context.default`,
    reliabilityPolicyId: `${providerFamily}.reliability.default`,
    replayMode: resolveReplayMode(providerFamily, input.legacyExecutionPlan ?? null),
    cacheMode: resolveCacheMode(providerFamily),
    multimodalMode,
    toolCompileMode: resolveToolCompileMode(providerFamily),
    fallbackFamilies: resolveFallbackFamilies(providerFamily),
  };
}
