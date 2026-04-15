import type { ModelProfile, ProtocolTarget } from "@shared/contracts";

import { resolveReasoningControlSpec } from "./reasoning-controls";

type ModelProfileDisplayInput = Partial<
  Pick<
    ModelProfile,
    "provider" | "providerFlavor" | "providerFamily" | "vendorFamily" | "baseUrl" | "model" | "discoveredCapabilities"
  >
>;

export type ModelRuntimeStatusItem = {
  key: string;
  label: string;
  tone: "vendor" | "model" | "protocol" | "thinking" | "tool-stack";
};

export function formatProtocolTargetLabel(target?: ProtocolTarget | null): string | null {
  if (!target) return null;
  if (target === "openai-responses") return "OpenAI Responses";
  if (target === "anthropic-messages") return "Anthropic Messages";
  return "OpenAI Compatible";
}

/** 将协议选择来源格式化成适合在 renderer 中展示的简短标签。 */
export function formatProtocolSelectionSourceLabel(
  source?: "saved" | "probe" | "registry-default" | "fallback" | null,
): string | null {
  if (!source) return null;
  if (source === "saved") return "Saved";
  if (source === "probe") return "Probe Recommended";
  if (source === "registry-default") return "Registry Default";
  return "Fallback";
}

/** 根据 vendor family、provider flavor 与 URL 特征推断模型在 UI 中的供应商显示名。 */
export function getModelVendorLabel(profile: ModelProfileDisplayInput | null | undefined): string {
  if (!profile) return "Other";

  const providerFlavor = profile.providerFlavor ?? "";
  const providerFamily = profile.providerFamily ?? "";
  const vendorFamily = profile.vendorFamily ?? "";
  const baseUrl = (profile.baseUrl ?? "").toLowerCase();
  const model = (profile.model ?? "").toLowerCase();

  if (
    vendorFamily === "qwen"
    || providerFlavor === "qwen"
    || providerFamily === "qwen-native"
    || providerFamily === "qwen-dashscope"
    || baseUrl.includes("dashscope.aliyuncs.com")
    || model.startsWith("qwen")
  ) {
    return "Qwen";
  }

  if (providerFlavor === "br-minimax" || providerFamily === "br-minimax") return "BR MiniMax";
  if (vendorFamily === "openai" || providerFlavor === "openai" || baseUrl.includes("openai")) return "OpenAI";
  if (vendorFamily === "anthropic" || profile.provider === "anthropic" || baseUrl.includes("anthropic")) return "Anthropic";
  if (vendorFamily === "deepseek" || providerFlavor === "deepseek" || providerFamily === "deepseek" || baseUrl.includes("deepseek")) return "DeepSeek";
  if (vendorFamily === "minimax" || baseUrl.includes("minimax") || baseUrl.includes("minimaxi") || model.startsWith("minimax")) return "MiniMax";
  if (providerFlavor === "moonshot" || providerFamily === "moonshot-native" || baseUrl.includes("moonshot")) return "Moonshot";
  if (vendorFamily === "volcengine-ark" || providerFlavor === "volcengine-ark" || providerFamily === "volcengine-ark" || baseUrl.includes("volces.com") || baseUrl.includes("volcengine")) return "Volcengine Ark";
  if (baseUrl.includes("azure")) return "Azure";
  if (baseUrl.includes("mistral")) return "Mistral";
  return profile.provider ?? "Other";
}

/** 根据能力目录里的 thinking 控制形态，生成用户可读的推理模式标签。 */
export function getThinkingModeLabel(profile: Pick<ModelProfile, "discoveredCapabilities"> | null | undefined): string {
  const spec = resolveReasoningControlSpec(profile);
  if (spec.kind === "budget") return "Thinking Budget";
  if (spec.kind === "boolean") return "Thinking Toggle";
  if (spec.kind === "always_on") return "Thinking Always On";
  if (spec.kind === "unsupported") return "Thinking Unavailable";
  return "Reasoning Effort";
}

/** 灏嗗師鐢?tool stack 鏍囪瘑鏍煎紡鍖栨垚 renderer 鍙洿鎺ュ睍绀虹殑绠€鐭爣绛俱€?*/
export function formatNativeToolStackLabel(
  profile: Pick<ModelProfile, "discoveredCapabilities"> | null | undefined,
): string | null {
  const nativeToolStackId = profile?.discoveredCapabilities?.nativeToolStackId;
  return nativeToolStackId ? `tool-stack:${nativeToolStackId}` : null;
}

/** 缁熶竴鏋勫缓 vendor / model / protocol / thinking / tool stack 鐨勮繍琛屾€佹爣绛撅紝渚夸簬澶氫釜椤甸潰鍏变韩銆?*/
export function buildModelRuntimeStatusItems(
  profile: (ModelProfileDisplayInput & Pick<ModelProfile, "protocolTarget">) | null | undefined,
): ModelRuntimeStatusItem[] {
  if (!profile) return [];

  const toolStackLabel = formatNativeToolStackLabel(profile);
  return [
    { key: "vendor", label: getModelVendorLabel(profile), tone: "vendor" },
    profile.model ? { key: "model", label: profile.model, tone: "model" } : null,
    profile.protocolTarget
      ? { key: "protocol", label: formatProtocolTargetLabel(profile.protocolTarget) ?? "", tone: "protocol" }
      : null,
    { key: "thinking", label: getThinkingModeLabel(profile), tone: "thinking" },
    toolStackLabel ? { key: "tool-stack", label: toolStackLabel, tone: "tool-stack" } : null,
  ].filter((item): item is ModelRuntimeStatusItem => Boolean(item?.label));
}
