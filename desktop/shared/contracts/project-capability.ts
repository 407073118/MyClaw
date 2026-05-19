export type ProjectCapabilityKind = "skill" | "mcp";
export type ProjectCapabilityLocalState = "inherit" | "enabled" | "disabled" | "hidden";
export type ProjectCapabilityInstallStatus = "missing" | "installing" | "ready" | "failed" | "revoked";
export type ProjectSyncStatus = "never" | "synced" | "stale" | "failed" | "revoked" | "deleted";

export type CloudProjectBinding = {
  id: string;
  cloudProjectId: string;
  tenantId: string;
  accountId: string;
  code: string;
  name: string;
  description: string | null;
  cloudVersion: number;
  etag: string;
  policyEpoch: number;
  syncedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  deletedAt: string | null;
  lastSyncStatus: ProjectSyncStatus;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCapabilityRef = {
  id: string;
  localProjectId: string;
  kind: ProjectCapabilityKind;
  cloudCapabilityId: string;
  cloudReleaseId: string | null;
  alias: string | null;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  manifestJson: unknown;
  artifactJson: unknown;
  artifactHash: string | null;
  runtimePolicyJson: unknown;
  cloudConfigJson: unknown;
  syncStatus: ProjectSyncStatus;
  syncWarning: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCapabilityPref = {
  id: string;
  localProjectId: string;
  capabilityRefId: string;
  localState: ProjectCapabilityLocalState;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string;
  localPolicyJson?: unknown;
};

export type CapabilityInstallation = {
  id: string;
  sourceType: "project_skill" | "project_mcp" | "global_skill" | "global_mcp";
  localProjectId: string | null;
  capabilityRefId: string | null;
  installDir: string | null;
  manifestHash: string | null;
  artifactHash: string | null;
  installedReleaseId: string | null;
  installedAt: string | null;
  verifiedAt: string | null;
  installStatus: ProjectCapabilityInstallStatus;
  lastError: string | null;
};

export type ProjectCapabilityDetail = {
  project: CloudProjectBinding;
  refs: ProjectCapabilityRef[];
  prefs: ProjectCapabilityPref[];
  installations: CapabilityInstallation[];
};

export type RuntimeCapabilitySource = "global" | "project";

export type RuntimeCapabilityRef = {
  /** 能力来源：global 表示我的全局能力，project 表示当前会话绑定项目的能力。 */
  source: RuntimeCapabilitySource;
  /** 能力类型：Skill 读取本地目录，MCP 通过运行时连接调用具体工具。 */
  kind: ProjectCapabilityKind;
  /** Cloud 或本地能力原始 ID，用于审计和快照回溯。 */
  id: string;
  /** 项目能力所属的本地项目 ID，全局能力为空。 */
  localProjectId?: string;
  /** 项目能力引用 ID，用于执行前回溯本地偏好和安装状态。 */
  capabilityRefId?: string;
  /** Skill 执行读取目录，bundle 内必须自包含，避免跨会话共享 mutable skills 状态。 */
  installDir?: string | null;
  /** Cloud release ID，用于确认本轮运行锁定到哪个版本。 */
  releaseId?: string | null;
  /** 暴露给模型的函数名，可能与 MCP 原始 toolName 不同。 */
  functionName?: string;
  /** 展示名称，用于工具说明和 UI 呈现。 */
  displayName?: string;
  /** 展示描述，用于工具说明和 UI 呈现。 */
  description?: string | null;
  /** 原始 manifest，兼容旧数据中的 inputSchema/config/view 元信息。 */
  manifestJson?: unknown;
  /** MCP 运行策略，只用于本轮安全门禁判断。 */
  runtimePolicyJson?: unknown;
  /** MCP server 运行时定位 ID，全局 MCP 为全局 serverId，项目 MCP 为能力 ref ID。 */
  serverId?: string | null;
  /** MCP 原始 tool 名称，不等同于暴露给模型的 functionName。 */
  toolName?: string | null;
  /** MCP 原始参数 schema，必须从 bundle 原样带到工具 schema。 */
  inputSchema?: unknown;
  /** 项目 MCP 临时连接配置，只用于本轮执行，不写入全局 mcp-servers.json。 */
  runtimeConfigJson?: unknown;
};

export type CapabilityBundle = {
  id: string;
  hash: string;
  sessionId: string;
  project: CloudProjectBinding | null;
  skills: RuntimeCapabilityRef[];
  mcpTools: RuntimeCapabilityRef[];
  functionNameMap: Record<string, RuntimeCapabilityRef>;
  createdAt: string;
};
