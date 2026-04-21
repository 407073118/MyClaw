import type { ModelProfile, ProtocolTarget, ProviderFamily, VendorFamily } from "@shared/contracts";
import { createBrMiniMaxProfile, isBrMiniMaxProfile } from "@shared/br-minimax";
import { inferProviderFamily } from "./model-runtime/family-policy-resolver";
import { inferVendorFamily } from "./model-runtime/vendor-runtime-policy-resolver";

type ManagedProfileInput = Partial<Omit<ModelProfile, "id">>;

/** 为 family/vendor 推断补齐最小字段，避免保存阶段的局部输入被旧 heuristics 误判。 */
function buildInferenceProfile(
  profile: Partial<ModelProfile>,
): Pick<
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
> {
  return {
    provider: profile.provider ?? "openai-compatible",
    providerFlavor: profile.providerFlavor,
    providerFamily: profile.providerFamily,
    vendorFamily: profile.vendorFamily,
    protocolTarget: profile.protocolTarget,
    savedProtocolPreferences: profile.savedProtocolPreferences,
    baseUrl: profile.baseUrl ?? "",
    model: profile.model ?? "",
    deploymentProfile: profile.deploymentProfile,
  };
}

/** 归一化一等厂商身份字段，优先修正被旧 heuristics 写坏的 family/vendor。 */
function resolveFirstClassVendorIdentityPatch(
  profile: Partial<ModelProfile>,
): Pick<ModelProfile, "providerFamily" | "vendorFamily"> | null {
  const inferenceProfile = buildInferenceProfile(profile);
  const providerFamily = inferProviderFamily({
    provider: inferenceProfile.provider,
    providerFlavor: inferenceProfile.providerFlavor,
    providerFamily: inferenceProfile.providerFamily,
    protocolTarget: inferenceProfile.protocolTarget,
    experienceProfileId: undefined,
    baseUrl: inferenceProfile.baseUrl,
    model: inferenceProfile.model,
  });
  const vendorFamily = inferVendorFamily(inferenceProfile);

  if (
    vendorFamily !== "qwen"
    && vendorFamily !== "kimi"
    && vendorFamily !== "volcengine-ark"
  ) {
    return null;
  }

  return {
    providerFamily,
    vendorFamily,
  };
}

/** 判断是否属于缺少来源标记的旧版一等厂商兼容默认路由，命中后允许迁移到官方默认协议。 */
function isLegacyFirstClassVendorCompatDefault(
  profile: Partial<ModelProfile>,
  vendorFamily: VendorFamily | undefined,
): boolean {
  if (profile.protocolSelectionSource !== undefined) {
    return false;
  }

  if (profile.protocolTarget !== "openai-chat-compatible") {
    return false;
  }

  const savedPreferences = profile.savedProtocolPreferences ?? [];

  if (vendorFamily === "qwen") {
    return savedPreferences.length === 0
      || (
        savedPreferences[0] === "openai-chat-compatible"
        && savedPreferences.includes("openai-responses")
      );
  }

  if (vendorFamily === "kimi") {
    return savedPreferences.length === 0
      || (
        savedPreferences[0] === "openai-chat-compatible"
        && savedPreferences.includes("anthropic-messages")
      );
  }

  return false;
}

/** 判断当前配置是否已经保存过显式协议选择，避免用户主动选择被默认迁移覆盖。 */
function hasExplicitProtocolSelection(
  profile: Partial<ModelProfile>,
  vendorFamily: VendorFamily | undefined,
): boolean {
  if (
    profile.protocolSelectionSource === "saved"
    || profile.protocolSelectionSource === "probe"
    || profile.protocolSelectionSource === "fallback"
  ) {
    return true;
  }

  if (isLegacyFirstClassVendorCompatDefault(profile, vendorFamily)) {
    return false;
  }

  if (profile.protocolTarget) {
    return true;
  }

  return (profile.savedProtocolPreferences?.length ?? 0) > 0;
}

/** 仅在未保存显式路线时，回填一等厂商的默认协议路线。 */
function resolveFirstClassVendorDefaultRoutePatch(
  vendorFamily: VendorFamily,
): Pick<ModelProfile, "protocolTarget" | "savedProtocolPreferences" | "protocolSelectionSource"> | null {
  if (vendorFamily === "qwen") {
    return {
      protocolTarget: "openai-responses" satisfies ProtocolTarget,
      savedProtocolPreferences: ["openai-responses"],
      protocolSelectionSource: "registry-default",
    };
  }

  if (vendorFamily === "kimi") {
    return {
      protocolTarget: "anthropic-messages" satisfies ProtocolTarget,
      savedProtocolPreferences: ["anthropic-messages"],
      protocolSelectionSource: "registry-default",
    };
  }

  return null;
}

/** 对已识别的一等供应商模型做路线归一化，自动修复历史兼容路线。 */
export function normalizeFirstClassVendorRoute<T extends Partial<ModelProfile>>(profile: T): T {
  const identityPatch = resolveFirstClassVendorIdentityPatch(profile);
  if (!identityPatch) {
    return profile;
  }

  if (hasExplicitProtocolSelection(profile, identityPatch.vendorFamily)) {
    return {
      ...profile,
      ...identityPatch,
    };
  }

  if (!identityPatch.vendorFamily) {
    return {
      ...profile,
      ...identityPatch,
    };
  }

  const defaultRoutePatch = resolveFirstClassVendorDefaultRoutePatch(identityPatch.vendorFamily);
  return {
    ...profile,
    ...identityPatch,
    ...(defaultRoutePatch ?? {}),
  };
}

/** 对托管模型类型做写入归一化，避免 UI 外部修改破坏锁定字段。 */
export function coerceManagedProfileWrite(
  existing: ModelProfile | null,
  input: ManagedProfileInput,
): ManagedProfileInput {
  // 如果用户显式切换了 provider 或 providerFlavor，说明意图是变更供应商类型，
  // 此时应放行整个 input，不再强制归一化为原有托管类型。
  const isExistingBrMiniMax = isBrMiniMaxProfile(existing);
  const isInputBrMiniMax = input.providerFlavor === "br-minimax";

  if (isExistingBrMiniMax && !isInputBrMiniMax && input.provider !== undefined) {
    return normalizeFirstClassVendorRoute(input);
  }

  const shouldManageAsBrMiniMax = isExistingBrMiniMax || isInputBrMiniMax;

  if (!shouldManageAsBrMiniMax) {
    const mergedCandidate = normalizeFirstClassVendorRoute({
      ...(existing ?? {}),
      ...input,
    } satisfies Partial<ModelProfile>);
    return {
      ...input,
      ...(mergedCandidate.providerFamily ? { providerFamily: mergedCandidate.providerFamily } : {}),
      ...(mergedCandidate.vendorFamily ? { vendorFamily: mergedCandidate.vendorFamily } : {}),
      ...(mergedCandidate.protocolTarget ? { protocolTarget: mergedCandidate.protocolTarget } : {}),
      ...(mergedCandidate.savedProtocolPreferences ? { savedProtocolPreferences: mergedCandidate.savedProtocolPreferences } : {}),
      ...(mergedCandidate.protocolSelectionSource ? { protocolSelectionSource: mergedCandidate.protocolSelectionSource } : {}),
    };
  }

  const apiKey = (input.apiKey ?? existing?.apiKey ?? "").trim();
  const managedProfile = createBrMiniMaxProfile({ apiKey });
  const model = (input.model ?? existing?.model ?? managedProfile.model)?.trim() || managedProfile.model;
  const protocolTarget = input.protocolTarget ?? existing?.protocolTarget;

  return {
    ...managedProfile,
    model,
    ...(protocolTarget ? { protocolTarget } : {}),
  };
}
