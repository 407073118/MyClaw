import type { ModelProfile, ProviderKind } from "@myclaw-desktop/shared";

export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  baseUrlMode: NonNullable<ModelProfile["baseUrlMode"]>;
  provider: ProviderKind;
  docsLabel: string;
};

export const providerPresets: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    docsLabel: "Official OpenAI API",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com",
    baseUrlMode: "provider-root",
    provider: "anthropic",
    docsLabel: "MiniMax Anthropic-compatible API",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    docsLabel: "Moonshot OpenAI-compatible API",
  },
  {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com",
    baseUrlMode: "provider-root",
    provider: "openai-compatible",
    docsLabel: "Qwen DashScope compatible-mode API",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    baseUrlMode: "provider-root",
    provider: "anthropic",
    docsLabel: "Official Anthropic Messages API",
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    baseUrlMode: "manual",
    provider: "openai-compatible",
    docsLabel: "Custom OpenAI-compatible API",
  },
];

/** 根据现有配置反推最接近的 provider 预设，避免编辑时误显示成 OpenAI。 */
export function resolveProviderPresetId(profile: Pick<ModelProfile, "provider" | "baseUrl" | "model">): string {
  const normalizedBaseUrl = profile.baseUrl.trim().toLowerCase();
  const normalizedModel = profile.model.trim().toLowerCase();

  if (
    normalizedBaseUrl.includes("minimax") ||
    normalizedBaseUrl.includes("minimaxi") ||
    normalizedModel.startsWith("minimax")
  ) {
    return "minimax";
  }
  if (profile.provider === "anthropic" || normalizedBaseUrl.includes("anthropic")) {
    return "anthropic";
  }
  if (normalizedBaseUrl.includes("dashscope.aliyuncs.com") || normalizedModel.startsWith("qwen")) {
    return "qwen";
  }
  if (normalizedBaseUrl.includes("moonshot")) {
    return "moonshot";
  }
  if (normalizedBaseUrl.includes("openai.com")) {
    return "openai";
  }
  return "custom";
}

/** 根据具体 profile 解析最贴近的预设，用于 UI 展示与回填。 */
export function resolveProviderPreset(
  profile: Pick<ModelProfile, "provider" | "baseUrl" | "model">,
): ProviderPreset | undefined {
  const presetId = resolveProviderPresetId(profile);
  return providerPresets.find((item) => item.id === presetId);
}
