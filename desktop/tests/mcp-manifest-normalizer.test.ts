import { describe, expect, it } from "vitest";

import { normalizeMcpManifestConfig } from "../src/main/services/mcp-config-normalizer";

/** 锁定 Desktop 旧格式与 Cloud 新格式都能导入同一套 MCP 配置。 */
describe("mcp manifest normalizer", () => {
  it("normalizes legacy Desktop http endpoint manifests", () => {
    expect(normalizeMcpManifestConfig({
      name: "Legacy HTTP",
      transport: "http",
      endpoint: "https://mcp.example.com/rpc",
      headers: { Authorization: "Bearer token" },
    })).toEqual({
      name: "Legacy HTTP",
      source: "manual",
      enabled: true,
      transport: "http",
      url: "https://mcp.example.com/rpc",
      headers: { Authorization: "Bearer token" },
    });
  });

  it("normalizes Cloud streamable-http manifests with nested config", () => {
    expect(normalizeMcpManifestConfig({
      kind: "mcp",
      name: "Cloud MCP",
      config: {
        transport: "streamable-http",
        url: "https://mcp.example.com/stream",
        headers: { "X-Tenant": "acme" },
      },
    })).toEqual({
      name: "Cloud MCP",
      source: "manual",
      enabled: true,
      transport: "streamable-http",
      url: "https://mcp.example.com/stream",
      headers: { "X-Tenant": "acme" },
    });
  });

  it("normalizes Cloud SSE manifests with nested config", () => {
    expect(normalizeMcpManifestConfig({
      name: "Cloud SSE",
      config: {
        transport: "sse",
        url: "https://mcp.example.com/sse",
      },
    })).toEqual({
      name: "Cloud SSE",
      source: "manual",
      enabled: true,
      transport: "sse",
      url: "https://mcp.example.com/sse",
      headers: undefined,
    });
  });

  it("normalizes stdio manifests and preserves args/env", () => {
    expect(normalizeMcpManifestConfig({
      name: "Local MCP",
      config: {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "secret" },
      },
    })).toEqual({
      name: "Local MCP",
      source: "manual",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "secret" },
    });
  });
});
