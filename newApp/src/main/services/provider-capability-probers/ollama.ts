import type { ModelCatalogItem, ProviderFlavor, ProviderKind, JsonValue } from "@shared/contracts";

type CatalogInput = {
  models?: Array<Record<string, unknown>>;
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
 * 将 Ollama 风格目录响应归一化为统一模型目录项。
 */
export function normalizeOllamaCatalog(
  payload: unknown,
  provider: ProviderKind,
  providerFlavor: ProviderFlavor,
): ModelCatalogItem[] {
  const input = (payload && typeof payload === "object" ? payload : {}) as CatalogInput;
  const rawItems = Array.isArray(input.models)
    ? input.models
    : Array.isArray(input.data)
      ? input.data
      : [];

  return rawItems
    .map((item) => {
      const id = typeof item.name === "string"
        ? item.name
        : typeof item.id === "string"
          ? item.id
          : "";
      if (!id) return null;

      const details = item.details && typeof item.details === "object"
        ? item.details as Record<string, unknown>
        : {};

      return {
        id,
        name: typeof item.name === "string" ? item.name : id,
        provider,
        providerFlavor,
        contextWindowTokens: toNumber(details.context_length ?? item.context_length),
        source: "provider-catalog" as const,
        raw: item as Record<string, JsonValue>,
      } as ModelCatalogItem;
    })
    .filter((item): item is ModelCatalogItem => item !== null);
}
