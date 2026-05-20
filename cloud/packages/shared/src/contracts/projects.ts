export type ProjectStatus = "active" | "archived";

export type ProjectId = number;

export type ProjectRepositoryType =
  | "frontend"
  | "backend"
  | "service"
  | "mobile"
  | "infra"
  | "other";

export type ProjectApiDirection = "provided" | "consumed";

export type ProjectApiProtocol = "http" | "rpc" | "graphql" | "event" | "other";

export type ProjectApiSource = "manual" | "openapi" | "repo-scan" | "rongzhi";

export type ProjectApiParameterLocation = "path" | "query" | "header" | "cookie";

export type ProjectApiRequestBodyType =
  | "none"
  | "json"
  | "form-data"
  | "x-www-form-urlencoded"
  | "raw"
  | "binary"
  | "graphql";

export type ProjectApiParameterInfo = {
  name: string;
  in: ProjectApiParameterLocation;
  required: boolean;
  type: string | null;
  description: string | null;
  example: string | null;
  enabled: boolean;
};

export type ProjectSummary = {
  id: ProjectId;
  code: string;
  name: string;
  description: string | null;
  ownerAccount: string;
  status: ProjectStatus;
  version: number;
  repositoryCount: number;
  apiCount: number;
  skillCount: number;
  mcpCount: number;
  updatedAt: string;
};

export type ProjectRepositoryInfo = {
  id: ProjectId;
  name: string;
  gitUrl: string;
  repoType: ProjectRepositoryType;
  defaultBranch: string | null;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
};

export type ProjectServiceInfo = {
  id: ProjectId;
  name: string;
  baseUrl: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
};

export type ProjectRongzhiLinkInfo = {
  projectCode: string;
  projectName: string | null;
  baseUrl: string | null;
  enabled: boolean;
  lastHealthStatus: string | null;
  lastCheckedAt: string | null;
};

export type ProjectApiInfo = {
  id: ProjectId;
  name: string;
  serviceName: string | null;
  direction: ProjectApiDirection;
  protocol: ProjectApiProtocol;
  method: string | null;
  path: string | null;
  description: string | null;
  source: ProjectApiSource;
  owner: string | null;
  tagsJson: unknown;
  parametersJson: ProjectApiParameterInfo[] | null;
  requestBodyType: ProjectApiRequestBodyType;
  requestBodyContentType: string | null;
  requestBodyExampleJson: unknown;
  requestSchemaJson: unknown;
  responseSchemaJson: unknown;
  enabled: boolean;
};

export type ProjectSkillRefInfo = {
  id: ProjectId;
  skillId: string;
  skillReleaseId: string | null;
  alias: string | null;
  enabled: boolean;
  configJson: unknown;
};

export type ProjectMcpRefInfo = {
  id: ProjectId;
  mcpServerId: string;
  mcpReleaseId: string | null;
  alias: string | null;
  riskLevel: string | null;
  enabled: boolean;
  configOverrideJson: unknown;
};

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
    id: ProjectId;
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

export type ProjectWorkflowRefInfo = {
  id: ProjectId;
  workflowId: string;
  workflowName: string | null;
  enabled: boolean;
};

export type ProjectSiliconPersonRefInfo = {
  id: ProjectId;
  siliconPersonId: string;
  roleName: string | null;
  enabled: boolean;
};

export type ProjectDetail = {
  id: ProjectId;
  code: string;
  name: string;
  description: string | null;
  ownerAccount: string;
  status: ProjectStatus;
  services: ProjectServiceInfo[];
  repositories: ProjectRepositoryInfo[];
  rongzhiLink: ProjectRongzhiLinkInfo | null;
  apis: ProjectApiInfo[];
  skills: ProjectSkillRefInfo[];
  mcps: ProjectMcpRefInfo[];
  workflows: ProjectWorkflowRefInfo[];
  siliconPersons: ProjectSiliconPersonRefInfo[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectRepositoryInput = {
  name: string;
  gitUrl: string;
  repoType?: ProjectRepositoryType;
  defaultBranch?: string | null;
  description?: string | null;
  enabled?: boolean;
  sortOrder?: number;
};

export type ProjectServiceInput = {
  name: string;
  baseUrl: string;
  description?: string | null;
  enabled?: boolean;
  sortOrder?: number;
};

export type ProjectRongzhiLinkInput = {
  projectCode: string;
  projectName?: string | null;
  baseUrl?: string | null;
  enabled?: boolean;
};

export type ProjectApiInput = {
  name: string;
  serviceName?: string | null;
  direction?: ProjectApiDirection;
  protocol?: ProjectApiProtocol;
  method?: string | null;
  path?: string | null;
  description?: string | null;
  source?: ProjectApiSource;
  owner?: string | null;
  tagsJson?: unknown;
  parametersJson?: ProjectApiParameterInfo[] | null;
  requestBodyType?: ProjectApiRequestBodyType;
  requestBodyContentType?: string | null;
  requestBodyExampleJson?: unknown;
  requestSchemaJson?: unknown;
  responseSchemaJson?: unknown;
  enabled?: boolean;
};

export type ProjectSkillRefInput = {
  skillId: string;
  skillReleaseId?: string | null;
  alias?: string | null;
  enabled?: boolean;
  configJson?: unknown;
};

export type ProjectMcpRefInput = {
  mcpServerId: string;
  mcpReleaseId?: string | null;
  alias?: string | null;
  riskLevel?: string | null;
  enabled?: boolean;
  configOverrideJson?: unknown;
};

export type ProjectWorkflowRefInput = {
  workflowId: string;
  workflowName?: string | null;
  enabled?: boolean;
};

export type ProjectSiliconPersonRefInput = {
  siliconPersonId: string;
  roleName?: string | null;
  enabled?: boolean;
};

export type CreateProjectInput = {
  code: string;
  name: string;
  description?: string | null;
  ownerAccount: string;
  status?: ProjectStatus;
  createdBy: string;
  services?: ProjectServiceInput[];
  repositories?: ProjectRepositoryInput[];
  rongzhiLink?: ProjectRongzhiLinkInput | null;
  apis?: ProjectApiInput[];
  skills?: ProjectSkillRefInput[];
  mcps?: ProjectMcpRefInput[];
  workflows?: ProjectWorkflowRefInput[];
  siliconPersons?: ProjectSiliconPersonRefInput[];
};

export type ReplaceProjectConfigInput = {
  name?: string;
  description?: string | null;
  ownerAccount?: string;
  status?: ProjectStatus;
  updatedBy: string;
  services?: ProjectServiceInput[];
  repositories?: ProjectRepositoryInput[];
  rongzhiLink?: ProjectRongzhiLinkInput | null;
  apis?: ProjectApiInput[];
  skills?: ProjectSkillRefInput[];
  mcps?: ProjectMcpRefInput[];
  workflows?: ProjectWorkflowRefInput[];
  siliconPersons?: ProjectSiliconPersonRefInput[];
};
