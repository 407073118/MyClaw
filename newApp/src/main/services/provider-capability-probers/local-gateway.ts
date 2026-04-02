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
 * 将本地网关目录响应归一化为统一模型目录项。
 */
export function normalizeLocalGatewayCatalog(
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

  const normalized: ModelCatalogItem[] = [];
  for (const item of rawItems) {
    const id = typeof item.id === "string"
      ? item.id
      : typeof item.name === "string"
        ? item.name
        : "";
    if (!id) continue;

    normalized.push({
      id,
      name: typeof item.name === "string" ? item.name : id,
      provider,
      providerFlavor,
      contextWindowTokens: toNumber(item.context_length ?? item.context_window),
      source: "provider-catalog",
    });
  }

  return normalized;
}
