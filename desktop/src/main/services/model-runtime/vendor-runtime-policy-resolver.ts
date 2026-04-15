import type {
  ExecutionPlan,
  ModelProfile,
  ProtocolTarget,
  ProviderFamily,
  VendorFamily,
} from "@shared/contracts";

import { getVendorPolicy } from "./vendor-policy-registry";
import { inferProviderFamily, resolveProtocolTarget } from "./family-policy-resolver";

export type VendorRuntimePolicy = {
  vendorFamily: VendorFamily;
  providerFamily: ProviderFamily;
  supportedProtocolTargets: ProtocolTarget[];
  recommendedProtocolTarget: ProtocolTarget;
  selectedProtocolTarget: ProtocolTarget;
  fallbackChain: ProtocolTarget[];
  deploymentProfile?: string;
  protocolSelectionSource: "saved" | "probe" | "registry-default" | "fallback";
  protocolSelectionReason: string;
};

export type ResolveVendorRuntimePolicyInput = {
  profile: Pick<
    ModelProfile,
    | "provider"
    | "providerFlavor"
    | "providerFamily"
    | "vendorFamily"
    | "protocolTarget"
    | "savedProtocolPreferences"
    | "baseUrl"
    | "model"
    | "deploymentProfile"
  >;
  legacyExecutionPlan?: Pick<ExecutionPlan, "replayPolicy" | "adapterId"> | null;
  requestedProtocolTarget?: ProtocolTarget | null;
};

/** 优先根据显式厂商信号解析 vendor family，避免模型名前缀覆盖更强配置。 */
function resolveExplicitVendorFamily(
  profile: ResolveVendorRuntimePolicyInput["profile"],
): VendorFamily | null {
  const explicitVendorFamily = profile.vendorFamily;
  const explicitProviderFamily = profile.providerFamily;
  const flavor = (profile.providerFlavor ?? "").toLowerCase();
  const provider = profile.provider.toLowerCase();
  const baseUrl = profile.baseUrl.toLowerCase();

  if (
    flavor === "br-minimax"
    || flavor === "minimax-anthropic"
    || explicitVendorFamily === "minimax"
    || explicitProviderFamily === "br-minimax"
    || baseUrl.includes("minimax")
    || baseUrl.includes("minimaxi")
    || baseUrl.includes("cybotforge.100credit.cn")
  ) {
    return "minimax";
  }

  if (
    flavor === "volcengine-ark"
    || explicitVendorFamily === "volcengine-ark"
    || explicitProviderFamily === "volcengine-ark"
    || baseUrl.includes("ark.cn-beijing.volces.com")
    || baseUrl.includes("volces.com")
  ) {
    return "volcengine-ark";
  }

  if (
    flavor === "qwen"
    || explicitVendorFamily === "qwen"
    || explicitProviderFamily === "qwen-native"
    || explicitProviderFamily === "qwen-dashscope"
    || baseUrl.includes("dashscope.aliyuncs.com")
    || baseUrl.includes("coding.dashscope")
  ) {
    return "qwen";
  }

  if (
    flavor === "moonshot"
    || explicitVendorFamily === "kimi"
    || explicitProviderFamily === "moonshot-native"
    || baseUrl.includes("moonshot")
    || baseUrl.includes("platform.kimi")
  ) {
    return "kimi";
  }

  if (
    flavor === "anthropic"
    || explicitVendorFamily === "anthropic"
    || explicitProviderFamily === "anthropic-native"
    || provider === "anthropic"
    || baseUrl.includes("anthropic.com")
  ) {
    return "anthropic";
  }

  if (
    flavor === "deepseek"
    || explicitVendorFamily === "deepseek"
    || explicitProviderFamily === "deepseek"
    || baseUrl.includes("api.deepseek.com")
  ) {
    return "deepseek";
  }

  if (
    flavor === "openai"
    || explicitVendorFamily === "openai"
    || explicitProviderFamily === "openai-native"
    || (provider === "openai-compatible" && baseUrl.includes("api.openai.com"))
  ) {
    return "openai";
  }

  if (provider === "local-gateway" || explicitVendorFamily === "generic-local-gateway") {
    return "generic-local-gateway";
  }

  return explicitVendorFamily ?? null;
}

/** 根据 profile/baseUrl/model 推断厂商 family，作为多协议策略矩阵的归属键。 */
export function inferVendorFamily(
  profile: ResolveVendorRuntimePolicyInput["profile"],
): VendorFamily {
  const explicitVendorFamily = resolveExplicitVendorFamily(profile);
  if (explicitVendorFamily) {
    return explicitVendorFamily;
  }

  const model = profile.model.toLowerCase();

  if (model.startsWith("claude")) {
    return "anthropic";
  }

  if (model.startsWith("qwen")) {
    return "qwen";
  }

  if (model.startsWith("kimi") || model.startsWith("k2")) {
    return "kimi";
  }

  if (model.startsWith("deepseek")) {
    return "deepseek";
  }

  if (model.startsWith("minimax")) {
    return "minimax";
  }

  return "generic-openai-compatible";
}

/** 解析部署 profile，先保留 BR MiniMax 这类既有部署语义，避免破坏现有实现。 */
function resolveDeploymentProfile(
  profile: ResolveVendorRuntimePolicyInput["profile"],
  vendorFamily: VendorFamily,
): string | undefined {
  if (profile.deploymentProfile) {
    return profile.deploymentProfile;
  }

  if (
    vendorFamily === "minimax"
    && (
      profile.providerFlavor === "br-minimax"
      || profile.baseUrl.toLowerCase().includes("cybotforge.100credit.cn")
    )
  ) {
    return "br-private";
  }

  return undefined;
}

/** 解析最终选择的协议，默认保留当前运行时行为；少数新厂商可直接吃 registry 默认。 */
function resolveSelectedProtocolTarget(input: {
  explicitProtocolTarget: ProtocolTarget | null;
  savedProtocolPreferences?: ProtocolTarget[] | null;
  legacySelectedProtocolTarget: ProtocolTarget;
  recommendedProtocolTarget: ProtocolTarget;
  supportedProtocolTargets: ProtocolTarget[];
  vendorFamily: VendorFamily;
}): {
  selectedProtocolTarget: ProtocolTarget;
  protocolSelectionSource: VendorRuntimePolicy["protocolSelectionSource"];
  protocolSelectionReason: string;
} {
  if (input.explicitProtocolTarget) {
    if (input.supportedProtocolTargets.includes(input.explicitProtocolTarget)) {
      return {
        selectedProtocolTarget: input.explicitProtocolTarget,
        protocolSelectionSource: "saved",
        protocolSelectionReason: "explicit-protocol-target",
      };
    }

    return {
      selectedProtocolTarget: input.recommendedProtocolTarget,
      protocolSelectionSource: "fallback",
      protocolSelectionReason: "explicit-protocol-unsupported",
    };
  }

  if (input.savedProtocolPreferences && input.savedProtocolPreferences.length > 0) {
    const matchedPreference = input.savedProtocolPreferences.find((target) => input.supportedProtocolTargets.includes(target));
    if (matchedPreference) {
      return {
        selectedProtocolTarget: matchedPreference,
        protocolSelectionSource: "saved",
        protocolSelectionReason: "saved-protocol-preference",
      };
    }

    return {
      selectedProtocolTarget: input.recommendedProtocolTarget,
      protocolSelectionSource: "fallback",
      protocolSelectionReason: "saved-protocol-unsupported",
    };
  }

  if (input.vendorFamily === "kimi") {
    return {
      selectedProtocolTarget: input.recommendedProtocolTarget,
      protocolSelectionSource: "registry-default",
      protocolSelectionReason: "kimi-defaults-to-claude-code-route",
    };
  }

  return {
    selectedProtocolTarget: input.legacySelectedProtocolTarget,
    protocolSelectionSource: "registry-default",
    protocolSelectionReason: "preserve-current-runtime-default",
  };
}

/** 将 registry 中的厂商能力与当前 legacy runtime 事实合并成 vendor-aware policy。 */
export function resolveVendorRuntimePolicy(
  input: ResolveVendorRuntimePolicyInput,
): VendorRuntimePolicy {
  const providerFamily = inferProviderFamily(input.profile);
  const vendorFamily = inferVendorFamily(input.profile);
  const vendorPolicy = getVendorPolicy(vendorFamily);
  const supportedProtocolTargets = [...vendorPolicy.supportedProtocols];

  // 通用/自定义厂商的 registry 仅声明 openai-chat-compatible 作为保守默认，
  // 但用户通过路线探测发现的其它可用协议应当在执行时同样被承认。
  const isGenericVendor = vendorFamily === "generic-openai-compatible" || vendorFamily === "generic-local-gateway";
  if (isGenericVendor) {
    if (input.profile.protocolTarget && !supportedProtocolTargets.includes(input.profile.protocolTarget)) {
      supportedProtocolTargets.push(input.profile.protocolTarget);
    }
    if (input.profile.savedProtocolPreferences) {
      for (const pref of input.profile.savedProtocolPreferences) {
        if (!supportedProtocolTargets.includes(pref)) {
          supportedProtocolTargets.push(pref);
        }
      }
    }
    if (input.requestedProtocolTarget && !supportedProtocolTargets.includes(input.requestedProtocolTarget)) {
      supportedProtocolTargets.push(input.requestedProtocolTarget);
    }
  }
  const recommendedProtocolTarget = vendorPolicy.recommendedProtocolsByUseCase.default[0]
    ?? resolveProtocolTarget(input.profile, providerFamily);
  const explicitProtocolTarget = input.requestedProtocolTarget ?? input.profile.protocolTarget ?? null;
  const legacySelectedProtocolTarget = resolveProtocolTarget(input.profile, providerFamily);
  const selection = resolveSelectedProtocolTarget({
    explicitProtocolTarget,
    savedProtocolPreferences: input.profile.savedProtocolPreferences ?? null,
    legacySelectedProtocolTarget,
    recommendedProtocolTarget,
    supportedProtocolTargets,
    vendorFamily,
  });

  return {
    vendorFamily,
    providerFamily,
    supportedProtocolTargets,
    recommendedProtocolTarget,
    selectedProtocolTarget: selection.selectedProtocolTarget,
    fallbackChain: supportedProtocolTargets.filter((target) => target !== recommendedProtocolTarget),
    deploymentProfile: resolveDeploymentProfile(input.profile, vendorFamily),
    protocolSelectionSource: selection.protocolSelectionSource,
    protocolSelectionReason: selection.protocolSelectionReason,
  };
}
