import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Logger tests
// ---------------------------------------------------------------------------

describe("Logger", () => {
  it("createLogger returns logger with all methods", async () => {
    const { createLogger } = await import("../src/main/services/logger");
    const logger = createLogger("test");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("logger methods call console with formatted message", async () => {
    const { createLogger } = await import("../src/main/services/logger");
    const logger = createLogger("test-module");

    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("hello world");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0][0] as string;
    expect(logged).toContain("[INFO]");
    expect(logged).toContain("[test-module]");
    expect(logged).toContain("hello world");

    consoleSpy.mockRestore();
  });

  it("logger includes context in formatted message", async () => {
    const { createLogger } = await import("../src/main/services/logger");
    const logger = createLogger("ctx-test");

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("something failed", { code: 42, reason: "timeout" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0][0] as string;
    expect(logged).toContain('"code":42');
    expect(logged).toContain('"reason":"timeout"');

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Model client URL resolution tests
// ---------------------------------------------------------------------------

describe("Model Client URL Resolution", () => {
  it("resolves dashscope URL with compatible-mode", async () => {
    const { resolveModelEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveModelEndpointUrl({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      baseUrl: "https://dashscope.aliyuncs.com",
      baseUrlMode: "provider-root",
      apiKey: "test",
      model: "qwen-plus",
    });
    expect(url).toContain("compatible-mode");
    expect(url).toContain("chat/completions");
  });

  it("resolves coding.dashscope URL without compatible-mode", async () => {
    const { resolveModelEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveModelEndpointUrl({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      baseUrl: "https://coding.dashscope.aliyuncs.com",
      baseUrlMode: "provider-root",
      apiKey: "test",
      model: "qwen-coder",
    });
    expect(url).not.toContain("compatible-mode");
    expect(url).toContain("/v1/chat/completions");
  });

  it("resolves coding.dashscope anthropic route to apps/anthropic", async () => {
    const { resolveProtocolEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveProtocolEndpointUrl({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      baseUrl: "https://coding.dashscope.aliyuncs.com",
      baseUrlMode: "provider-root",
      apiKey: "test",
      model: "qwen3.5-plus",
    }, "anthropic-messages");
    expect(url).toBe("https://coding.dashscope.aliyuncs.com/apps/anthropic/messages");
  });

  it("resolves dashscope responses route with compatible-mode preserved", async () => {
    const { resolveProtocolEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveProtocolEndpointUrl({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com",
      baseUrlMode: "provider-root",
      apiKey: "test",
      model: "qwen-plus",
    }, "openai-responses");
    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/responses");
  });

  it("resolves generic provider URL with /v1/chat/completions", async () => {
    const { resolveModelEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveModelEndpointUrl({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test",
      model: "gpt-4",
    });
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("resolves Anthropic URL with /v1/messages", async () => {
    const { resolveModelEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveModelEndpointUrl({
      id: "test",
      name: "Test",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      baseUrlMode: "provider-root",
      apiKey: "test",
      model: "claude-3-opus-20240229",
    });
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("keeps manual base URLs unchanged before appending the chat endpoint", async () => {
    const { resolveModelEndpointUrl } = await import("../src/main/services/model-client");
    const url = resolveModelEndpointUrl({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      baseUrl: "https://custom.example.com/custom-root",
      baseUrlMode: "manual",
      apiKey: "test",
      model: "gpt-4",
    });
    expect(url).toBe("https://custom.example.com/custom-root/chat/completions");
  });
});

describe("Model Client request headers", () => {
  it("builds bearer auth headers for openai-compatible providers", async () => {
    const { buildRequestHeaders } = await import("../src/main/services/model-client");
    const headers = buildRequestHeaders({
      id: "test",
      name: "Test",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      headers: { "x-extra": "1" },
    });
    expect(headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer test-key",
      "x-extra": "1",
    });
  });

  it("builds anthropic auth headers with anthropic-version", async () => {
    const { buildRequestHeaders } = await import("../src/main/services/model-client");
    const headers = buildRequestHeaders({
      id: "test",
      name: "Test",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-key",
      model: "claude-sonnet",
      headers: {},
    });
    expect(headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("adds the DashScope session cache header only on Qwen responses requests when configured", async () => {
    const { buildProtocolRequestHeaders } = await import("../src/main/services/model-client");
    const profile = {
      id: "test",
      name: "Test",
      provider: "openai-compatible" as const,
      providerFlavor: "qwen" as const,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "test-key",
      model: "qwen3.6-plus",
      headers: {},
      responsesApiConfig: {
        sessionCache: "enable" as const,
      },
    };

    expect(buildProtocolRequestHeaders(profile, "openai-responses")).toMatchObject({
      "x-dashscope-session-cache": "enable",
    });
    expect(buildProtocolRequestHeaders(profile, "openai-chat-compatible")).not.toHaveProperty("x-dashscope-session-cache");
  });
});

// ---------------------------------------------------------------------------
// MCP Manager — inferToolRisk
// ---------------------------------------------------------------------------

describe("MCP Manager inferToolRisk", () => {
  it("classifies exec-like tools as Exec", async () => {
    const { inferToolRisk } = await import("../src/main/services/mcp-server-manager");
    const { ToolRiskCategory } = await import("../shared/contracts");

    expect(inferToolRisk("execute_command")).toBe(ToolRiskCategory.Exec);
    expect(inferToolRisk("run_script")).toBe(ToolRiskCategory.Exec);
    expect(inferToolRisk("shell_exec")).toBe(ToolRiskCategory.Exec);
  });

  it("classifies write-like tools as Write", async () => {
    const { inferToolRisk } = await import("../src/main/services/mcp-server-manager");
    const { ToolRiskCategory } = await import("../shared/contracts");

    expect(inferToolRisk("create_file")).toBe(ToolRiskCategory.Write);
    expect(inferToolRisk("delete_record")).toBe(ToolRiskCategory.Write);
    expect(inferToolRisk("update_config")).toBe(ToolRiskCategory.Write);
  });

  it("classifies network-like tools as Network", async () => {
    const { inferToolRisk } = await import("../src/main/services/mcp-server-manager");
    const { ToolRiskCategory } = await import("../shared/contracts");

    expect(inferToolRisk("http_request")).toBe(ToolRiskCategory.Network);
    expect(inferToolRisk("fetch_data")).toBe(ToolRiskCategory.Network);
    expect(inferToolRisk("download_file")).toBe(ToolRiskCategory.Network);
  });

  it("defaults to Read for unknown tools", async () => {
    const { inferToolRisk } = await import("../src/main/services/mcp-server-manager");
    const { ToolRiskCategory } = await import("../shared/contracts");

    expect(inferToolRisk("list_files")).toBe(ToolRiskCategory.Read);
    expect(inferToolRisk("get_status")).toBe(ToolRiskCategory.Read);
  });
});

// ---------------------------------------------------------------------------
// Model client — isRetryableError
// ---------------------------------------------------------------------------

describe("Model Client isRetryableError", () => {
  it("returns false for AbortError", async () => {
    const { isRetryableError } = await import("../src/main/services/model-client");
    const err = new DOMException("Aborted", "AbortError");
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns true for TypeError (network error)", async () => {
    const { isRetryableError } = await import("../src/main/services/model-client");
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true for 429 status", async () => {
    const { isRetryableError } = await import("../src/main/services/model-client");
    const mockResponse = { status: 429 } as Response;
    expect(isRetryableError(null, mockResponse)).toBe(true);
  });

  it("returns true for 500+ status", async () => {
    const { isRetryableError } = await import("../src/main/services/model-client");
    const mockResponse = { status: 502 } as Response;
    expect(isRetryableError(null, mockResponse)).toBe(true);
  });

  it("returns false for 400 status", async () => {
    const { isRetryableError } = await import("../src/main/services/model-client");
    const mockResponse = { status: 400 } as Response;
    expect(isRetryableError(null, mockResponse)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sessions — isReadOnlyTool
// ---------------------------------------------------------------------------

describe("Sessions isReadOnlyTool", () => {
  it("identifies read-only builtin tools", async () => {
    const { isReadOnlyTool } = await import("../src/main/ipc/sessions");
    expect(isReadOnlyTool("fs.read")).toBe(true);
    expect(isReadOnlyTool("fs.list")).toBe(true);
    expect(isReadOnlyTool("git.status")).toBe(true);
  });

  it("identifies skill tools as read-only", async () => {
    const { isReadOnlyTool } = await import("../src/main/ipc/sessions");
    expect(isReadOnlyTool("skill_invoke__my-skill")).toBe(true);
  });

  it("identifies write tools as not read-only", async () => {
    const { isReadOnlyTool } = await import("../src/main/ipc/sessions");
    expect(isReadOnlyTool("fs.write")).toBe(false);
    expect(isReadOnlyTool("exec.command")).toBe(false);
  });
});
