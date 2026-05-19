import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from "@shared/contracts";

type NormalizedMcpServerInput = Omit<McpStdioServerConfig, "id"> | Omit<McpHttpServerConfig, "id">;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function resolveTransport(value: unknown): McpServerConfig["transport"] {
  if (value === "http" || value === "sse" || value === "streamable-http") return value;
  return "stdio";
}

/** 归一化 Cloud / Desktop / 旧 manifest 的 MCP 配置，供导入入口统一消费。 */
export function normalizeMcpManifestConfig(manifestInput: Record<string, unknown>): NormalizedMcpServerInput {
  const manifest = asRecord(manifestInput);
  const nestedConfig = asRecord(manifest.config);
  const config = Object.keys(nestedConfig).length > 0 ? nestedConfig : manifest;
  const transport = resolveTransport(config.transport ?? manifest.transport);
  const name = String(manifest.name ?? config.name ?? "Cloud MCP");

  console.info("[mcp-config-normalizer] 已归一化 MCP manifest", {
    name,
    transport,
    hasNestedConfig: Object.keys(nestedConfig).length > 0,
  });

  if (transport === "stdio") {
    return {
      name,
      source: "manual",
      enabled: true,
      transport,
      command: String(config.command ?? manifest.command ?? ""),
      args: asStringArray(config.args ?? manifest.args),
      env: asStringRecord(config.env ?? manifest.env),
    };
  }

  return {
    name,
    source: "manual",
    enabled: true,
    transport,
    url: String(config.url ?? config.endpoint ?? manifest.url ?? manifest.endpoint ?? ""),
    headers: asStringRecord(config.headers ?? manifest.headers),
  };
}
