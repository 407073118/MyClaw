import type { ProviderKind } from "@myclaw-desktop/shared";

export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  provider: ProviderKind;
  docsLabel: string;
};

export const providerPresets: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai-compatible",
    docsLabel: "Official OpenAI API",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    provider: "openai-compatible",
    docsLabel: "MiniMax OpenAI-compatible API",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    provider: "openai-compatible",
    docsLabel: "Moonshot OpenAI-compatible API",
  },
  {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    provider: "openai-compatible",
    docsLabel: "Qwen DashScope compatible-mode API",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    provider: "anthropic",
    docsLabel: "Official Anthropic Messages API",
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    provider: "openai-compatible",
    docsLabel: "Custom OpenAI-compatible API",
  },
];
