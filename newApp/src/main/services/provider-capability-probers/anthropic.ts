import type { ModelCatalogItem, ProviderFlavor, ProviderKind } from "@shared/contracts";

type CatalogInput = {
  data?: Array<Record<string, unknown>>;
  models?: Array<Record<string, unknown>>;
};

/**
 * 将 Anthropic 风格目录响应归一化为统一模型目录项。
 */
export function normalizeAnthropicCatalog(
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
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;

    normalized.push({
      id,
      name: typeof item.display_name === "string"
        ? item.display_name
        : typeof item.name === "string"
          ? item.name
          : id,
      provider,
      providerFlavor,
      source: "provider-catalog",
    });
  }

  return normalized;
}
