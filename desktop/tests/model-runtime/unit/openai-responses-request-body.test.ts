import { describe, expect, it } from "vitest";

import type { CanonicalToolSpec } from "@shared/contracts";
import { buildOpenAiResponsesRequestBody } from "../../../src/main/services/model-runtime/protocols/openai-responses-driver";

describe("openai responses request body", () => {
  it("maps xhigh reasoning effort into a native reasoning object", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "hello" }],
      [],
      "xhigh",
    );

    expect(body).toMatchObject({
      model: "gpt-5.4",
      reasoning: {
        effort: "xhigh",
      },
    });
  });

  it("can disable response storage for privacy-sensitive profiles", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "hello" }],
      [],
      "medium",
      { disableResponseStorage: true },
    );

    expect(body).toMatchObject({
      model: "gpt-5.4",
      store: false,
    });
  });

  it("can continue a server-side response chain with previous_response_id", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "hello" }],
      [],
      "medium",
      { previousResponseId: "resp_prev_123" },
    );

    expect(body).toMatchObject({
      model: "gpt-5.4",
      previous_response_id: "resp_prev_123",
    });
  });

  it("injects native web_search and removes the duplicate local web_search function when vendor-native routing is enabled", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "latest OpenAI news" }],
      [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Local web search fallback",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "fs_read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        },
      ],
      "medium",
      {
        capabilityRoutes: [
          {
            capabilityId: "search",
            routeType: "vendor-native",
            providerFamily: "openai-native",
            protocolTarget: "openai-responses",
            nativeToolName: "web_search",
            fallbackToolChain: [],
            reason: "native_web_search_available",
          },
        ],
      },
    );

    expect(body).toMatchObject({
      tools: [
        { type: "web_search" },
        {
          type: "function",
          name: "fs_read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      ],
    });
    expect(body.tools).toHaveLength(2);
  });

  it("injects the native computer tool when vendor-native computer routing is enabled", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "open the page and click login" }],
      [
        {
          type: "function",
          function: {
            name: "fs_read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        },
      ],
      "medium",
      {
        capabilityRoutes: [
          {
            capabilityId: "computer",
            routeType: "vendor-native",
            providerFamily: "openai-native",
            protocolTarget: "openai-responses",
            nativeToolName: "computer",
            fallbackToolChain: [],
            reason: "native_computer_available",
          },
        ],
      },
    );

    expect(body).toMatchObject({
      tools: [
        { type: "computer" },
        {
          type: "function",
          name: "fs_read",
        },
      ],
    });
  });

  it("injects the native file_search tool with vector store configuration when knowledge retrieval routing is enabled", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "summarize the handbook" }],
      [
        {
          type: "function",
          function: {
            name: "fs_read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        },
      ],
      "medium",
      {
        capabilityRoutes: [
          {
            capabilityId: "knowledge-retrieval",
            routeType: "vendor-native",
            providerFamily: "openai-native",
            protocolTarget: "openai-responses",
            nativeToolName: "file_search",
            fallbackToolChain: [],
            reason: "native_file_search_available",
          },
        ],
        nativeFileSearch: {
          vectorStoreIds: ["vs_knowledge_1", "vs_knowledge_2"],
          maxNumResults: 6,
          includeSearchResults: true,
        },
      },
    );

    expect(body).toMatchObject({
      tools: [
        {
          type: "file_search",
          vector_store_ids: ["vs_knowledge_1", "vs_knowledge_2"],
          max_num_results: 6,
        },
        {
          type: "function",
          name: "fs_read",
        },
      ],
      include: ["output[*].file_search_call.search_results"],
    });
  });

  it("switches native research tasks into background mode, keeps storage enabled, and disables foreground streaming", () => {
    const body = buildOpenAiResponsesRequestBody(
      "o3-deep-research",
      [{ role: "user", content: "research the chip market" }],
      [{ type: "web_search" }],
      "medium",
      {
        backgroundMode: {
          enabled: true,
          reason: "deep_research_model",
          pollAfterMs: 2000,
        },
      },
    );

    expect(body).toMatchObject({
      model: "o3-deep-research",
      background: true,
      store: true,
      stream: false,
      tools: [{ type: "web_search" }],
    });
  });

  it("builds Qwen-native responses requests with official thinking fields and vendor-native tools", () => {
    const body = buildOpenAiResponsesRequestBody(
      "qwen-max",
      [{ role: "user", content: "research this topic" }],
      [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Local web search fallback",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        },
      ],
      "high",
      {
        providerFamily: "qwen-native",
        capabilityRoutes: [
          {
            capabilityId: "search",
            routeType: "vendor-native",
            providerFamily: "qwen-native",
            protocolTarget: "openai-responses",
            nativeToolName: "web_search",
            fallbackToolChain: [],
            reason: "native_web_search_available",
          },
          {
            capabilityId: "page-read",
            routeType: "vendor-native",
            providerFamily: "qwen-native",
            protocolTarget: "openai-responses",
            nativeToolName: "web_extractor",
            fallbackToolChain: [],
            reason: "native_web_extractor_available",
          },
          {
            capabilityId: "computer",
            routeType: "vendor-native",
            providerFamily: "qwen-native",
            protocolTarget: "openai-responses",
            nativeToolName: "code_interpreter",
            fallbackToolChain: [],
            reason: "native_code_interpreter_available",
          },
          {
            capabilityId: "knowledge-retrieval",
            routeType: "vendor-native",
            providerFamily: "qwen-native",
            protocolTarget: "openai-responses",
            nativeToolName: "file_search",
            fallbackToolChain: [],
            reason: "native_file_search_available",
          },
        ],
        nativeFileSearch: {
          vectorStoreIds: ["vs_qwen_1"],
        },
        previousResponseId: "resp_qwen_prev",
      },
    );

    expect(body).toMatchObject({
      model: "qwen-max",
      enable_thinking: true,
      thinking_budget: 8192,
      parallel_tool_calls: true,
      previous_response_id: "resp_qwen_prev",
      stream: true,
      tools: [
        { type: "web_search" },
        { type: "web_extractor" },
        { type: "code_interpreter" },
        {
          type: "file_search",
          vector_store_ids: ["vs_qwen_1"],
        },
      ],
    });
    expect(body).not.toHaveProperty("reasoning");
  });

  it("drops unsupported OpenAI-native background fields for Qwen responses requests", () => {
    const body = buildOpenAiResponsesRequestBody(
      "qwen-max",
      [{ role: "user", content: "research this topic" }],
      [],
      "medium",
      {
        providerFamily: "qwen-native",
        backgroundMode: {
          enabled: true,
          reason: "forced_for_test",
          pollAfterMs: 2000,
        },
      },
    );

    expect(body).not.toHaveProperty("background");
    expect(body).not.toHaveProperty("store");
    expect(body).toMatchObject({
      stream: true,
      enable_thinking: true,
      thinking_budget: 4096,
    });
  });

  it("adds web_search automatically when qwen-native web_extractor is requested", () => {
    const body = buildOpenAiResponsesRequestBody(
      "qwen3.6-plus",
      [{ role: "user", content: "extract the latest homepage summary" }],
      [],
      "medium",
      {
        providerFamily: "qwen-native",
        capabilityRoutes: [
          {
            capabilityId: "page-read",
            routeType: "vendor-native",
            providerFamily: "qwen-native",
            protocolTarget: "openai-responses",
            nativeToolName: "web_extractor",
            fallbackToolChain: [],
            reason: "native_web_extractor_available",
          },
        ],
      },
    );

    expect(body).toMatchObject({
      tools: [
        { type: "web_search" },
        { type: "web_extractor" },
      ],
    });
  });

  it("maps canonical raw Responses tools into qwen-native built-ins such as MCP", () => {
    const toolRegistry: CanonicalToolSpec[] = [
      {
        id: "qwen_docs_mcp",
        name: "qwen_docs_mcp",
        description: "Vendor-native docs MCP",
        parameters: {
          type: "object",
          properties: {},
        },
        source: "mcp",
        metadata: {
          rawResponsesTool: {
            type: "mcp",
            server_label: "docs",
            server_url: "https://mcp.example.com/sse",
          },
        },
      },
    ];
    const body = buildOpenAiResponsesRequestBody(
      "qwen3.6-plus",
      [{ role: "user", content: "search docs" }],
      [{
        type: "function",
        function: {
          name: "qwen_docs_mcp",
          description: "Vendor-native docs MCP",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      }],
      "medium",
      {
        providerFamily: "qwen-native",
        toolRegistry,
      },
    );

    expect(body.tools).toEqual([
      {
        type: "mcp",
        server_label: "docs",
        server_url: "https://mcp.example.com/sse",
      },
    ]);
  });
});
