/**
 * MCP 服务器 stdio 传输配置
 * 通过本地命令启动，stdin/stdout 通信
 */
export type McpStdioConfig = {
  transport: "stdio";
  /** 启动命令，如 "npx"、"node"、"python" */
  command: string;
  /** 命令参数，如 ["@playwright/mcp@latest"] */
  args?: string[];
  /** 传递给进程的环境变量 */
  env?: Record<string, string>;
};

/**
 * MCP 服务器 SSE 传输配置
 * 通过 HTTP Server-Sent Events 连接远程服务
 */
export type McpSseConfig = {
  transport: "sse";
  /** SSE 端点地址 */
  url: string;
  /** 请求头 */
  headers?: Record<string, string>;
};

/**
 * MCP 服务器 Streamable HTTP 传输配置
 * 通过 HTTP 流式连接远程服务
 */
export type McpStreamableHttpConfig = {
  transport: "streamable-http";
  /** HTTP 端点地址 */
  url: string;
  /** 请求头 */
  headers?: Record<string, string>;
};

/** MCP 服务器连接配置（联合类型） */
export type McpServerConfig = McpStdioConfig | McpSseConfig | McpStreamableHttpConfig;

export type McpItemSummary = {
  id: string;
  name: string;
  summary: string;
  latestVersion: string;
};

export type McpReleaseSummary = {
  id: string;
  version: string;
  releaseNotes: string;
};

export type McpItemDetail = {
  id: string;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
  releases: McpReleaseSummary[];
};

export type McpReleaseDetail = {
  id: string;
  version: string;
  releaseNotes: string;
  config: McpServerConfig;
};

export type CreateMcpItemInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
  version: string;
  releaseNotes: string;
  config: McpServerConfig;
};

export type PublishMcpReleaseInput = {
  version: string;
  releaseNotes: string;
  config: McpServerConfig;
};

/**
 * MCP 清单信息，用于 Hub 统一类型
 */
export type McpManifest = {
  kind: "mcp";
  name: string;
  version: string;
  description: string;
  config: McpServerConfig;
};

export type CreateMcpItemResponse = {
  item: McpItemDetail;
  release: McpReleaseDetail;
};

export type PublishMcpReleaseResponse = {
  itemId: string;
  release: McpReleaseDetail;
};
