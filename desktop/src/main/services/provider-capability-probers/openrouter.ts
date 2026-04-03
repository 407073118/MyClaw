import type { ModelCatalogItem, ProviderFlavor, ProviderKind } from "@shared/contracts";

type CatalogInput = {
  data?: Array<Record<string, unknown>>;
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
 * 将 OpenRouter 模型目录响应归一化为统一模型目录项。
 */
export function normalizeOpenRouterCatalog(
  payload: unknown,
  provider: ProviderKind,
  providerFlavor: ProviderFlavor,
): ModelCatalogItem[] {
  const input = (payload && typeof payload === "object" ? payload : {}) as CatalogInput;
  const rawItems = Array.isArray(input.data) ? input.data : [];

  const normalized: ModelCatalogItem[] = [];
  for (const item of rawItems) {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;

    const topProvider = item.top_provider && typeof item.top_provider === "object"
      ? item.top_provider as Record<string, unknown>
      : {};
    const supportedParameters = Array.isArray(item.supported_parameters)
      ? item.supported_parameters
      : [];

    normalized.push({
      id,
      name: typeof item.name === "string" ? item.name : id,
      provider,
      providerFlavor,
      contextWindowTokens: toNumber(item.context_length),
      maxOutputTokens: toNumber(topProvider.max_completion_tokens ?? item.max_output_tokens ?? item.max_tokens),
      supportsTools: supportedParameters.includes("tools"),
      supportsStreaming: supportedParameters.includes("stream"),
      source: "provider-catalog",
    });
  }

  return normalized;
}
