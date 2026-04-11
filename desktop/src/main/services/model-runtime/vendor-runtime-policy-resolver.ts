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
    | "baseUrl"
    | "model"
    | "deploymentProfile"
  >;
  legacyExecutionPlan?: Pick<ExecutionPlan, "replayPolicy" | "adapterId"> | null;
  requestedProtocolTarget?: ProtocolTarget | null;
};

/** 根据 profile/baseUrl/model 推断厂商 family，作为多协议策略矩阵的归属键。 */
export function inferVendorFamily(
  profile: ResolveVendorRuntimePolicyInput["profile"],
): VendorFamily {
  if (profile.vendorFamily) {
    return profile.vendorFamily;
  }

  const flavor = (profile.providerFlavor ?? "").toLowerCase();
  const provider = profile.provider.toLowerCase();
  const baseUrl = profile.baseUrl.toLowerCase();
  const model = profile.model.toLowerCase();

  if (flavor === "openai" || (provider === "openai-compatible" && baseUrl.includes("api.openai.com"))) {
    return "openai";
  }

  if (
    flavor === "anthropic"
    || provider === "anthropic"
    || baseUrl.includes("anthropic.com")
    || model.startsWith("claude")
  ) {
    return "anthropic";
  }

  if (
    flavor === "qwen"
    || baseUrl.includes("dashscope.aliyuncs.com")
    || baseUrl.includes("coding.dashscope")
    || model.startsWith("qwen")
  ) {
    return "qwen";
  }

  if (
    flavor === "moonshot"
    || baseUrl.includes("moonshot")
    || baseUrl.includes("platform.kimi")
    || model.startsWith("kimi")
    || model.startsWith("k2")
  ) {
    return "kimi";
  }

  if (flavor === "volcengine-ark" || baseUrl.includes("ark.cn-beijing.volces.com") || baseUrl.includes("volces.com")) {
    return "volcengine-ark";
  }

  if (
    flavor === "br-minimax"
    || flavor === "minimax-anthropic"
    || baseUrl.includes("minimax")
    || baseUrl.includes("minimaxi")
    || model.startsWith("minimax")
  ) {
    return "minimax";
  }

  if (provider === "local-gateway") {
    return "generic-local-gateway";
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
  const recommendedProtocolTarget = vendorPolicy.recommendedProtocolsByUseCase.default[0]
    ?? resolveProtocolTarget(input.profile, providerFamily);
  const explicitProtocolTarget = input.requestedProtocolTarget ?? input.profile.protocolTarget ?? null;
  const legacySelectedProtocolTarget = resolveProtocolTarget(input.profile, providerFamily);
  const selection = resolveSelectedProtocolTarget({
    explicitProtocolTarget,
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
