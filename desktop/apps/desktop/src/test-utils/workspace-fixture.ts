import type {
  ApprovalPolicy,
  ApprovalRequest,
  ChatSession,
  WorkflowDefinition,
  LocalEmployeeSummary,
  McpServer,
  ModelProfile,
  ResolvedMcpTool,
  ResolvedBuiltinTool,
  SkillDefinition,
  WorkflowRunSummary,
  WorkflowDefinitionSummary,
} from "@myclaw-desktop/shared";

import { ToolRiskCategory } from "@myclaw-desktop/shared";
import type { CloudHubItem, CloudHubItemDetail, CloudHubManifest } from "@/services/cloud-hub-client";

export type WorkspaceFixture = {
  sessions: ChatSession[];
  models: ModelProfile[];
  myClawRootPath: string;
  skillsRootPath: string;
  sessionsRootPath: string;
  runtimeStateFilePath: string;
  builtinTools: ResolvedBuiltinTool[];
  mcpTools: ResolvedMcpTool[];
  mcpServers: McpServer[];
  skills: SkillDefinition[];
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  workflowDefinitions: WorkflowDefinition[];
  workflowRuns: WorkflowRunSummary[];
  cloudHubItems: CloudHubItem[];
  cloudHubDetail: CloudHubItemDetail | null;
  cloudHubManifest: CloudHubManifest | null;
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
};

export function createWorkspaceFixture(): WorkspaceFixture {
  return {
    myClawRootPath: "C:/Users/test/.myClaw",
    skillsRootPath: "C:/Users/test/.myClaw/skills",
    sessionsRootPath: "C:/Users/test/.myClaw/sessions",
    runtimeStateFilePath: "C:/Users/test/.myClaw/runtime/state.db",
    sessions: [
      {
        id: "session-default",
        title: "欢迎会话",
        modelProfileId: "model-default",
        attachedDirectory: null,
        createdAt: "2026-03-10T10:00:00.000Z",
        messages: [
          {
            id: "msg-user",
            role: "user",
            content: "帮我检查一下这个工作区结构",
            createdAt: "2026-03-10T10:00:01.000Z",
          },
          {
            id: "msg-assistant",
            role: "assistant",
            content: "我可以先检查 MCP、Skills 和本地目录，再决定如何执行。",
            createdAt: "2026-03-10T10:00:02.000Z",
          },
        ],
      },
    ],
    models: [
      {
        id: "model-default",
        name: "默认 Qwen 3.5 Plus",
        provider: "openai-compatible",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        baseUrlMode: "manual",
        apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
        model: "qwen3.5-plus",
      },
    ],
    builtinTools: [
      {
        id: "fs.read",
        name: "读取文件",
        description: "读取当前附加工作目录下的文本文件。",
        group: "fs",
        risk: ToolRiskCategory.Read,
        requiresAttachedDirectory: true,
        enabled: true,
        exposedToModel: true,
        effectiveApprovalMode: "inherit",
      },
      {
        id: "git.diff",
        name: "Git 差异",
        description: "查看仓库差异内容。",
        group: "git",
        risk: ToolRiskCategory.Read,
        requiresAttachedDirectory: false,
        enabled: true,
        exposedToModel: true,
        effectiveApprovalMode: "inherit",
      },
      {
        id: "archive.extract",
        name: "解压归档",
        description: "将归档文件解压到当前附加工作目录。",
        group: "archive",
        risk: ToolRiskCategory.Write,
        requiresAttachedDirectory: true,
        enabled: false,
        exposedToModel: false,
        effectiveApprovalMode: "always-ask",
      },
    ],
    mcpServers: [
      {
        id: "mcp-filesystem",
        name: "文件系统 MCP",
        source: "manual",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem", "."],
        enabled: true,
        health: "healthy",
        recentError: null,
        lastCheckedAt: "2026-03-20T08:00:00.000Z",
        state: {
          serverId: "mcp-filesystem",
          health: "healthy",
          connected: true,
          toolCount: 2,
          lastCheckedAt: "2026-03-20T08:00:00.000Z",
          recentError: null,
        },
        tools: [
          {
            id: "mcp-filesystem:read_file",
            serverId: "mcp-filesystem",
            name: "read_file",
            description: "从附加目录中读取文件。",
            risk: ToolRiskCategory.Read,
            inputSchema: {
              type: "object",
            },
          },
          {
            id: "mcp-filesystem:write_file",
            serverId: "mcp-filesystem",
            name: "write_file",
            description: "向附加目录中写入文件。",
            risk: ToolRiskCategory.Write,
            inputSchema: {
              type: "object",
            },
          },
        ],
      },
      {
        id: "mcp-broken-http",
        name: "文档网关 MCP",
        source: "cursor",
        transport: "http",
        url: "http://127.0.0.1:8123/mcp",
        enabled: false,
        health: "error",
        recentError: "connection refused",
        lastCheckedAt: "2026-03-20T08:05:00.000Z",
        state: {
          serverId: "mcp-broken-http",
          health: "error",
          connected: false,
          toolCount: 0,
          lastCheckedAt: "2026-03-20T08:05:00.000Z",
          recentError: "connection refused",
        },
        tools: [],
      },
    ],
    mcpTools: [
      {
        id: "mcp-filesystem:read_file",
        serverId: "mcp-filesystem",
        name: "read_file",
        description: "从附加目录中读取文件。",
        risk: ToolRiskCategory.Read,
        inputSchema: {
          type: "object",
        },
        enabled: true,
        exposedToModel: false,
        effectiveApprovalMode: "inherit",
      },
      {
        id: "mcp-filesystem:write_file",
        serverId: "mcp-filesystem",
        name: "write_file",
        description: "向附加目录中写入文件。",
        risk: ToolRiskCategory.Write,
        inputSchema: {
          type: "object",
        },
        enabled: true,
        exposedToModel: false,
        effectiveApprovalMode: "always-ask",
      },
    ],
    skills: [
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
        hasAgentsDirectory: true,
      },
    ],
    employees: [
      {
        id: "employee-onboarding-assistant",
        name: "Onboarding Assistant",
        description: "Guides local startup and follow-up tasks.",
        status: "draft",
        source: "personal",
        workflowIds: ["workflow-onboarding"],
        updatedAt: "2026-03-22T09:30:00.000Z",
      },
    ],
    workflows: [
      {
        id: "workflow-onboarding",
        name: "Onboarding Workflow",
        description: "Covers setup and completion checks.",
        status: "draft",
        source: "personal",
        updatedAt: "2026-03-22T09:35:00.000Z",
        version: 1,
        nodeCount: 2,
        edgeCount: 1,
        libraryRootId: "personal",
      },
    ],
    workflowDefinitions: [
      {
        id: "workflow-onboarding",
        name: "Onboarding Workflow",
        description: "Covers setup and completion checks.",
        status: "draft",
        source: "personal",
        updatedAt: "2026-03-22T09:35:00.000Z",
        version: 1,
        nodeCount: 2,
        edgeCount: 1,
        libraryRootId: "personal",
        entryNodeId: "node-start",
        nodes: [
          {
            id: "node-start",
            kind: "start",
            label: "Start",
          },
          {
            id: "node-end",
            kind: "end",
            label: "End",
          },
        ],
        edges: [
          {
            id: "edge-start-end",
            fromNodeId: "node-start",
            toNodeId: "node-end",
            kind: "normal",
          },
        ],
        stateSchema: [],
        editor: {
          canvas: {
            viewport: {
              offsetX: 0,
              offsetY: 0,
            },
            nodes: [
              {
                nodeId: "node-start",
                position: {
                  x: 120,
                  y: 180,
                },
              },
              {
                nodeId: "node-end",
                position: {
                  x: 400,
                  y: 180,
                },
              },
            ],
          },
        },
      } as WorkflowDefinition,
    ],
    workflowRuns: [
      {
        id: "run-onboarding-1",
        workflowId: "workflow-onboarding",
        workflowVersion: 1,
        status: "running",
        currentNodeIds: ["node-start"],
        startedAt: "2026-03-22T09:40:00.000Z",
        updatedAt: "2026-03-22T09:40:05.000Z",
      },
    ],
    cloudHubItems: [
      {
        id: "cloud-skill-security-audit",
        type: "skill",
        name: "Security Audit",
        summary: "Audit a codebase for security regressions before release.",
        latestVersion: "1.2.0",
        iconUrl: null,
      },
      {
        id: "cloud-mcp-docs-gateway",
        type: "mcp",
        name: "Docs Gateway",
        summary: "Expose internal docs over MCP for desktop sessions.",
        latestVersion: "0.9.1",
        iconUrl: null,
      },
    ],
    cloudHubDetail: {
      id: "cloud-skill-security-audit",
      type: "skill",
      name: "Security Audit",
      summary: "Audit a codebase for security regressions before release.",
      description: "Cloud-hosted audit skill package with curated checks and release metadata.",
      latestVersion: "1.2.0",
      releases: [
        {
          id: "release-skill-security-audit-1-2-0",
          version: "1.2.0",
          releaseNotes: "Adds dependency review and CI guidance.",
        },
      ],
    },
    cloudHubManifest: {
      kind: "skill",
      name: "security-audit",
      version: "1.2.0",
      description: "Audit a codebase for security regressions before release.",
      entry: "SKILL.md",
    },
    approvals: {
      mode: "prompt",
      autoApproveReadOnly: true,
      autoApproveSkills: true,
      alwaysAllowedTools: [],
    },
    approvalRequests: [
      {
        id: "approval-default-write-file",
        sessionId: "session-default",
        source: "mcp-tool",
        toolId: "fs.write_file",
        label: "write_file",
        risk: ToolRiskCategory.Write,
        detail: "模型准备写入附加目录中的文件，执行前需要你的确认。",
        serverId: "mcp-filesystem",
        toolName: "write_file",
        arguments: {
          path: ".",
        },
      },
    ],
  };
}
