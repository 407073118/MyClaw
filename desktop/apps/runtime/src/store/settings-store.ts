import type {
  ApprovalPolicy,
  ApprovalRequest,
  McpServer,
  McpServerConfig,
  ModelProfile,
  SkillDefinition,
} from "@myclaw-desktop/shared";
import { ToolRiskCategory, createDefaultApprovalPolicy, shouldRequestApproval } from "@myclaw-desktop/shared";

export function createDefaultProfiles(): ModelProfile[] {
  return [
    {
      id: "model-default",
      name: "默认 Qwen 3.5 Plus",
      provider: "openai-compatible",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      baseUrlMode: "manual",
      apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
      model: "qwen3.5-plus",
    },
  ];
}

export function createDefaultModelProfileId(profiles: ModelProfile[]): string | null {
  return profiles[0]?.id ?? null;
}

export function createDefaultMcpServerConfigs(): McpServerConfig[] {
  return [
    {
      id: "mcp-filesystem",
      name: "文件系统 MCP",
      source: "manual",
      transport: "stdio",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "."],
      enabled: true,
    },
  ];
}

export function createDefaultMcpServers(): McpServer[] {
  return createDefaultMcpServerConfigs().map((config) => ({
    ...config,
    health: "unknown",
    recentError: null,
    lastCheckedAt: null,
    state: {
      serverId: config.id,
      health: "unknown",
      connected: false,
      toolCount: 2,
      lastCheckedAt: null,
      recentError: null,
    },
    tools: [
      {
        id: "fs.read_file",
        serverId: config.id,
        name: "read_file",
        description: "从附加工作目录中读取文件。",
        risk: ToolRiskCategory.Read,
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
        },
      },
      {
        id: "fs.write_file",
        serverId: config.id,
        name: "write_file",
        description: "向附加工作目录中写入文件。",
        risk: ToolRiskCategory.Write,
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    ],
  }));
}

export function createDefaultSkills(): SkillDefinition[] {
  return [
    {
      id: "skill-code-review",
      name: "代码审查",
      description: "在编辑或交付前先审查代码。",
      path: "managed://skills/code-review",
      enabled: true,
      hasScriptsDirectory: true,
      hasReferencesDirectory: false,
      hasAssetsDirectory: false,
      hasTestsDirectory: false,
      hasAgentsDirectory: false,
    },
  ];
}

export function createApprovalPolicy(): ApprovalPolicy {
  return createDefaultApprovalPolicy();
}

export function createDefaultApprovalRequests(
  sessionId: string,
  policy: ApprovalPolicy = createApprovalPolicy(),
): ApprovalRequest[] {
  if (
    !shouldRequestApproval({
      policy,
      source: "mcp-tool",
      toolId: "fs.write_file",
      risk: ToolRiskCategory.Write,
    })
  ) {
    return [];
  }

  return [
    {
      id: "approval-default-write-file",
      sessionId,
      source: "mcp-tool",
      toolId: "fs.write_file",
      label: "write_file",
      risk: ToolRiskCategory.Write,
      detail: "模型准备通过 MCP 文件系统服务写入文件，执行前需要你的确认。",
      serverId: "mcp-filesystem",
      toolName: "write_file",
      arguments: {
        path: ".",
      },
    },
  ];
}
