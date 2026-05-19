import { appEnv } from "../../../config";

export type ProjectRuntimeWarning = {
  code: string;
  message: string;
  targetType?: "project" | "skill" | "mcp";
  targetId?: string;
};

export type ProjectRuntimeArtifact = {
  downloadUrl: string;
  sha256: string;
  size: number;
  signature?: string;
};

export type ProjectRuntimeSkill = {
  id: string;
  releaseId: string;
  alias: string | null;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  manifest: unknown;
  artifact: ProjectRuntimeArtifact;
  config: unknown;
};

export type ProjectRuntimeMcp = {
  id: string;
  releaseId: string;
  alias: string | null;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  transport: "stdio" | "sse" | "streamable-http" | "http";
  manifest: unknown;
  artifact: ProjectRuntimeArtifact | null;
  config: unknown;
  runtimePolicy: {
    requiresLocalConfirmation: boolean;
    allowAutoExposeToModel: boolean;
    riskLevel: "low" | "medium" | "high";
  };
};

export type ProjectRuntimeContext = {
  project: {
    id: string | number;
    code: string;
    tenantId: string;
    name: string;
    description: string | null;
    version: number;
    etag: string;
    policyEpoch: number;
    expiresAt: string | null;
    revokedAt: string | null;
    deletedAt: string | null;
  };
  skills: ProjectRuntimeSkill[];
  mcps: ProjectRuntimeMcp[];
  warnings: ProjectRuntimeWarning[];
};

const CLOUD_API_BASE = process.env.MYCLAW_CLOUD_API_URL ?? appEnv.CLOUD_API_BASE;

/** Desktop 访问 Cloud 项目运行上下文的轻量客户端。 */
export class ProjectRuntimeContextClient {
  constructor(private readonly baseUrl = CLOUD_API_BASE) {}

  /** 从 Cloud 拉取项目运行上下文，供本地 SQLite 同步。 */
  async fetchRuntimeContext(projectId: string | number, accessToken?: string): Promise<ProjectRuntimeContext> {
    const encodedProjectId = encodeURIComponent(String(projectId));
    console.info("[project-runtime-context-client] 拉取 Cloud 项目运行上下文", { projectId });
    const response = await fetch(`${this.baseUrl}/api/projects/${encodedProjectId}/runtime-context`, {
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (!response.ok) {
      console.warn("[project-runtime-context-client] Cloud 项目运行上下文拉取失败", {
        projectId,
        status: response.status,
      });
      throw new Error(`project_runtime_context_fetch_failed:${response.status}`);
    }
    const context = await response.json() as ProjectRuntimeContext;
    console.info("[project-runtime-context-client] Cloud 项目运行上下文拉取成功", {
      projectId,
      skillCount: context.skills.length,
      mcpCount: context.mcps.length,
      warningCount: context.warnings.length,
    });
    return context;
  }
}
