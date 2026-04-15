import { describe, expect, it } from "vitest";

import { resolveNativeFileSearchConfig } from "../../../src/main/services/model-runtime/tool-middleware";

describe("tool middleware", () => {
  it("prefers explicit responsesApiConfig file search settings", () => {
    const resolved = resolveNativeFileSearchConfig({
      responsesApiConfig: {
        fileSearch: {
          vectorStoreIds: ["vs_knowledge_1"],
          maxNumResults: 8,
          includeSearchResults: true,
        },
      },
      requestBody: {
        file_search: {
          vector_store_ids: ["vs_request_body_only"],
        },
      },
    } as never);

    expect(resolved).toEqual({
      vectorStoreIds: ["vs_knowledge_1"],
      maxNumResults: 8,
      includeSearchResults: true,
    });
  });

  it("falls back to requestBody native file search settings for advanced profiles", () => {
    const resolved = resolveNativeFileSearchConfig({
      responsesApiConfig: {},
      requestBody: {
        nativeFileSearch: {
          vectorStoreIds: ["vs_request_body_1", "vs_request_body_2"],
          maxNumResults: 6,
          includeSearchResults: false,
        },
      },
    } as never);

    expect(resolved).toEqual({
      vectorStoreIds: ["vs_request_body_1", "vs_request_body_2"],
      maxNumResults: 6,
      includeSearchResults: false,
    });
  });

  it("returns null when neither config source contains vector stores", () => {
    const resolved = resolveNativeFileSearchConfig({
      responsesApiConfig: {
        fileSearch: {
          vectorStoreIds: [],
        },
      },
      requestBody: {},
    } as never);

    expect(resolved).toBeNull();
  });
});
