import type {
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  BuiltinToolApprovalMode,
  ChatSession,
  ExecutionIntent,
  ExecutionIntentResult,
  LocalEmployeeSummary,
  McpServer,
  McpServerConfig,
  ModelProfile,
  ResolvedMcpTool,
  ResolvedBuiltinTool,
  SkillDetail,
  SkillDefinition,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowRunSummary,
} from "@myclaw-desktop/shared";
import type {
  CloudEmployeePackageManifest,
  CloudWorkflowPackageManifest,
} from "@/services/cloud-hub-client";

export type BootstrapPayload = {
  services: string[];
  defaultModelProfileId: string | null;
  sessions: ChatSession[];
  models: ModelProfile[];
  myClawRootPath: string;
  skillsRootPath: string;
  sessionsRootPath: string;
  runtimeStateFilePath: string;
  requiresInitialSetup: boolean;
  isFirstLaunch: boolean;
  mcp: { servers: McpServer[] };
  tools: { builtin: ResolvedBuiltinTool[]; mcp: ResolvedMcpTool[] };
  skills: { items: SkillDefinition[] };
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  workflowRuns?: WorkflowRunSummary[];
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
};

export type PostSessionMessagePayload = {
  session: ChatSession;
  approvals?: ApprovalPolicy;
  approvalRequests?: ApprovalRequest[];
};

type SessionStreamEventName = "snapshot" | "complete" | "error";

export type PostSessionMessageStreamHandlers = {
  onSnapshot?: (payload: PostSessionMessagePayload) => void;
};

export type CreateSessionPayload = {
  session: ChatSession;
};

export type DeleteSessionPayload = {
  deletedSessionId: string;
  sessions: ChatSession[];
  approvalRequests: ApprovalRequest[];
};

export type ResolveApprovalPayload = {
  session: ChatSession;
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
};

export type RequestExecutionIntentPayload = {
  session: ChatSession;
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
  result: ExecutionIntentResult;
};

export type CreateModelProfilePayload = {
  profile: ModelProfile;
};

export type UpdateModelProfilePayload = {
  profile: ModelProfile;
};

export type DeleteModelProfilePayload = {
  deletedProfileId: string;
  defaultModelProfileId: string | null;
  models: ModelProfile[];
  sessions: ChatSession[];
};

export type SetDefaultModelProfilePayload = {
  defaultModelProfileId: string;
};

export type UpdateApprovalPolicyPayload = {
  approvals: ApprovalPolicy;
};

export type TestModelProfilePayload = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  detail?: string;
};

export type ListBuiltinToolsPayload = {
  items: ResolvedBuiltinTool[];
};

export type UpdateBuiltinToolPreferencePayload = {
  tool: ResolvedBuiltinTool;
};

export type ListMcpToolsPayload = {
  items: ResolvedMcpTool[];
};

export type UpdateMcpToolPreferencePayload = {
  tool: ResolvedMcpTool;
};

export type ListMcpServersPayload = {
  servers: McpServer[];
};

export type UpsertMcpServerPayload = {
  server: McpServer;
  servers: McpServer[];
};

export type DeleteMcpServerPayload = {
  deletedServerId: string;
  servers: McpServer[];
};

export type ImportCloudSkillPayload = {
  skills: { items: SkillDefinition[] };
  skill?: SkillDefinition | null;
};

export type GetSkillDetailPayload = {
  skill: SkillDetail;
};

export type HubPackageRecord<TManifest extends CloudEmployeePackageManifest | CloudWorkflowPackageManifest> = {
  id: string;
  itemId: string;
  releaseId: string;
  filePath: string;
  downloadUrl: string | null;
  installedAt: string;
  manifest: TManifest;
};

export type InstallEmployeePackageInput = {
  itemId: string;
  releaseId: string;
  name: string;
  summary?: string;
  downloadUrl?: string;
  manifest: CloudEmployeePackageManifest;
};

export type InstallEmployeePackagePayload = {
  employee: LocalEmployeeSummary;
  packageRecord: HubPackageRecord<CloudEmployeePackageManifest>;
  items: LocalEmployeeSummary[];
};

export type InstallWorkflowPackageInput = {
  itemId: string;
  releaseId: string;
  name: string;
  summary?: string;
  downloadUrl?: string;
  manifest: CloudWorkflowPackageManifest;
};

export type InstallWorkflowPackagePayload = {
  workflow: WorkflowDefinitionSummary;
  packageRecord: HubPackageRecord<CloudWorkflowPackageManifest>;
  items: WorkflowDefinitionSummary[];
};

export type CreatePublishDraftInput = {
  kind: "employee-package" | "workflow-package";
  sourceId: string;
  version: string;
};

export type PublishDraftRecord = {
  id: string;
  kind: "employee-package" | "workflow-package";
  sourceId: string;
  filePath: string;
  createdAt: string;
  manifest: CloudEmployeePackageManifest | CloudWorkflowPackageManifest;
};

export type CreatePublishDraftPayload = {
  draft: PublishDraftRecord;
};

export type ListEmployeesPayload = {
  items: LocalEmployeeSummary[];
};

export type CreateEmployeeInput = {
  name: string;
  description: string;
};

export type CreateEmployeePayload = {
  employee: LocalEmployeeSummary;
  items: LocalEmployeeSummary[];
};

export type GetEmployeePayload = {
  employee: LocalEmployeeSummary;
};

export type UpdateEmployeeInput = Partial<{
  name: string;
  description: string;
  status: LocalEmployeeSummary["status"];
  source: LocalEmployeeSummary["source"];
  workflowIds: string[];
}>;

export type UpdateEmployeePayload = {
  employee: LocalEmployeeSummary;
};

export type ListWorkflowsPayload = {
  items: WorkflowDefinitionSummary[];
};

export type CreateWorkflowInput = {
  name: string;
  description: string;
};

export type CreateWorkflowPayload = {
  workflow: WorkflowDefinition;
  items: WorkflowDefinitionSummary[];
};

export type GetWorkflowPayload = {
  workflow: WorkflowDefinition;
};

export type UpdateWorkflowInput = Partial<{
  name: WorkflowDefinition["name"];
  description: WorkflowDefinition["description"];
  status: WorkflowDefinition["status"];
  source: WorkflowDefinition["source"];
  entryNodeId: WorkflowDefinition["entryNodeId"];
  nodes: WorkflowDefinition["nodes"];
  edges: WorkflowDefinition["edges"];
  stateSchema: WorkflowDefinition["stateSchema"];
  defaults: WorkflowDefinition["defaults"];
  editor: {
    canvas: {
      viewport: {
        offsetX: number;
        offsetY: number;
      };
      nodes: Array<{
        nodeId: string;
        position: {
          x: number;
          y: number;
        };
      }>;
    };
  };
}>;

export type UpdateWorkflowPayload = {
  workflow: WorkflowDefinition;
};

export type ListWorkflowRunsPayload = {
  items: WorkflowRunSummary[];
};

export type WorkflowRunCheckpointStatus =
  | "node-start"
  | "node-complete"
  | "node-error"
  | "retry-scheduled"
  | "waiting-human-input"
  | "run-complete";

export type WorkflowRunCheckpoint = {
  id: string;
  runId: string;
  createdAt: string;
  nodeId: string;
  status: WorkflowRunCheckpointStatus;
  state: Record<string, unknown>;
  attempts: Record<string, number>;
  error?: string;
  retryAt?: string;
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  state?: Record<string, unknown>;
};

export type StartWorkflowRunInput = {
  workflowId: string;
};

export type StartWorkflowRunPayload = {
  run: WorkflowRunDetail;
  items: WorkflowRunSummary[];
  checkpoints?: WorkflowRunCheckpoint[];
  result?: unknown;
};

export type GetWorkflowRunPayload = {
  run: WorkflowRunDetail;
  checkpoints: WorkflowRunCheckpoint[];
  result?: unknown;
};

export type ResumeWorkflowRunPayload = {
  run: WorkflowRunDetail;
  items: WorkflowRunSummary[];
  checkpoints?: WorkflowRunCheckpoint[];
  result?: unknown;
};

type RuntimeErrorPayload = {
  error?: string;
  detail?: string;
  message?: string;
};

/** 提取运行时返回的错误详情，统一给上层显示。 */
async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as RuntimeErrorPayload;
    const detail = [payload.detail, payload.message, payload.error].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (detail) {
      return detail.trim();
    }
  } catch {
    // Ignore JSON parse errors and fall back to response text.
  }

  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    // Ignore text parse errors.
  }

  return null;
}

/** 将非 2xx 响应转换成统一的前端异常。 */
async function throwHttpError(response: Response, fallbackMessage: string): Promise<never> {
  const detail = await readErrorDetail(response);
  throw new Error(detail ? `${fallbackMessage}: ${detail}` : `${fallbackMessage}: ${response.status}`);
}

/** 防御性解析 JSON，避免运行时返回空响应或非 JSON 时吞错。 */
async function parseJsonPayload<T>(response: Response, fallbackMessage: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const preview = raw.trim().slice(0, 200);
    throw new Error(
      preview
        ? `${fallbackMessage}: Runtime returned non-JSON payload: ${preview}`
        : `${fallbackMessage}: Runtime returned an empty payload`,
    );
  }
}

/** 拉取桌面端首屏所需的 bootstrap 数据。 */
export async function fetchBootstrap(baseUrl: string): Promise<BootstrapPayload> {
  const response = await fetch(`${baseUrl}/api/bootstrap`);
  if (!response.ok) {
    await throwHttpError(response, "Runtime bootstrap failed");
  }

  return response.json() as Promise<BootstrapPayload>;
}

/** 读取当前解析后的内置工具目录。 */
export async function fetchBuiltinTools(baseUrl: string): Promise<ListBuiltinToolsPayload> {
  const response = await fetch(`${baseUrl}/api/tools/builtin`);
  if (!response.ok) {
    await throwHttpError(response, "Load builtin tools failed");
  }

  return response.json() as Promise<ListBuiltinToolsPayload>;
}

/** 创建一个新的会话。 */
export async function createSession(baseUrl: string): Promise<CreateSessionPayload> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    await throwHttpError(response, "Create session failed");
  }

  return response.json() as Promise<CreateSessionPayload>;
}

export async function deleteSession(baseUrl: string, sessionId: string): Promise<DeleteSessionPayload> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwHttpError(response, "Delete session failed");
  }

  return response.json() as Promise<DeleteSessionPayload>;
}

/** 向指定会话发送一条消息。 */
export async function postSessionMessage(
  baseUrl: string,
  sessionId: string,
  content: string,
): Promise<PostSessionMessagePayload> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    await throwHttpError(response, "Send message failed");
  }

  return parseJsonPayload<PostSessionMessagePayload>(response, "Send message failed");
}

/** 以流式事件消费会话回复，便于桌面端按快照增量刷新思考与正文。 */
export async function postSessionMessageStream(
  baseUrl: string,
  sessionId: string,
  content: string,
  handlers?: PostSessionMessageStreamHandlers,
): Promise<PostSessionMessagePayload> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    await throwHttpError(response, "Send message failed");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return parseJsonPayload<PostSessionMessagePayload>(response, "Send message failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: PostSessionMessagePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex >= 0) {
      const eventBlock = buffer.slice(0, boundaryIndex).trim();
      buffer = buffer.slice(boundaryIndex + 2);
      if (eventBlock) {
        finalPayload = handleSessionStreamEvent(eventBlock, handlers, finalPayload);
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  const trailingBlock = buffer.trim();
  if (trailingBlock) {
    finalPayload = handleSessionStreamEvent(trailingBlock, handlers, finalPayload);
  }

  if (finalPayload) {
    return finalPayload;
  }

  throw new Error("Send message failed: Runtime stream ended before a final payload was received");
}

/** 解析单个 SSE 事件块，并把快照同步给上层状态管理。 */
function handleSessionStreamEvent(
  eventBlock: string,
  handlers: PostSessionMessageStreamHandlers | undefined,
  currentPayload: PostSessionMessagePayload | null,
): PostSessionMessagePayload | null {
  const lines = eventBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let eventName: SessionStreamEventName = "snapshot";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      const rawName = line.slice("event:".length).trim();
      if (rawName === "snapshot" || rawName === "complete" || rawName === "error") {
        eventName = rawName;
      }
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return currentPayload;
  }

  const payload = JSON.parse(dataLines.join("\n")) as PostSessionMessagePayload & { error?: string; detail?: string };
  if (eventName === "error") {
    if (payload.session) {
      handlers?.onSnapshot?.(payload);
    }
    throw new Error(payload.detail || payload.error || "Send message failed");
  }

  if (eventName === "snapshot") {
    handlers?.onSnapshot?.(payload);
    return currentPayload;
  }

  return payload;
}

/** 提交一次工具执行意图，由运行时判断是否需要审批。 */
export async function requestExecutionIntent(
  baseUrl: string,
  sessionId: string,
  intent: ExecutionIntent,
): Promise<RequestExecutionIntentPayload> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/execution-intents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(intent),
  });

  if (!response.ok) {
    await throwHttpError(response, "Submit execution intent failed");
  }

  return response.json() as Promise<RequestExecutionIntentPayload>;
}

/** 处理一条待审批请求。 */
export async function resolveApproval(
  baseUrl: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<ResolveApprovalPayload> {
  const response = await fetch(`${baseUrl}/api/approvals/${approvalId}/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ decision }),
  });

  if (!response.ok) {
    await throwHttpError(response, "Resolve approval failed");
  }

  return response.json() as Promise<ResolveApprovalPayload>;
}

/** 更新全局审批策略。 */
export async function updateApprovalPolicy(
  baseUrl: string,
  payload: {
    mode: ApprovalMode;
    autoApproveReadOnly: boolean;
    autoApproveSkills: boolean;
  },
): Promise<UpdateApprovalPolicyPayload> {
  const response = await fetch(`${baseUrl}/api/approvals/policy`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update approval policy failed");
  }

  return response.json() as Promise<UpdateApprovalPolicyPayload>;
}

/** 创建模型配置。 */
export async function createModelProfile(
  baseUrl: string,
  payload: Omit<ModelProfile, "id">,
): Promise<CreateModelProfilePayload> {
  const response = await fetch(`${baseUrl}/api/model-profiles`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Create model profile failed");
  }

  return response.json() as Promise<CreateModelProfilePayload>;
}

/** 更新现有模型配置。 */
export async function updateModelProfile(
  baseUrl: string,
  profileId: string,
  payload: Omit<ModelProfile, "id">,
): Promise<UpdateModelProfilePayload> {
  const response = await fetch(`${baseUrl}/api/model-profiles/${encodeURIComponent(profileId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update model profile failed");
  }

  return response.json() as Promise<UpdateModelProfilePayload>;
}

/** 删除模型配置。 */
export async function deleteModelProfile(
  baseUrl: string,
  profileId: string,
): Promise<DeleteModelProfilePayload> {
  const response = await fetch(`${baseUrl}/api/model-profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwHttpError(response, "Delete model profile failed");
  }

  return response.json() as Promise<DeleteModelProfilePayload>;
}

/** 将某个模型配置设为默认模型。 */
export async function setDefaultModelProfile(
  baseUrl: string,
  profileId: string,
): Promise<SetDefaultModelProfilePayload> {
  const response = await fetch(`${baseUrl}/api/model-profiles/default`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ profileId }),
  });

  if (!response.ok) {
    await throwHttpError(response, "Set default model failed");
  }

  return response.json() as Promise<SetDefaultModelProfilePayload>;
}

/** 检测指定模型配置的可用性。 */
export async function testModelProfile(
  baseUrl: string,
  profileId: string,
): Promise<TestModelProfilePayload> {
  const response = await fetch(`${baseUrl}/api/model-profiles/${encodeURIComponent(profileId)}/test`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    await throwHttpError(response, "Model connectivity test failed");
  }

  return response.json() as Promise<TestModelProfilePayload>;
}

/** 更新单个内置工具的启用、暴露和审批覆盖状态。 */
export async function updateBuiltinToolPreference(
  baseUrl: string,
  toolId: string,
  payload: {
    enabled: boolean;
    exposedToModel: boolean;
    approvalModeOverride: BuiltinToolApprovalMode | null;
  },
): Promise<UpdateBuiltinToolPreferencePayload> {
  const response = await fetch(`${baseUrl}/api/tools/builtin/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update builtin tool failed");
  }

  return response.json() as Promise<UpdateBuiltinToolPreferencePayload>;
}

export async function fetchEmployees(baseUrl: string): Promise<ListEmployeesPayload> {
  const response = await fetch(`${baseUrl}/api/employees`);
  if (!response.ok) {
    await throwHttpError(response, "Load employees failed");
  }

  return response.json() as Promise<ListEmployeesPayload>;
}

export async function createEmployee(
  baseUrl: string,
  payload: CreateEmployeeInput,
): Promise<CreateEmployeePayload> {
  const response = await fetch(`${baseUrl}/api/employees`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Create employee failed");
  }

  return response.json() as Promise<CreateEmployeePayload>;
}

export async function getEmployee(baseUrl: string, employeeId: string): Promise<GetEmployeePayload> {
  const response = await fetch(`${baseUrl}/api/employees/${encodeURIComponent(employeeId)}`);
  if (!response.ok) {
    await throwHttpError(response, "Load employee failed");
  }

  return response.json() as Promise<GetEmployeePayload>;
}

export async function updateEmployee(
  baseUrl: string,
  employeeId: string,
  payload: UpdateEmployeeInput,
): Promise<UpdateEmployeePayload> {
  const response = await fetch(`${baseUrl}/api/employees/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update employee failed");
  }

  return response.json() as Promise<UpdateEmployeePayload>;
}

export async function fetchWorkflows(baseUrl: string): Promise<ListWorkflowsPayload> {
  const response = await fetch(`${baseUrl}/api/workflows`);
  if (!response.ok) {
    await throwHttpError(response, "Load workflows failed");
  }

  return response.json() as Promise<ListWorkflowsPayload>;
}

export async function createWorkflow(
  baseUrl: string,
  payload: CreateWorkflowInput,
): Promise<CreateWorkflowPayload> {
  const response = await fetch(`${baseUrl}/api/workflows`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Create workflow failed");
  }

  return response.json() as Promise<CreateWorkflowPayload>;
}

export async function getWorkflow(baseUrl: string, workflowId: string): Promise<GetWorkflowPayload> {
  const response = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(workflowId)}`);
  if (!response.ok) {
    await throwHttpError(response, "Load workflow failed");
  }

  return response.json() as Promise<GetWorkflowPayload>;
}

export async function updateWorkflow(
  baseUrl: string,
  workflowId: string,
  payload: UpdateWorkflowInput,
): Promise<UpdateWorkflowPayload> {
  const response = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(workflowId)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update workflow failed");
  }

  return response.json() as Promise<UpdateWorkflowPayload>;
}

/** 加载当前工作区的工作流运行摘要列表。*/
export async function fetchWorkflowRuns(baseUrl: string): Promise<ListWorkflowRunsPayload> {
  const response = await fetch(`${baseUrl}/api/workflow-runs`);
  if (!response.ok) {
    await throwHttpError(response, "Load workflow runs failed");
  }

  return response.json() as Promise<ListWorkflowRunsPayload>;
}

/** 启动一次工作流运行并返回最新运行摘要。*/
export async function getWorkflowRun(baseUrl: string, runId: string): Promise<GetWorkflowRunPayload> {
  const response = await fetch(`${baseUrl}/api/workflow-runs/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    await throwHttpError(response, "Load workflow run failed");
  }

  return parseJsonPayload<GetWorkflowRunPayload>(response, "Load workflow run failed");
}

export async function startWorkflowRun(
  baseUrl: string,
  payload: StartWorkflowRunInput,
): Promise<StartWorkflowRunPayload> {
  const response = await fetch(`${baseUrl}/api/workflow-runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Start workflow run failed");
  }

  return response.json() as Promise<StartWorkflowRunPayload>;
}

/** 恢复一次暂停中的工作流运行并返回最新运行摘要。*/
export async function resumeWorkflowRun(
  baseUrl: string,
  runId: string,
): Promise<ResumeWorkflowRunPayload> {
  const response = await fetch(`${baseUrl}/api/workflow-runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    await throwHttpError(response, "Resume workflow run failed");
  }

  return response.json() as Promise<ResumeWorkflowRunPayload>;
}

export async function fetchMcpServers(baseUrl: string): Promise<ListMcpServersPayload> {
  const response = await fetch(`${baseUrl}/api/mcp/servers`);
  if (!response.ok) {
    await throwHttpError(response, "Load MCP servers failed");
  }

  return response.json() as Promise<ListMcpServersPayload>;
}

export async function importMcpServers(
  baseUrl: string,
  source: "claude" | "codex" | "cursor",
): Promise<ListMcpServersPayload> {
  const response = await fetch(`${baseUrl}/api/mcp/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ source }),
  });

  if (!response.ok) {
    await throwHttpError(response, "Import MCP servers failed");
  }

  return response.json() as Promise<ListMcpServersPayload>;
}

export async function createMcpServer(
  baseUrl: string,
  payload: McpServerConfig,
): Promise<UpsertMcpServerPayload> {
  const response = await fetch(`${baseUrl}/api/mcp/servers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Create MCP server failed");
  }

  return response.json() as Promise<UpsertMcpServerPayload>;
}

export async function updateMcpServer(
  baseUrl: string,
  serverId: string,
  payload: McpServerConfig,
): Promise<UpsertMcpServerPayload> {
  const response = await fetch(`${baseUrl}/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update MCP server failed");
  }

  return response.json() as Promise<UpsertMcpServerPayload>;
}

export async function deleteMcpServer(
  baseUrl: string,
  serverId: string,
): Promise<DeleteMcpServerPayload> {
  const response = await fetch(`${baseUrl}/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwHttpError(response, "Delete MCP server failed");
  }

  return response.json() as Promise<DeleteMcpServerPayload>;
}

export async function refreshMcpServer(
  baseUrl: string,
  serverId: string,
): Promise<UpsertMcpServerPayload> {
  const response = await fetch(`${baseUrl}/api/mcp/servers/${encodeURIComponent(serverId)}/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    await throwHttpError(response, "Refresh MCP server failed");
  }

  return response.json() as Promise<UpsertMcpServerPayload>;
}

export async function importCloudSkillRelease(
  baseUrl: string,
  payload: {
    downloadUrl: string;
    skillName: string;
  },
): Promise<ImportCloudSkillPayload> {
  const response = await fetch(`${baseUrl}/api/skills/import-cloud-release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Import cloud skill failed");
  }

  return response.json() as Promise<ImportCloudSkillPayload>;
}

/** 请求 runtime 安装云端员工包，并返回本地员工与包记录。 */
export async function installEmployeePackageFromCloud(
  baseUrl: string,
  payload: InstallEmployeePackageInput,
): Promise<InstallEmployeePackagePayload> {
  const response = await fetch(`${baseUrl}/api/employee-packages/install`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Install employee package failed");
  }

  return response.json() as Promise<InstallEmployeePackagePayload>;
}

/** 请求 runtime 安装云端工作流包，并返回本地工作流与包记录。 */
export async function installWorkflowPackageFromCloud(
  baseUrl: string,
  payload: InstallWorkflowPackageInput,
): Promise<InstallWorkflowPackagePayload> {
  const response = await fetch(`${baseUrl}/api/workflow-packages/install`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Install workflow package failed");
  }

  return response.json() as Promise<InstallWorkflowPackagePayload>;
}

/** 请求 runtime 为本地员工或工作流生成发布草稿。 */
export async function createPublishDraft(
  baseUrl: string,
  payload: CreatePublishDraftInput,
): Promise<CreatePublishDraftPayload> {
  const response = await fetch(`${baseUrl}/api/publish-drafts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Create publish draft failed");
  }

  return response.json() as Promise<CreatePublishDraftPayload>;
}

export async function fetchMcpTools(baseUrl: string): Promise<ListMcpToolsPayload> {
  const response = await fetch(`${baseUrl}/api/tools/mcp`);
  if (!response.ok) {
    await throwHttpError(response, "Load MCP tools failed");
  }

  return response.json() as Promise<ListMcpToolsPayload>;
}

export async function updateMcpToolPreference(
  baseUrl: string,
  toolId: string,
  payload: {
    enabled: boolean;
    exposedToModel: boolean;
    approvalModeOverride: "inherit" | "always-ask" | "always-allow" | null;
  },
): Promise<UpdateMcpToolPreferencePayload> {
  const response = await fetch(`${baseUrl}/api/tools/mcp/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwHttpError(response, "Update MCP tool failed");
  }

  return response.json() as Promise<UpdateMcpToolPreferencePayload>;
}

/** 读取本地 Skill 的完整详情，包含 SKILL.md 路径与正文。 */
export async function fetchSkillDetail(baseUrl: string, skillId: string): Promise<GetSkillDetailPayload> {
  const response = await fetch(`${baseUrl}/api/skills/${encodeURIComponent(skillId)}`);
  if (!response.ok) {
    await throwHttpError(response, "Load skill detail failed");
  }

  return response.json() as Promise<GetSkillDetailPayload>;
}
