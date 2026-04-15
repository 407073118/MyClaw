import type { CitationRecord, CitationSourceType } from "@shared/contracts";

type VendorCitationNormalizationInput = {
  sourceType: Extract<CitationSourceType, "vendor-web-search" | "file-search">;
  traceRef?: string | null;
  annotation: {
    url?: string | null;
    title?: string | null;
    file_id?: string | null;
    filename?: string | null;
    text?: string | null;
    index?: number | null;
    start_index?: number | null;
    end_index?: number | null;
  };
};

type ManagedCitationNormalizationInput = {
  sourceType: Exclude<CitationSourceType, "vendor-web-search">;
  traceRef?: string | null;
  item: {
    url: string;
    title?: string | null;
    snippet?: string | null;
    publishedAt?: string | null;
  };
};

/** 从来源 URL 中抽取域名，供 UI 与持久化统一展示。 */
function extractCitationDomain(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** 根据原文和索引截取片段，避免后续多处重复裁剪。 */
function resolveSnippet(
  text: string | null | undefined,
  startIndex: number | null | undefined,
  endIndex: number | null | undefined,
): string | null {
  if (!text) {
    return null;
  }
  if (typeof startIndex === "number" && typeof endIndex === "number") {
    return text.slice(startIndex, endIndex) || null;
  }
  return text;
}

/** 归一化厂商原生 citation。 */
export function normalizeVendorCitation(input: VendorCitationNormalizationInput): CitationRecord {
  const startIndex = typeof input.annotation.start_index === "number"
    ? input.annotation.start_index
    : typeof input.annotation.index === "number"
      ? input.annotation.index
      : null;
  const endIndex = typeof input.annotation.end_index === "number" ? input.annotation.end_index : null;
  const traceRef = input.traceRef ?? null;
  const url = input.annotation.url ?? null;
  const fileId = input.annotation.file_id ?? null;
  const filename = input.annotation.filename ?? null;

  return {
    id: [traceRef ?? "citation", url ?? fileId ?? "file", startIndex ?? "na", endIndex ?? "na"].join(":"),
    url,
    title: input.annotation.title ?? filename ?? null,
    domain: url ? extractCitationDomain(url) : null,
    snippet: resolveSnippet(input.annotation.text, startIndex, endIndex),
    startIndex,
    endIndex,
    fileId,
    filename,
    sourceType: input.sourceType,
    traceRef,
  };
}

/** 归一化本地 managed runtime citation。 */
export function normalizeManagedCitation(input: ManagedCitationNormalizationInput): CitationRecord {
  const traceRef = input.traceRef ?? null;

  return {
    id: [traceRef ?? "citation", input.item.url].join(":"),
    url: input.item.url,
    title: input.item.title ?? null,
    domain: extractCitationDomain(input.item.url),
    snippet: input.item.snippet ?? null,
    publishedAt: input.item.publishedAt ?? null,
    sourceType: input.sourceType,
    traceRef,
  };
}
