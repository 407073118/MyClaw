import { describe, expect, it } from "vitest";

import { normalizeManagedCitation, normalizeVendorCitation } from "../../../src/main/services/model-runtime/citation-normalizer";

describe("citation normalizer", () => {
  it("normalizes url citations from vendor-native search output", () => {
    const citation = normalizeVendorCitation({
      sourceType: "vendor-web-search",
      traceRef: "ws_1",
      annotation: {
        url: "https://example.com/news",
        title: "Latest News",
        text: "OpenAI released updates.",
        start_index: 0,
        end_index: 23,
      },
    });

    expect(citation).toEqual(
      expect.objectContaining({
        url: "https://example.com/news",
        title: "Latest News",
        domain: "example.com",
        sourceType: "vendor-web-search",
        traceRef: "ws_1",
        snippet: "OpenAI released updates",
        startIndex: 0,
        endIndex: 23,
      }),
    );
  });

  it("normalizes local web search results into citations", () => {
    const citation = normalizeManagedCitation({
      sourceType: "local-web-search",
      traceRef: "local_search_1",
      item: {
        url: "https://docs.example.com/page",
        title: "Example Docs",
        snippet: "Structured local result",
      },
    });

    expect(citation).toEqual(
      expect.objectContaining({
        url: "https://docs.example.com/page",
        title: "Example Docs",
        domain: "docs.example.com",
        snippet: "Structured local result",
        sourceType: "local-web-search",
        traceRef: "local_search_1",
      }),
    );
  });

  it("normalizes http fetch metadata into citations", () => {
    const citation = normalizeManagedCitation({
      sourceType: "http-fetch",
      traceRef: "fetch_1",
      item: {
        url: "https://example.com/article",
        title: "Fetched Article",
        snippet: "Readable body excerpt",
      },
    });

    expect(citation).toEqual(
      expect.objectContaining({
        url: "https://example.com/article",
        title: "Fetched Article",
        domain: "example.com",
        snippet: "Readable body excerpt",
        sourceType: "http-fetch",
        traceRef: "fetch_1",
      }),
    );
  });
});
