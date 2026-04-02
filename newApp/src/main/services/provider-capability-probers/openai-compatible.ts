import type { ModelCatalogItem, ProviderFlavor, ProviderKind } from "@shared/contracts";

type CatalogInput = {
  data?: Array<Record<string, unknown>>;
  models?: Array<Record<string, unknown>>;
};

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * 将通用 OpenAI 兼容目录响应归一化为统一模型目录项。
 */
export function normalizeOpenAiCompatibleCatalog(
  payload: unknown,
  provider: ProviderKind,
  providerFlavor: ProviderFlavor,
): ModelCatalogItem[] {
  const input = (payload && typeof payload === "object" ? payload : {}) as CatalogInput;
  const rawItems = Array.isArray(input.data)
    ? input.data
    : Array.isArray(input.models)
      ? input.models
      : [];

  const normalized: ModelCatalogItem[] = [];
  for (const item of rawItems) {
    const id = typeof item.id === "string"
      ? item.id
      : typeof item.name === "string"
        ? item.name
        : "";
    if (!id) continue;

    const supportedParameters = Array.isArray(item.supported_parameters)
      ? item.supported_parameters
      : [];

    normalized.push({
      id,
      name: typeof item.name === "string" ? item.name : id,
      provider,
      providerFlavor,
      contextWindowTokens: toNumber(item.context_length ?? item.context_window),
      maxInputTokens: toNumber(item.max_input_tokens),
      maxOutputTokens: toNumber(item.max_output_tokens ?? item.max_completion_tokens ?? item.max_tokens),
      supportsTools: supportedParameters.includes("tools"),
      supportsStreaming: supportedParameters.includes("stream"),
      source: "provider-catalog",
    });
  }

  return normalized;
}
