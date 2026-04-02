import { createServer } from "node:http";

import type {
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  ApprovalRequestSource,
  BuiltinToolApprovalMode,
  BuiltinToolPreference,
  ChatMessage,
  ChatSession,
  ExecutionIntent,
  JsonValue,
  LocalEmployeeSummary,
  McpServer,
  McpServerConfig,
  McpToolPreference,
  ModelProfile,
  ResolvedMcpTool,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@myclaw-desktop/shared";

import { ToolRiskCategory } from "@myclaw-desktop/shared";
import { A2UI_ASSISTANT_SYSTEM_PROMPT, parseAssistantReply } from "../services/a2ui";
import {
  getBuiltinToolDefinition,
  listExposedBuiltinModelTools,
  resolveBuiltinTools,
} from "../services/builtin-tool-registry";
import { DirectoryService } from "../services/directory-service";
import {
  type ModelConversationToolDefinition,
  type ChatCompletionOutput,
  ModelToolCall,
  ModelToolCallResult,
  listAvailableModelIds,
  runModelConversation,
  testModelProfileConnectivity,
} from "../services/model-provider";
import { createExecutionIntentResult } from "../services/approval-gateway";
import { executeEmployeeRun } from "../services/employee-runner";
import {
  installHubEmployeePackage,
  installHubWorkflowPackage,
  type EmployeePackageManifest,
  type WorkflowPackageManifest,
} from "../services/hub-package-installer";
import { CloudHubProxy } from "../services/cloud-hub-proxy";
import { createPublishDraft } from "../services/publish-draft-manager";
import { loadSessionsSnapshot, saveSessionsSnapshot } from "../services/session-persistence";
import { SkillManager } from "../services/skill-manager";
import { NoopMCPorterAdapter, type MCPorterAdapter, type MCPorterImportSource } from "../services/mcporter-adapter";
import { McpService } from "../services/mcp-service";
import { runHeartbeat } from "../services/runtime-heartbeat";
import { ToolExecutionResult, ToolExecutor } from "../services/tool-executor";
import { WorkflowCheckpointStore } from "../services/workflow-checkpoint-store";
import {
  WorkflowGraphExecutor,
  type WorkflowGraphDefinition,
  type WorkflowNodeHandlerMap,
} from "../services/workflow-graph-executor";
import {
  createApprovalPolicy,
  createDefaultModelProfileId,
  createDefaultProfiles,
  createDefaultApprovalRequests,
  createDefaultMcpServerConfigs,
} from "../store/settings-store";
import {
  loadRuntimeState,
  resolveRuntimeStateFilePath,
  runtimeStateExists,
  saveRuntimeState,
} from "../store/runtime-state-store";
import { loadWorkflowDefinition, saveWorkflowDefinition } from "../store/workflow-definition-store";
import { validateWorkflowDefinition } from "../services/workflow-definition-validator";
import type { WorkflowLibraryRootRecord } from "../store/workflow-library-root-store";
import type { MemoryRecord } from "../store/memory-store";
import type { PendingWorkResumePolicy } from "../store/pending-work-store";
import {
  appendAssistantMessage,
  appendSystemMessage,
  appendToolMessage,
} from "../store/session-store";
import { resolve } from "node:path";
import { resolveRuntimeLayout } from "../services/runtime-layout";
import { createRuntimeContext } from "./runtime-context";
import { createHttpRouter, createRuntimeHttpRequestHandler } from "./http/router";
import { registerBootstrapRoutes } from "./routes/bootstrap";
import { registerSessionRoutes } from "./routes/sessions";

type RuntimeApp = {
  baseUrl: string;
  close: () => Promise<void>;
};

type RuntimeOptions = {
  port: number;
  stateFilePath?: string;
  chatCompletion?: (input: {
    profile: ModelProfile;
    messages: ChatMessage[];
    availableTools: ModelConversationToolDefinition[];
  }) => Promise<ChatCompletionOutput | string>;
  profileConnectivityCheck?: (input: { profile: ModelProfile }) => Promise<{ latencyMs: number }>;
  profileModelCatalog?: (input: { profile: ModelProfile }) => Promise<{ modelIds: string[] }>;
  workspaceRoot?: string;
  skillsRootPath?: string;
  executeIntent?: (input: {
    intent: ExecutionIntent;
    session: ChatSession;
  }) => Promise<ToolExecutionResult>;
  mcpAdapter?: MCPorterAdapter;
  cloudHubBaseUrl?: string;
  modelConversationRunner?: (input: {
    profile: ModelProfile;
    messages: ChatMessage[];
    tools: ModelConversationToolDefinition[];
    onToolCall: (call: ModelToolCall) => Promise<ModelToolCallResult>;
    onAssistantDelta?: (delta: { content?: string; reasoning?: string }) => Promise<void>;
  }) => Promise<ChatCompletionOutput>;
};

function resolveWorkspaceRoot(explicitWorkspaceRoot?: string): string {
  return resolve(explicitWorkspaceRoot ?? process.env.MYCLAW_WORKSPACE_ROOT ?? process.cwd());
}

function clipOutput(content: string, maxLength = 12000): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength)}\n\n...（输出已截断）`;
}

function isExecutableApproval(approval: ApprovalRequest): boolean {
  return approval.id.startsWith("approval-") && !approval.id.startsWith("approval-default-");
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 以 UTF-8 文本形式读取请求体，供 cloud auth/hub 代理原样透传。 */
async function readRequestBodyText(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length === 0 ? "" : Buffer.concat(chunks).toString("utf8");
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return (
    value === "deny" ||
    value === "allow-once" ||
    value === "allow-session" ||
    value === "always-allow-tool"
  );
}

function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "prompt" || value === "auto-read-only" || value === "auto-allow-all";
}

function isApprovalRequestSource(value: unknown): value is ApprovalRequestSource {
  return (
    value === "builtin-tool" ||
    value === "mcp-tool" ||
    value === "skill" ||
    value === "shell-command" ||
    value === "network-request"
  );
}

function isToolRiskCategory(value: unknown): value is ToolRiskCategory {
  return (
    value === ToolRiskCategory.Read ||
    value === ToolRiskCategory.Write ||
    value === ToolRiskCategory.Exec ||
    value === ToolRiskCategory.Install ||
    value === ToolRiskCategory.Network
  );
}

function createApprovalResultMessage(decision: ApprovalDecision, approval: ApprovalRequest): string {
  switch (decision) {
    case "deny":
      return `已拒绝执行 ${approval.label}。`;
    case "allow-once":
      return `已允许执行一次 ${approval.label}。`;
    case "allow-session":
      return `已允许本次运行执行 ${approval.label}。`;
    case "always-allow-tool":
      return `已始终允许执行 ${approval.label}，后续将不再重复询问。`;
    default:
      return `已处理 ${approval.label}。`;
  }
}

function isConfiguredModelProfile(profile: ModelProfile): boolean {
  const apiKey = profile.apiKey.trim();
  return Boolean(profile.baseUrl.trim() && profile.model.trim() && apiKey && apiKey !== "replace-me");
}

function shouldRequireInitialSetup(models: ModelProfile[]): boolean {
  return !models.some((profile) => isConfiguredModelProfile(profile));
}

function isProviderKind(value: unknown): value is ModelProfile["provider"] {
  return value === "openai-compatible" || value === "anthropic" || value === "local-gateway";
}

function isBaseUrlMode(value: unknown): value is NonNullable<ModelProfile["baseUrlMode"]> {
  return value === "manual" || value === "provider-root";
}

function isBuiltinToolApprovalMode(value: unknown): value is BuiltinToolApprovalMode {
  return value === "inherit" || value === "always-ask" || value === "always-allow";
}

function isEmployeeStatus(value: unknown): value is LocalEmployeeSummary["status"] {
  return value === "draft" || value === "active" || value === "archived";
}

function isEmployeeSource(value: unknown): value is LocalEmployeeSummary["source"] {
  return value === "personal" || value === "enterprise" || value === "hub";
}

function isWorkflowStatus(value: unknown): value is WorkflowDefinitionSummary["status"] {
  return value === "draft" || value === "active" || value === "archived";
}

function isWorkflowSource(value: unknown): value is WorkflowDefinitionSummary["source"] {
  return value === "personal" || value === "enterprise" || value === "hub";
}

function isMcpImportSource(value: unknown): value is MCPorterImportSource {
  return value === "claude" || value === "codex" || value === "cursor";
}

function isMcpSource(value: unknown): value is McpServerConfig["source"] {
  return value === "manual" || value === "claude" || value === "codex" || value === "cursor";
}

function isMcpTransport(value: unknown): value is McpServerConfig["transport"] {
  return value === "stdio" || value === "http";
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function readStringMap(value: unknown): Record<string, string> | null {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return null;
    }
    result[key] = entry;
  }
  return result;
}

function readStringArray(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }

    const trimmed = item.trim();
    if (trimmed) {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function isMemoryRecordKind(value: unknown): value is MemoryRecord["kind"] {
  return value === "profile" || value === "domain" || value === "entity" || value === "episodic-summary";
}

function isPendingWorkResumePolicy(value: unknown): value is PendingWorkResumePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { kind?: unknown; value?: unknown };
  return (
    (candidate.kind === "manual" ||
      candidate.kind === "time" ||
      candidate.kind === "event" ||
      candidate.kind === "heartbeat") &&
    (candidate.value === undefined || typeof candidate.value === "string")
  );
}

function isEmployeePackageManifest(value: unknown): value is EmployeePackageManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "employee-package" &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.role === "string" &&
    (candidate.defaultWorkflowIds === undefined ||
      (Array.isArray(candidate.defaultWorkflowIds) &&
        candidate.defaultWorkflowIds.every((item) => typeof item === "string")))
  );
}

function isWorkflowPackageManifest(value: unknown): value is WorkflowPackageManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "workflow-package" &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.entryWorkflowId === "string"
  );
}

function createEmployeeSummaryFromPayload(payload: Record<string, unknown>): LocalEmployeeSummary | null {
  const name = readNonEmptyString(payload, "name");
  const description = readNonEmptyString(payload, "description");
  if (!name || !description) {
    return null;
  }

  return {
    id: `employee-${crypto.randomUUID()}`,
    name,
    description,
    status: "draft",
    source: "personal",
    workflowIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function updateEmployeeSummary(
  existing: LocalEmployeeSummary,
  payload: Record<string, unknown>,
): LocalEmployeeSummary | null {
  const workflowIds = payload.workflowIds === undefined ? existing.workflowIds : readStringArray(payload.workflowIds);
  const status = payload.status === undefined ? existing.status : payload.status;
  const source = payload.source === undefined ? existing.source : payload.source;
  const name = payload.name === undefined ? existing.name : readNonEmptyString(payload, "name");
  const description =
    payload.description === undefined ? existing.description : readNonEmptyString(payload, "description");

  if (
    !name ||
    !description ||
    workflowIds === null ||
    !isEmployeeStatus(status) ||
    !isEmployeeSource(source)
  ) {
    return null;
  }

  return {
    ...existing,
    name,
    description,
    status,
    source,
    workflowIds,
    updatedAt: new Date().toISOString(),
  };
}

/** 统一补齐工作流摘要字段，兼容旧数据并避免 SQLite 写入 undefined。 */
function normalizeWorkflowSummary(summary: WorkflowDefinitionSummary): WorkflowSummary {
  return {
    ...summary,
    version: typeof summary.version === "number" && Number.isFinite(summary.version) ? summary.version : 1,
    nodeCount: typeof summary.nodeCount === "number" && Number.isFinite(summary.nodeCount) ? summary.nodeCount : 0,
    edgeCount: typeof summary.edgeCount === "number" && Number.isFinite(summary.edgeCount) ? summary.edgeCount : 0,
    libraryRootId:
      typeof summary.libraryRootId === "string" && summary.libraryRootId.trim()
        ? summary.libraryRootId
        : "personal",
  };
}

/** 根据 definition 重新计算可持久化摘要，确保列表页索引与图定义一致。 */
function buildWorkflowSummaryFromDefinition(definition: WorkflowDefinition): WorkflowSummary {
  return normalizeWorkflowSummary({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    status: definition.status,
    source: definition.source,
    updatedAt: definition.updatedAt,
    version: definition.version,
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    libraryRootId: definition.libraryRootId,
  });
}

/** 创建最小草稿 definition，保证 POST 后可直接进入 detail/studio。 */
function createDraftWorkflowDefinition(payload: Record<string, unknown>): WorkflowDefinition | null {
  const name = readNonEmptyString(payload, "name");
  const description = readNonEmptyString(payload, "description");
  if (!name || !description) {
    return null;
  }

  const now = new Date().toISOString();
  const workflowId = `workflow-${crypto.randomUUID()}`;
  const startNodeId = `node-start-${crypto.randomUUID()}`;
  const endNodeId = `node-end-${crypto.randomUUID()}`;
  const editor: WorkflowDefinition["editor"] = {
    canvas: {
      viewport: {
        offsetX: 0,
        offsetY: 0,
      },
      nodes: [
        {
          nodeId: startNodeId,
          position: {
            x: 120,
            y: 140,
          },
        },
        {
          nodeId: endNodeId,
          position: {
            x: 420,
            y: 140,
          },
        },
      ],
    },
  };

  const definition: WorkflowDefinition = {
    id: workflowId,
    name,
    description,
    status: "draft",
    source: "personal",
    updatedAt: now,
    version: 1,
    nodeCount: 2,
    edgeCount: 1,
    libraryRootId: "personal",
    entryNodeId: startNodeId,
    nodes: [
      {
        id: startNodeId,
        kind: "start",
        label: "Start",
      },
      {
        id: endNodeId,
        kind: "end",
        label: "End",
      },
    ],
    edges: [
      {
        id: `edge-${crypto.randomUUID()}`,
        fromNodeId: startNodeId,
        toNodeId: endNodeId,
        kind: "normal",
      },
    ],
    stateSchema: [],
    editor,
  };

  return definition;
}

/** 过滤 editor 中已失效的节点布局，避免 PATCH 只改 nodes 时遗留旧画布引用导致保存失败。 */
function reconcileWorkflowEditorWithNodes(
  editor: WorkflowDefinition["editor"],
  nodes: WorkflowDefinition["nodes"],
): WorkflowDefinition["editor"] {
  if (!editor) {
    return editor;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...editor,
    canvas: {
      ...editor.canvas,
      nodes: editor.canvas.nodes.filter((layout) => nodeIds.has(layout.nodeId)),
    },
  };
}

/** 合并 PATCH 输入并构造下一版 definition，仅允许工作流相关字段变更。 */
function applyWorkflowDefinitionPatch(
  existing: WorkflowDefinition,
  payload: Record<string, unknown>,
): WorkflowDefinition | null {
  const name = payload.name === undefined ? existing.name : readNonEmptyString(payload, "name");
  const description =
    payload.description === undefined ? existing.description : readNonEmptyString(payload, "description");
  const status = payload.status === undefined ? existing.status : payload.status;
  const source = payload.source === undefined ? existing.source : payload.source;
  const entryNodeId =
    payload.entryNodeId === undefined ? existing.entryNodeId : readNonEmptyString(payload, "entryNodeId");

  if (!name || !description || !entryNodeId || !isWorkflowStatus(status) || !isWorkflowSource(source)) {
    return null;
  }

  if (payload.nodes !== undefined && !Array.isArray(payload.nodes)) {
    return null;
  }
  if (payload.edges !== undefined && !Array.isArray(payload.edges)) {
    return null;
  }
  if (payload.stateSchema !== undefined && !Array.isArray(payload.stateSchema)) {
    return null;
  }
  if (
    payload.defaults !== undefined &&
    (payload.defaults === null || typeof payload.defaults !== "object" || Array.isArray(payload.defaults))
  ) {
    return null;
  }
  if (
    payload.editor !== undefined &&
    (payload.editor === null || typeof payload.editor !== "object" || Array.isArray(payload.editor))
  ) {
    return null;
  }

  const nodes = payload.nodes !== undefined ? (payload.nodes as WorkflowDefinition["nodes"]) : existing.nodes;
  const edges = payload.edges !== undefined ? (payload.edges as WorkflowDefinition["edges"]) : existing.edges;
  const stateSchema =
    payload.stateSchema !== undefined
      ? (payload.stateSchema as WorkflowDefinition["stateSchema"])
      : existing.stateSchema;
  const defaults =
    payload.defaults !== undefined ? (payload.defaults as WorkflowDefinition["defaults"]) : existing.defaults;
  const editorSource =
    payload.editor !== undefined ? (payload.editor as WorkflowDefinition["editor"]) : existing.editor;
  const editor =
    payload.nodes !== undefined && payload.editor === undefined
      ? reconcileWorkflowEditorWithNodes(editorSource, nodes)
      : editorSource;

  return {
    ...existing,
    name,
    description,
    status,
    source,
    entryNodeId,
    nodes,
    edges,
    stateSchema,
    defaults,
    editor,
    version: Math.max(1, existing.version + 1),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    updatedAt: new Date().toISOString(),
  };
}

function createEmployeeRunPayload(payload: Record<string, unknown>): {
  workflowId: string | null;
  summary: string;
  memory?: {
    kind: MemoryRecord["kind"];
    subject: string;
    content: string;
  };
  pendingWork?: {
    title: string;
    dueAt: string | null;
    expiresAt: string | null;
    maxAttempts: number;
    resumePolicy: PendingWorkResumePolicy;
  };
} | null {
  const workflowId = payload.workflowId === undefined ? null : readNonEmptyString(payload, "workflowId");
  const summary = readNonEmptyString(payload, "summary");

  if (!summary) {
    return null;
  }

  const result: {
    workflowId: string | null;
    summary: string;
    memory?: {
      kind: MemoryRecord["kind"];
      subject: string;
      content: string;
    };
    pendingWork?: {
      title: string;
      dueAt: string | null;
      expiresAt: string | null;
      maxAttempts: number;
      resumePolicy: PendingWorkResumePolicy;
    };
  } = {
    workflowId: workflowId || null,
    summary,
  };

  if (payload.memory !== undefined) {
    if (!payload.memory || typeof payload.memory !== "object" || Array.isArray(payload.memory)) {
      return null;
    }

    const memory = payload.memory as Record<string, unknown>;
    const kind = memory.kind;
    const subject = readNonEmptyString(memory, "subject");
    const content = readNonEmptyString(memory, "content");
    if (!isMemoryRecordKind(kind) || !subject || !content) {
      return null;
    }

    result.memory = {
      kind,
      subject,
      content,
    };
  }

  if (payload.pendingWork !== undefined) {
    if (!payload.pendingWork || typeof payload.pendingWork !== "object" || Array.isArray(payload.pendingWork)) {
      return null;
    }

    const pendingWork = payload.pendingWork as Record<string, unknown>;
    const title = readNonEmptyString(pendingWork, "title");
    const dueAt =
      pendingWork.dueAt === null || pendingWork.dueAt === undefined
        ? null
        : readNonEmptyString(pendingWork, "dueAt");
    const expiresAt =
      pendingWork.expiresAt === null || pendingWork.expiresAt === undefined
        ? null
        : readNonEmptyString(pendingWork, "expiresAt");
    const maxAttempts =
      typeof pendingWork.maxAttempts === "number" && Number.isFinite(pendingWork.maxAttempts)
        ? Math.max(1, Math.floor(pendingWork.maxAttempts))
        : 0;

    if (!title || !maxAttempts || !isPendingWorkResumePolicy(pendingWork.resumePolicy)) {
      return null;
    }

    result.pendingWork = {
      title,
      dueAt,
      expiresAt,
      maxAttempts,
      resumePolicy: pendingWork.resumePolicy,
    };
  }

  return result;
}

function readPublishDraftPayload(payload: Record<string, unknown>): {
  kind: "employee-package" | "workflow-package";
  sourceId: string;
  version: string;
} | null {
  const kind = payload.kind;
  const sourceId = readNonEmptyString(payload, "sourceId");
  const version = readNonEmptyString(payload, "version") || "0.1.0";

  if ((kind !== "employee-package" && kind !== "workflow-package") || !sourceId || !version) {
    return null;
  }

  return { kind, sourceId, version };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((entry) => isJsonValue(entry));
}

function readJsonRecord(value: unknown): Record<string, JsonValue> | null {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isJsonValue(entry)) {
      return null;
    }
    result[key] = entry;
  }
  return result;
}

function createMcpServerConfigFromPayload(
  payload: Record<string, unknown>,
  fixedId?: string,
): McpServerConfig | null {
  const id = fixedId ?? (readNonEmptyString(payload, "id") || `mcp-${crypto.randomUUID()}`);
  const name = readNonEmptyString(payload, "name");
  const source = payload.source;
  const transport = payload.transport;
  const enabled = payload.enabled;

  if (!id || !name || !isMcpSource(source) || !isMcpTransport(transport) || typeof enabled !== "boolean") {
    return null;
  }

  if (transport === "stdio") {
    const command = readNonEmptyString(payload, "command");
    const args = readStringArray(payload.args);
    const cwd = readNonEmptyString(payload, "cwd");
    const env = readStringMap(payload.env);

    if (!command || args === null || env === null) {
      return null;
    }

    const config: McpServerConfig = {
      id,
      name,
      source,
      transport: "stdio",
      command,
      enabled,
    };
    if (args.length > 0) {
      config.args = args;
    }
    if (cwd) {
      config.cwd = cwd;
    }
    if (env && Object.keys(env).length > 0) {
      config.env = env;
    }
    return config;
  }

  const url = readNonEmptyString(payload, "url");
  const headers = readStringMap(payload.headers);

  if (!url || headers === null) {
    return null;
  }

  const config: McpServerConfig = {
    id,
    name,
    source,
    transport: "http",
    url,
    enabled,
  };
  if (headers && Object.keys(headers).length > 0) {
    config.headers = headers;
  }
  return config;
}

function normalizeChatCompletionOutput(output: ChatCompletionOutput | string): ChatCompletionOutput {
  if (typeof output === "string") {
    return { content: output };
  }
  return output;
}

function normalizeToolCallName(value: string): string {
  return value.trim().toLowerCase().replace(/[-.\s]+/g, "_");
}

function parseMcpModelToolName(value: string): { serverId: string; toolName: string } | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("mcp_")) {
    return null;
  }

  const rest = trimmed.slice("mcp_".length);
  const lastSeparator = rest.lastIndexOf("_");
  if (lastSeparator <= 0 || lastSeparator >= rest.length - 1) {
    return null;
  }

  const serverId = rest.slice(0, lastSeparator);
  const toolName = rest.slice(lastSeparator + 1);

  if (!serverId || !toolName) {
    return null;
  }

  return { serverId, toolName };
}

function createExecutionIntentFromModelToolCall(call: ModelToolCall): ExecutionIntent | null {
  const mcpTarget = parseMcpModelToolName(call.name);
  if (mcpTarget) {
    return {
      source: "mcp-tool",
      toolId: `${mcpTarget.serverId}:${mcpTarget.toolName}`,
      label: mcpTarget.toolName,
      risk: ToolRiskCategory.Exec,
      detail: `Model requested MCP tool ${mcpTarget.serverId}/${mcpTarget.toolName}`,
      serverId: mcpTarget.serverId,
      toolName: mcpTarget.toolName,
      arguments: call.input,
    };
  }

  const toolName = normalizeToolCallName(call.name);

  if (toolName === "fs_read_file" || toolName === "read_file") {
    const path = readNonEmptyString(call.input, "path") || readNonEmptyString(call.input, "target");
    if (!path) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.read",
      label: path,
      risk: ToolRiskCategory.Read,
      detail: `模型请求读取文件：${path}`,
    };
  }

  if (toolName === "fs_write_file" || toolName === "write_file") {
    const path = readNonEmptyString(call.input, "path") || readNonEmptyString(call.input, "target");
    const content = typeof call.input.content === "string" ? call.input.content : "";
    if (!path) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.write",
      label: `${path}\n---\n${content}`,
      risk: ToolRiskCategory.Write,
      detail: `模型请求写入文件：${path}`,
    };
  }

  if (toolName === "fs_list_files" || toolName === "list_files") {
    const path = readNonEmptyString(call.input, "path") || ".";
    return {
      source: "builtin-tool",
      toolId: "fs.list",
      label: path,
      risk: ToolRiskCategory.Read,
      detail: `模型请求列出目录：${path}`,
    };
  }

  if (toolName === "fs_search" || toolName === "search_files") {
    const pattern = readNonEmptyString(call.input, "pattern") || readNonEmptyString(call.input, "query");
    const path = readNonEmptyString(call.input, "path") || ".";
    if (!pattern) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.search",
      label: `${pattern}\n---\n${path}`,
      risk: ToolRiskCategory.Read,
      detail: `模型请求搜索文本：${pattern}`,
    };
  }

  if (toolName === "fs_stat" || toolName === "stat_file") {
    const path = readNonEmptyString(call.input, "path") || readNonEmptyString(call.input, "target");
    if (!path) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.stat",
      label: path,
      risk: ToolRiskCategory.Read,
      detail: `模型请求查看文件信息：${path}`,
    };
  }

  if (toolName === "fs_apply_patch" || toolName === "apply_patch") {
    const patch = readNonEmptyString(call.input, "patch");
    if (!patch) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.apply_patch",
      label: patch,
      risk: ToolRiskCategory.Write,
      detail: "模型请求应用结构化补丁。",
    };
  }

  if (toolName === "fs_move" || toolName === "move_file") {
    const from = readNonEmptyString(call.input, "from") || readNonEmptyString(call.input, "source");
    const to = readNonEmptyString(call.input, "to") || readNonEmptyString(call.input, "destination");
    if (!from || !to) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.move",
      label: `${from}\n---\n${to}`,
      risk: ToolRiskCategory.Write,
      detail: `模型请求移动路径：${from} -> ${to}`,
    };
  }

  if (toolName === "fs_delete" || toolName === "delete_file") {
    const path = readNonEmptyString(call.input, "path") || readNonEmptyString(call.input, "target");
    if (!path) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.delete",
      label: path,
      risk: ToolRiskCategory.Write,
      detail: `模型请求删除路径：${path}`,
    };
  }

  if (toolName === "exec_command" || toolName === "shell_command" || toolName === "run_command") {
    const command = readNonEmptyString(call.input, "command");
    const cwd = readNonEmptyString(call.input, "cwd");
    if (!command) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "exec.command",
      label: command,
      risk: ToolRiskCategory.Exec,
      ...(cwd ? { arguments: { cwd } } : {}),
      detail: `模型请求执行命令：${command}`,
    };
  }

  if (toolName === "exec_task" || toolName === "run_task") {
    const taskId = readNonEmptyString(call.input, "taskId") || readNonEmptyString(call.input, "id");
    if (!taskId) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "exec.task",
      label: taskId,
      risk: ToolRiskCategory.Exec,
      detail: `模型请求执行预设任务：${taskId}`,
    };
  }

  if (toolName === "git_status") {
    const target = readNonEmptyString(call.input, "path") || ".";
    return {
      source: "builtin-tool",
      toolId: "git.status",
      label: target,
      risk: ToolRiskCategory.Read,
      detail: `模型请求查看 Git 状态：${target}`,
    };
  }

  if (toolName === "git_diff") {
    const target = readNonEmptyString(call.input, "target");
    return {
      source: "builtin-tool",
      toolId: "git.diff",
      label: target,
      risk: ToolRiskCategory.Read,
      detail: `模型请求查看 Git diff：${target || "working tree"}`,
    };
  }

  if (toolName === "git_show") {
    const ref = readNonEmptyString(call.input, "ref") || "HEAD";
    return {
      source: "builtin-tool",
      toolId: "git.show",
      label: ref,
      risk: ToolRiskCategory.Read,
      detail: `模型请求查看 Git 对象：${ref}`,
    };
  }

  if (toolName === "process_list") {
    const filter = readNonEmptyString(call.input, "filter");
    return {
      source: "builtin-tool",
      toolId: "process.list",
      label: filter,
      risk: ToolRiskCategory.Read,
      detail: `模型请求查看进程列表${filter ? `：${filter}` : ""}`,
    };
  }

  if (toolName === "process_kill" || toolName === "kill_process") {
    const rawPid = call.input.pid;
    const pid =
      typeof rawPid === "number"
        ? String(Math.trunc(rawPid))
        : readNonEmptyString(call.input, "pid");
    if (!pid) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "process.kill",
      label: pid,
      risk: ToolRiskCategory.Exec,
      detail: `模型请求终止进程：${pid}`,
    };
  }

  if (toolName === "run_skill" || toolName === "skill") {
    const invocation = readNonEmptyString(call.input, "invocation") || readNonEmptyString(call.input, "name");
    if (!invocation) {
      return null;
    }
    return {
      source: "skill",
      toolId: `skill.${invocation.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`,
      label: invocation,
      risk: ToolRiskCategory.Exec,
      detail: `模型请求执行 Skill：${invocation}`,
    };
  }

  if (toolName === "http_fetch" || toolName === "network_request" || toolName === "fetch_url") {
    const url = readNonEmptyString(call.input, "url");
    if (!url) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "http.fetch",
      label: url,
      risk: ToolRiskCategory.Network,
      detail: `模型请求访问网络：${url}`,
    };
  }

  if (toolName === "archive_extract" || toolName === "extract_archive") {
    const archivePath = readNonEmptyString(call.input, "archivePath") || readNonEmptyString(call.input, "path");
    const destinationPath = readNonEmptyString(call.input, "destinationPath") || ".";
    if (!archivePath) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "archive.extract",
      label: `${archivePath}\n---\n${destinationPath}`,
      risk: ToolRiskCategory.Write,
      detail: `模型请求解压归档：${archivePath}`,
    };
  }

  if (toolName === "fs_find" || toolName === "find_files" || toolName === "glob") {
    const pattern = readNonEmptyString(call.input, "pattern");
    const path = readNonEmptyString(call.input, "path") || ".";
    if (!pattern) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "fs.find",
      label: `${pattern}\n---\n${path}`,
      risk: ToolRiskCategory.Read,
      detail: `模型请求查找文件：${pattern}`,
    };
  }

  if (toolName === "web_search" || toolName === "search_web") {
    const query = readNonEmptyString(call.input, "query");
    if (!query) {
      return null;
    }
    return {
      source: "builtin-tool",
      toolId: "web.search",
      label: query,
      risk: ToolRiskCategory.Network,
      detail: `模型请求网络搜索：${query}`,
    };
  }

  if (toolName === "task_manage" || toolName === "manage_tasks" || toolName === "todo") {
    const action = readNonEmptyString(call.input, "action") || "list";
    const text = readNonEmptyString(call.input, "text") || "";
    return {
      source: "builtin-tool",
      toolId: "task.manage",
      label: `${action} ${text}`.trim(),
      risk: ToolRiskCategory.Read,
      arguments: { action, text },
      detail: `模型请求任务管理：${action}${text ? ` ${text}` : ""}`,
    };
  }

  return null;
}

/** 统一格式化模型工具调用参数，避免链路日志里出现过长或不可读的原始对象。 */
function formatToolCallInputValue(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 生成结构化工具调用日志，便于桌面端按步骤渲染执行链路。 */
function buildModelToolCallLog(call: ModelToolCall): string {
  const serializedInput = Object.entries(call.input ?? {})
    .map(([key, value]) => `${key}=${formatToolCallInputValue(value)}`)
    .join(" ")
    .trim();
  return serializedInput ? `[TOOL_CALL] ${call.name} ${serializedInput}` : `[TOOL_CALL] ${call.name}`;
}

/** 从技能调用意图中提取技能名，用于单独展示命中的 Skill。 */
function readSkillNameFromIntent(intent: ExecutionIntent): string | null {
  if (intent.source !== "skill") {
    return null;
  }

  const [skillName] = intent.label.trim().split(/\s+/, 1);
  return skillName?.trim() || null;
}

export async function createRuntimeApp(options: RuntimeOptions): Promise<RuntimeApp> {
  const runtimeStateFilePath = resolveRuntimeStateFilePath(options.stateFilePath);
  const runtimeLayout = resolveRuntimeLayout(runtimeStateFilePath);
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const isFirstLaunch = !(await runtimeStateExists(runtimeStateFilePath));
  const persistedState = await loadRuntimeState(runtimeStateFilePath);
  const models = persistedState.models;
  let defaultModelProfileId = persistedState.defaultModelProfileId;
  const persistedSessions = await loadSessionsSnapshot(runtimeLayout.sessionsDir);
  const sessions = {
    sessions: persistedSessions.length > 0 ? persistedSessions : persistedState.sessions,
  };
  const directoryService = new DirectoryService(workspaceRoot);
  const cloudHubProxy = new CloudHubProxy(options.cloudHubBaseUrl);
  const skillManager = new SkillManager(runtimeLayout.skillsDir);
  await skillManager.initialize();
  await saveSessionsSnapshot(runtimeLayout.sessionsDir, sessions.sessions);
  let skills = await skillManager.list();
  let approvals = persistedState.approvals ?? createApprovalPolicy();
  let mcpServerConfigs = persistedState.mcpServerConfigs ?? createDefaultMcpServerConfigs();
  let mcpToolPreferences = persistedState.mcpToolPreferences ?? [];
  let builtinToolPreferences = persistedState.builtinToolPreferences ?? [];
  let employees = persistedState.employees ?? [];
  let workflows = (persistedState.workflows ?? []).map((item) => normalizeWorkflowSummary(item));
  let workflowLibraryRoots: WorkflowLibraryRootRecord[] = persistedState.workflowLibraryRoots ?? [];
  let memoryRecords = persistedState.memoryRecords ?? [];
  let pendingWorkItems = persistedState.pendingWorkItems ?? [];
  let approvalRequests =
    persistedState.approvalRequests ??
    createDefaultApprovalRequests(sessions.sessions[0]?.id ?? "session-default", approvals);
  const chatCompletion = options.chatCompletion;
  const modelConversationRunner = options.modelConversationRunner ?? runModelConversation;
  const profileConnectivityCheck =
    options.profileConnectivityCheck ??
    (async ({ profile }) => {
      return testModelProfileConnectivity({ profile });
    });
  const profileModelCatalog =
    options.profileModelCatalog ??
    (async ({ profile }) => {
      return listAvailableModelIds({ profile });
    });
  const mcpService = new McpService({
    adapter: options.mcpAdapter ?? new NoopMCPorterAdapter(),
    initialConfigs: mcpServerConfigs,
  });
  const toolExecutor = new ToolExecutor(workspaceRoot, directoryService, skillManager, {
    invoke: async (serverId, toolName, args) => {
      const result = await mcpService.invoke(serverId, toolName, args);
      return {
        ok: result.ok,
        summary: result.summary,
        output: result.output,
      };
    },
  });
  const executeIntent =
    options.executeIntent ??
    (async ({ intent, session }) => {
      return toolExecutor.execute(intent, session);
    });

  // workflow-runs: 桌面个人态的轻量工作流图执行与检查点存储（不持久化，仅用于本进程的 create/inspect/resume）。
  const workflowRunDefinitions = new Map<string, WorkflowGraphDefinition>();
  const workflowRunMeta = new Map<string, { workflowId: string; workflowVersion: number }>();
  const workflowCheckpointStore = new WorkflowCheckpointStore({
    now: () => new Date().toISOString(),
    logger: {
      info: (message, data) => console.info(`[workflow-run] ${message}`, data ?? {}),
      warn: (message, data) => console.warn(`[workflow-run] ${message}`, data ?? {}),
      error: (message, data) => console.error(`[workflow-run] ${message}`, data ?? {}),
    },
  });
  const workflowHandlers: WorkflowNodeHandlerMap = {};
  const workflowExecutorLogger = {
    info: (message: string, data?: Record<string, unknown>) => console.info(`[workflow-run] ${message}`, data ?? {}),
    warn: (message: string, data?: Record<string, unknown>) => console.warn(`[workflow-run] ${message}`, data ?? {}),
    error: (message: string, data?: Record<string, unknown>) => console.error(`[workflow-run] ${message}`, data ?? {}),
  };

  function createWorkflowExecutorForDefinition(definition: WorkflowGraphDefinition): WorkflowGraphExecutor {
    // 为所有 task 节点提供默认 no-op 执行器，确保 stored workflow definitions 至少可被完整跑通（桌面个人态先保证可恢复/可追踪）。
    const handlers: WorkflowNodeHandlerMap = { ...workflowHandlers };
    for (const node of definition.nodes) {
      if (node.kind !== "task") {
        continue;
      }
      if (handlers[node.id]) {
        continue;
      }
      handlers[node.id] = async (input) => input.state;
    }

    return new WorkflowGraphExecutor({
      store: workflowCheckpointStore,
      handlers,
      logger: workflowExecutorLogger,
    });
  }

  /** 将内部运行记录转换为 UI/客户端更稳定的工作流运行摘要（兼容 shared 合同字段）。 */
  function toWorkflowRunSummary(runId: string): (WorkflowRunSummary & { state?: Record<string, unknown> }) | null {
    const run = workflowCheckpointStore.getRun(runId);
    if (!run) {
      return null;
    }

    const meta = workflowRunMeta.get(runId) ?? { workflowId: run.definitionId, workflowVersion: 1 };
    const latestCheckpoint = workflowCheckpointStore.getLatestCheckpoint(runId);
    const currentNodeIds =
      run.status === "paused" && run.pausedAtNodeId
        ? [run.pausedAtNodeId]
        : latestCheckpoint
          ? [latestCheckpoint.nodeId]
          : [];

    const status: WorkflowRunStatus =
      run.status === "paused"
        ? "waiting-input"
        : run.status === "running"
          ? "running"
          : run.status === "succeeded"
            ? "succeeded"
            : run.status === "failed"
              ? "failed"
              : "running";

    const finishedAt = run.status === "succeeded" || run.status === "failed" ? run.updatedAt : undefined;

    return {
      id: run.id,
      workflowId: meta.workflowId,
      workflowVersion: meta.workflowVersion,
      status,
      currentNodeIds,
      startedAt: run.createdAt,
      updatedAt: run.updatedAt,
      finishedAt,
      // 兼容：runtime 当前仍需要回传 state 便于桌面个人调试与测试断言。
      state: run.state,
    };
  }

  /** 将 shared WorkflowDefinition 适配成 runtime graph definition（仅支持 Task4 覆盖的节点类型）。 */
  function adaptWorkflowDefinitionToGraph(
    definition: WorkflowDefinition,
  ): { ok: true; graph: WorkflowGraphDefinition } | { ok: false; error: string } {
    const allowedMergeStrategies = new Set(["replace", "append", "union", "object-merge"]);

    const graph: WorkflowGraphDefinition = {
      id: definition.id,
      entryNodeId: definition.entryNodeId,
      nodes: definition.nodes.map((node) => {
        if (node.kind === "human-input") {
          return {
            id: node.id,
            kind: "human-input",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
            humanInput: { field: node.humanInput.formKey },
          };
        }
        if (node.kind === "join") {
          let overrides: Record<string, "replace" | "append" | "union" | "object-merge"> | undefined;
          if (node.join.mergeStrategyOverrides) {
            const mapped: Record<string, "replace" | "append" | "union" | "object-merge"> = {};
            for (const [fieldKey, strategy] of Object.entries(node.join.mergeStrategyOverrides)) {
              if (
                strategy === "replace" ||
                strategy === "append" ||
                strategy === "union" ||
                strategy === "object-merge"
              ) {
                mapped[fieldKey] = strategy;
              }
            }
            overrides = Object.keys(mapped).length ? mapped : undefined;
          }
          return {
            id: node.id,
            kind: "join",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
            join: {
              upstreamNodeIds: node.join.upstreamNodeIds,
              mergeStrategyOverrides: overrides,
            },
          };
        }
        if (node.kind === "condition") {
          return {
            id: node.id,
            kind: "condition",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
            condition: node.condition,
            route: node.route,
          };
        }
        if (node.kind === "llm") {
          return {
            id: node.id,
            kind: "llm",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
            llm: {
              prompt: node.llm.prompt,
              outputKey: node.llm.outputKey,
            },
          };
        }
        if (node.kind === "tool") {
          return {
            id: node.id,
            kind: "tool",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
            tool: {
              toolId: node.tool.toolId,
              outputKey: node.tool.outputKey,
            },
          };
        }
        if (node.kind === "subgraph") {
          return {
            id: node.id,
            kind: "subgraph",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
            subgraph: {
              workflowId: node.subgraph.workflowId,
              outputKey: node.subgraph.outputKey,
            },
          };
        }
        if (["tool", "llm", "subgraph"].includes(node.kind as "tool" | "llm" | "subgraph")) {
          // 最小兼容：当前 runtime executor 不执行真实 tool/llm/subgraph，仅作为可追踪的 task 节点前进。
          return {
            id: node.id,
            kind: "task",
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
          };
        }
        if (node.kind === "start" || node.kind === "end") {
          return {
            id: node.id,
            kind: node.kind,
            label: node.label,
            policy: node.policy?.retry ? { retry: { maxAttempts: node.policy.retry.maxAttempts } } : undefined,
          };
        }

        return { id: (node as { id: string }).id, kind: "task", label: (node as { label: string }).label };
      }) as WorkflowGraphDefinition["nodes"],
      edges: definition.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: edge.kind,
        condition: (edge as { condition?: unknown }).condition as WorkflowGraphDefinition["edges"][number]["condition"],
      })) as WorkflowGraphDefinition["edges"],
    };

    return { ok: true, graph };
  }

  function snapshotMcpServerConfigs(): void {
    mcpServerConfigs = mcpService.listServers().map((server) => toMcpServerConfig(server));
  }

  async function persistState() {
    snapshotMcpServerConfigs();
    await saveSessionsSnapshot(runtimeLayout.sessionsDir, sessions.sessions);
    await saveRuntimeState(
      {
        models,
        defaultModelProfileId,
        sessions: [],
        approvals,
        mcpServerConfigs,
        mcpToolPreferences,
        builtinToolPreferences,
        approvalRequests,
        employees,
        workflows,
        workflowLibraryRoots,
        memoryRecords,
        pendingWorkItems,
      },
      runtimeStateFilePath,
    );
  }

  /** 严格读取工作流 definition，任何加载异常都直接失败，避免静默回填覆盖问题数据。 */
  async function readWorkflowDefinitionStrict(summary: WorkflowDefinitionSummary): Promise<{
    ok: true;
    definition: WorkflowDefinition;
  } | {
    ok: false;
    detail: string;
  }> {
    const normalizedSummary = normalizeWorkflowSummary(summary);
    try {
      const definition = await loadWorkflowDefinition({
        workflowId: normalizedSummary.id,
        libraryRootId: normalizedSummary.libraryRootId,
        roots: workflowLibraryRoots,
        layout: runtimeLayout,
      });
      const validationResult = validateWorkflowDefinition(definition);
      if (!validationResult.valid) {
        throw new Error(`Invalid workflow definition: ${validationResult.error}`);
      }
      return { ok: true, definition };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error("[workflow-api] 工作流 definition 加载失败，拒绝自动回填默认图。", {
        workflowId: normalizedSummary.id,
        detail,
      });
      return { ok: false, detail };
    }
  }

  function toMcpServerConfig(server: McpServer): McpServerConfig {
    if (server.transport === "stdio") {
      const config: McpServerConfig = {
        id: server.id,
        name: server.name,
        source: server.source,
        transport: "stdio",
        command: server.command,
        enabled: server.enabled,
      };
      if (server.args && server.args.length > 0) {
        config.args = server.args;
      }
      if (server.cwd) {
        config.cwd = server.cwd;
      }
      if (server.env && Object.keys(server.env).length > 0) {
        config.env = server.env;
      }
      return config;
    }

    const config: McpServerConfig = {
      id: server.id,
      name: server.name,
      source: server.source,
      transport: "http",
      url: server.url,
      enabled: server.enabled,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      config.headers = server.headers;
    }
    return config;
  }

  /** 根据静态定义和用户偏好生成当前生效的内置工具目录。 */
  function buildResolvedBuiltinTools() {
    return resolveBuiltinTools(builtinToolPreferences);
  }

  function buildMcpModelToolName(serverId: string, toolName: string): string {
    return `mcp_${serverId}_${toolName}`;
  }

  /** 生成内联 Skill 摘要，供工具描述与系统提示复用，确保模型知道当前可路由的本地技能。 */
  function buildInlineSkillCatalog(limit = 12): string {
    if (skills.length === 0) {
      return "No local skills are currently installed.";
    }

    const visibleSkills = skills.slice(0, limit).map((skill) => `${skill.name} - ${skill.description}`);
    if (skills.length <= limit) {
      return visibleSkills.join("; ");
    }

    return `${visibleSkills.join("; ")}; ... and ${skills.length - limit} more skill(s)`;
  }

  /** 生成发给模型的 Skill 路由提示，明确告知可用技能与优先调用 run_skill 的时机。 */
  function buildSkillRoutingPrompt(): string | null {
    if (skills.length === 0) {
      return null;
    }

    return [
      "当前可用的本地 Skills：",
      ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
      "当用户请求与某个 Skill 的描述明显匹配时，优先调用 run_skill，而不是继续泛泛追问。",
      "调用 run_skill 时，invocation 的第一个 token 必须是 Skill 名称，后面再补充必要参数。",
    ].join("\n");
  }

  /** 生成模型可见的 run_skill 工具定义，把本地 Skill 目录摘要直接暴露给模型做命中判断。 */
  function buildRunSkillToolDefinition(): ModelConversationToolDefinition {
    return {
      name: "run_skill",
      description: `Run a local skill from the skills directory. Available skills: ${buildInlineSkillCatalog()}. When a user's request clearly matches one of these skills, call this tool instead of continuing as a generic conversation.`,
      parameters: {
        type: "object",
        properties: {
          invocation: {
            type: "string",
            description: "Skill invocation string, for example 'code-review src'.",
          },
        },
        required: ["invocation"],
        additionalProperties: false,
      },
    };
  }

  /** 生成模型请求前置的系统消息，统一注入 A2UI 约束与本地 Skill 路由目录。 */
  /** 生成工具使用约束，要求模型在可调用工具足以回答实时或外部问题时先用工具而不是自我设限。 */
  function buildToolUsagePrompt(): string {
    return [
      "You have access to tools provided by the runtime.",
      "When the user asks for current or external data, workspace state, filesystem contents, network resources, git status, or any task that a listed tool can answer, call the relevant tool first.",
      "If a matching tool is available, do not claim that you cannot access the data, browse the web, inspect files, or perform the action.",
      "Only answer without tools when the request can be completed from the conversation alone or no suitable tool is available.",
    ].join("\n");
  }

  /** 根据最后一条用户消息补充强约束，避免天气类实时问题被模型直接口头拒答。 */
  function buildRequestSpecificToolUsagePrompt(
    conversationMessages: ChatMessage[],
    availableTools: ModelConversationToolDefinition[],
  ): string | null {
    const latestUserContent = [...conversationMessages]
      .reverse()
      .find((message) => message.role === "user" && message.content.trim().length > 0)
      ?.content.trim();

    if (!latestUserContent) {
      return null;
    }

    const weatherToolName = availableTools.find((tool) =>
      ["http_fetch", "network_request", "fetch_url"].includes(tool.name),
    )?.name;
    if (!weatherToolName) {
      return null;
    }

    const asksForWeather = /weather|forecast|temperature|天气|气温|温度|下雨|下雪|冷不冷|热不热/iu.test(
      latestUserContent,
    );
    if (!asksForWeather) {
      return null;
    }

    return [
      "For this request, the user is asking for live weather information.",
      `Call the \`${weatherToolName}\` tool before answering so you can inspect the latest weather response.`,
      "Do not answer from memory or claim that you lack real-time weather access when the tool is available.",
    ].join("\n");
  }

  /** 生成模型请求前置的系统消息，统一注入 A2UI 约束、工具使用约束与本地 Skill 路由目录。 */
  function buildModelSystemMessages(input: {
    conversationMessages: ChatMessage[];
    availableTools: ModelConversationToolDefinition[];
  }): ChatMessage[] {
    const systemMessages: ChatMessage[] = [
      {
        id: "msg-system-a2ui-contract",
        role: "system",
        content: A2UI_ASSISTANT_SYSTEM_PROMPT,
        createdAt: new Date().toISOString(),
      },
      {
        id: "msg-system-tool-usage",
        role: "system",
        content: buildToolUsagePrompt(),
        createdAt: new Date().toISOString(),
      },
    ];

    const requestSpecificToolPrompt = buildRequestSpecificToolUsagePrompt(
      input.conversationMessages,
      input.availableTools,
    );
    if (requestSpecificToolPrompt) {
      systemMessages.push({
        id: "msg-system-tool-usage-request",
        role: "system",
        content: requestSpecificToolPrompt,
        createdAt: new Date().toISOString(),
      });
    }

    const skillRoutingPrompt = buildSkillRoutingPrompt();
    if (skillRoutingPrompt) {
      systemMessages.push({
        id: "msg-system-skill-routing",
        role: "system",
        content: skillRoutingPrompt,
        createdAt: new Date().toISOString(),
      });
    }

    return systemMessages;
  }

  function buildResolvedMcpTools(): ResolvedMcpTool[] {
    return mcpService.listTools().map((tool) => {
      const preference = mcpToolPreferences.find((item) => item.toolId === tool.id);
      const enabled = preference?.enabled ?? true;
      const exposedToModel = enabled ? (preference?.exposedToModel ?? true) : false;

      return {
        ...tool,
        enabled,
        exposedToModel,
        effectiveApprovalMode: preference?.approvalModeOverride ?? "inherit",
      };
    });
  }

  /** 组合当前允许暴露给模型的内置工具与保留的非内置工具。 */
  function buildModelToolDefinitions(): ModelConversationToolDefinition[] {
    const builtinTools = listExposedBuiltinModelTools(buildResolvedBuiltinTools());
    const mcpTools: ModelConversationToolDefinition[] = buildResolvedMcpTools()
      .filter((tool) => tool.enabled && tool.exposedToModel)
      .map((tool) => ({
        name: buildMcpModelToolName(tool.serverId, tool.name),
        description: tool.description,
        parameters:
          tool.inputSchema && Object.keys(tool.inputSchema).length > 0
            ? tool.inputSchema
            : { type: "object" },
      }));

    return [...builtinTools, ...mcpTools, buildRunSkillToolDefinition()];
  }

  function resolveSessionProfile(session: ChatSession): ModelProfile | null {
    const preferredProfileId = session.modelProfileId || defaultModelProfileId;
    let profile = models.find((item) => item.id === preferredProfileId);
    if (!profile && defaultModelProfileId) {
      profile = models.find((item) => item.id === defaultModelProfileId);
    }

    return profile ?? null;
  }

  async function executeIntentAndAppend(sessionId: string, intent: ExecutionIntent): Promise<ChatSession | null> {
    const session = sessions.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return null;
    }

    try {
      const result = await executeIntent({ intent, session });
      const summary = result.ok ? result.summary : `执行失败：${result.summary}`;
      const updatedSession = appendSystemMessage(sessions.sessions, sessionId, summary);
      if (result.output.trim()) {
        appendToolMessage(sessions.sessions, sessionId, clipOutput(result.output));
      }
      return updatedSession;
    } catch (error) {
      return appendSystemMessage(
        sessions.sessions,
        sessionId,
        `执行异常：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }

  async function continueModelConversation(sessionId: string): Promise<ChatSession | null> {
    const session = sessions.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return null;
    }

    const profile = resolveSessionProfile(session);
    if (!profile) {
      return appendSystemMessage(sessions.sessions, sessionId, "默认模型未配置，无法继续当前会话。");
    }

    skills = await skillManager.list();
    const modelToolLogs: Array<{ role: "system" | "tool"; content: string }> = [];
    const availableTools = buildModelToolDefinitions();
    const modelMessages: ChatMessage[] = [
      ...buildModelSystemMessages({ conversationMessages: session.messages, availableTools }),
      ...session.messages,
    ];

    try {
      const assistantResult = chatCompletion
        ? normalizeChatCompletionOutput(
          await chatCompletion({
            profile,
            messages: modelMessages,
            availableTools,
          }),
        )
        : await modelConversationRunner({
          profile,
          messages: modelMessages,
          tools: availableTools,
          onToolCall: async (call) =>
            executeModelToolCall({
              sessionId,
              call,
              logs: modelToolLogs,
            }),
        });

      for (const log of modelToolLogs) {
        if (log.role === "system") {
          appendSystemMessage(sessions.sessions, sessionId, log.content);
        } else {
          appendToolMessage(sessions.sessions, sessionId, log.content);
        }
      }

      const assistantReply = parseAssistantReply(assistantResult.content);
      return appendAssistantMessage(sessions.sessions, sessionId, {
        content: assistantReply.content,
        reasoning: assistantResult.reasoning ?? null,
        ui: assistantReply.ui ?? null,
      });
    } catch (error) {
      return appendSystemMessage(
        sessions.sessions,
        sessionId,
        `继续会话失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }

  /** 记录模型工具链路日志，并在需要时立刻推送给流式会话订阅端。 */
  async function recordModelToolLog(
    input: {
      logs: Array<{ role: "system" | "tool"; content: string }>;
      onLog?: (log: { role: "system" | "tool"; content: string }) => void | Promise<void>;
    },
    log: { role: "system" | "tool"; content: string },
  ): Promise<void> {
    input.logs.push(log);
    await input.onLog?.(log);
  }

  async function executeModelToolCall(input: {
    sessionId: string;
    call: ModelToolCall;
    logs: Array<{ role: "system" | "tool"; content: string }>;
    onLog?: (log: { role: "system" | "tool"; content: string }) => void | Promise<void>;
  }): Promise<ModelToolCallResult> {
    const intent = createExecutionIntentFromModelToolCall(input.call);
    if (!intent) {
      const message = `工具调用参数无效：${input.call.name}`;
      await recordModelToolLog(input, { role: "system", content: message });
      return { content: message, stop: true };
    }

    await recordModelToolLog(input, { role: "system", content: buildModelToolCallLog(input.call) });
    const skillName = readSkillNameFromIntent(intent);
    if (skillName) {
      await recordModelToolLog(input, { role: "system", content: `[SKILL] ${skillName}` });
      await recordModelToolLog(input, { role: "system", content: `[STATUS] 技能正在执行：${intent.label}` });
    }

    const policyResult = createExecutionIntentResult({
      sessionId: input.sessionId,
      policy: approvals,
      intent,
    });

    const approvalRequest = policyResult.approvalRequest
      ? {
        ...policyResult.approvalRequest,
        resumeConversation: true,
      }
      : null;

    if (approvalRequest) {
      approvalRequests = [...approvalRequests, approvalRequest];
    }

    await recordModelToolLog(input, { role: "system", content: policyResult.message });

    if (policyResult.status === "pending") {
      return { content: policyResult.message, stop: true };
    }

    const currentSession = sessions.sessions.find((item) => item.id === input.sessionId);
    if (!currentSession) {
      const missingMessage = "会话不存在，无法执行工具调用。";
      await recordModelToolLog(input, { role: "system", content: missingMessage });
      return { content: missingMessage, stop: true };
    }

    try {
      const result = await executeIntent({ intent, session: currentSession });
      const summary = result.ok ? result.summary : `执行失败：${result.summary}`;
      await recordModelToolLog(input, { role: "system", content: summary });

      const output = result.output.trim() ? clipOutput(result.output) : "";
      if (output) {
        await recordModelToolLog(input, { role: "tool", content: output });
      }

      return {
        content: output || summary,
        stop: !result.ok,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";

      if (errorMessage.includes("路径越界")) {
        const pathApproval: typeof approvalRequests[number] = {
          id: `approval-${crypto.randomUUID()}`,
          sessionId: input.sessionId,
          source: intent.source,
          toolId: intent.toolId,
          label: intent.label,
          risk: ToolRiskCategory.Exec,
          detail: `模型请求访问工作区外部路径：${intent.label}`,
          serverId: intent.serverId,
          toolName: intent.toolName,
          arguments: { ...intent.arguments, allowOutOfWorkspace: true },
          resumeConversation: true,
        };
        approvalRequests = [...approvalRequests, pathApproval];
        const msg = `需要授权：访问工作区外部路径 ${intent.label}`;
        await recordModelToolLog(input, { role: "system", content: msg });
        return { content: msg, stop: true };
      }

      const message = `执行异常：${errorMessage}`;
      await recordModelToolLog(input, { role: "system", content: message });
      return { content: message, stop: true };
    }
  }

  const runtimeContext = createRuntimeContext({
    runtime: {
      runtimeStateFilePath,
      runtimeLayout,
      isFirstLaunch,
    },
    state: {
      models,
      sessions,
      getDefaultModelProfileId: () => defaultModelProfileId,
      getEmployees: () => employees,
      getWorkflows: () => workflows,
      getApprovals: () => approvals,
      getApprovalRequests: () => approvalRequests,
      setApprovalRequests: (requests) => {
        approvalRequests = requests;
      },
    },
    services: {
      refreshSkills: async () => {
        skills = await skillManager.list();
        return skills;
      },
      listMcpServers: () => mcpService.listServers(),
    },
    tools: {
      resolveBuiltinTools: () => buildResolvedBuiltinTools(),
      resolveMcpTools: () => buildResolvedMcpTools(),
    },
    guards: {
      shouldRequireInitialSetup: () => shouldRequireInitialSetup(models),
    },
  });
  const router = createHttpRouter();
  registerBootstrapRoutes(router, runtimeContext);
  /**
   * 统一包装会话模型请求，保持与旧实现一致的 chatCompletion / provider 回退语义。
   */
  const runSessionConversation = async (input: {
    profile: ModelProfile;
    messages: ChatMessage[];
    availableTools: ModelConversationToolDefinition[];
    onToolCall: (call: ModelToolCall) => Promise<ModelToolCallResult>;
    onAssistantDelta?: (delta: { content?: string; reasoning?: string }) => Promise<void>;
  }): Promise<ChatCompletionOutput> => {
    if (chatCompletion) {
      return normalizeChatCompletionOutput(
        await chatCompletion({
          profile: input.profile,
          messages: input.messages,
          availableTools: input.availableTools,
        }),
      );
    }

    return modelConversationRunner({
      profile: input.profile,
      messages: input.messages,
      tools: input.availableTools,
      onToolCall: input.onToolCall,
      onAssistantDelta: input.onAssistantDelta,
    });
  };
  registerSessionRoutes(router, runtimeContext, {
    readJsonBody,
    persistState,
    resolveSessionProfile,
    refreshSkills: async () => {
      skills = await skillManager.list();
    },
    buildModelToolDefinitions,
    buildModelSystemMessages,
    executeModelToolCall,
    runConversation: runSessionConversation,
  });

  /** 复制桌面请求中的鉴权与内容类型头，确保 cloud 看到的请求上下文与前端一致。 */
  function buildCloudProxyHeaders(request: import("node:http").IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    if (typeof request.headers.authorization === "string" && request.headers.authorization.trim()) {
      headers.authorization = request.headers.authorization.trim();
    }
    if (typeof request.headers["content-type"] === "string" && request.headers["content-type"].trim()) {
      headers["content-type"] = request.headers["content-type"].trim();
    }
    return headers;
  }

  /** 将 desktop 请求代理到 cloud API，并把上游状态码与响应体原样返回给桌面前端。 */
  async function proxyCloudApiRequest(input: {
    request: import("node:http").IncomingMessage;
    response: import("node:http").ServerResponse;
    relativePath: string;
    searchParams?: URLSearchParams;
  }) {
    try {
      const body = input.request.method === "GET" || input.request.method === "HEAD"
        ? undefined
        : await readRequestBodyText(input.request);
      const proxied = await cloudHubProxy.forward(input.relativePath, {
        method: input.request.method ?? "GET",
        searchParams: input.searchParams,
        headers: buildCloudProxyHeaders(input.request),
        body,
      });
      input.response.writeHead(proxied.status, { "content-type": proxied.contentType });
      input.response.end(proxied.body);
    } catch (error) {
      input.response.writeHead(502, { "content-type": "application/json" });
      input.response.end(
        JSON.stringify({
          error: "cloud_api_proxy_failed",
          detail: error instanceof Error ? error.message : "Unknown cloud api proxy failure",
        }),
      );
    }
  }

  const server = createServer(
    createRuntimeHttpRequestHandler({
      router,
      runtimeContext,
      fallbackHandler: async ({ request, response, requestUrl }) => {
        if (request.method === "POST" && requestUrl.pathname === "/api/cloud-auth/login") {
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: "/api/auth/login",
          });
          return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/cloud-auth/refresh") {
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: "/api/auth/refresh",
          });
          return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/cloud-auth/introspect") {
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: "/api/auth/introspect",
          });
          return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/cloud-auth/logout") {
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: "/api/auth/logout",
          });
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/cloud-hub/skills") {
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: "/api/skills",
            searchParams: requestUrl.searchParams,
          });
          return;
        }

        const cloudSkillDetailMatch =
          request.method === "GET" ? requestUrl.pathname.match(/^\/api\/cloud-hub\/skills\/([^/]+)$/) : null;
        if (cloudSkillDetailMatch) {
          const skillId = decodeURIComponent(cloudSkillDetailMatch[1] ?? "");
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: `/api/skills/${encodeURIComponent(skillId)}`,
          });
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/cloud-hub/items") {
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: "/api/hub/items",
            searchParams: requestUrl.searchParams,
          });
          return;
        }

        const cloudHubItemMatch =
          request.method === "GET" ? requestUrl.pathname.match(/^\/api\/cloud-hub\/items\/([^/]+)$/) : null;
        if (cloudHubItemMatch) {
          const itemId = decodeURIComponent(cloudHubItemMatch[1] ?? "");
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: `/api/hub/items/${encodeURIComponent(itemId)}`,
          });
          return;
        }

        const cloudHubManifestMatch =
          request.method === "GET"
            ? requestUrl.pathname.match(/^\/api\/cloud-hub\/releases\/([^/]+)\/manifest$/)
            : null;
        if (cloudHubManifestMatch) {
          const releaseId = decodeURIComponent(cloudHubManifestMatch[1] ?? "");
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: `/api/hub/releases/${encodeURIComponent(releaseId)}/manifest`,
          });
          return;
        }

        const cloudHubDownloadTokenMatch =
          request.method === "GET"
            ? requestUrl.pathname.match(/^\/api\/cloud-hub\/releases\/([^/]+)\/download-token$/)
            : null;
        if (cloudHubDownloadTokenMatch) {
          const releaseId = decodeURIComponent(cloudHubDownloadTokenMatch[1] ?? "");
          await proxyCloudApiRequest({
            request,
            response,
            relativePath: `/api/hub/releases/${encodeURIComponent(releaseId)}/download-token`,
          });
          return;
        }

        const skillDetailMatch =
          request.method === "GET" ? request.url.match(/^\/api\/skills\/([^/]+)$/) : null;
        if (skillDetailMatch) {
          const skillId = decodeURIComponent(skillDetailMatch[1] ?? "");
          console.info("[skills-api] 加载 Skill 详情", { skillId });
          const skill = await skillManager.getDetail(skillId);

          if (!skill) {
            console.warn("[skills-api] Skill 详情不存在", { skillId });
            response.writeHead(404, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "skill_not_found" }));
            return;
          }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ skill }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/skills/import-cloud-release") {
      const payload = await readJsonBody(request);
      const downloadUrl = readNonEmptyString(payload, "downloadUrl");
      const skillName =
        readNonEmptyString(payload, "skillName") ||
        readNonEmptyString(payload, "name");

      if (!downloadUrl || !skillName) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_cloud_skill_import_payload" }));
        return;
      }

      try {
        const skill = await skillManager.installCloudSkillRelease({
          downloadUrl,
          skillName,
        });
        skills = await skillManager.list();
        await persistState();

        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ skill, skills: { items: skills } }));
      } catch (error) {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: "cloud_skill_import_failed",
            detail: error instanceof Error ? error.message : "Unknown cloud skill import failure",
          }),
        );
      }

      return;
    }

    if (request.method === "POST" && request.url === "/api/employee-packages/install") {
      const payload = await readJsonBody(request);
      const itemId = readNonEmptyString(payload, "itemId");
      const releaseId = readNonEmptyString(payload, "releaseId");
      const name = readNonEmptyString(payload, "name");
      const summary = readNonEmptyString(payload, "summary");
      const downloadUrl = readNonEmptyString(payload, "downloadUrl");

      if (!itemId || !releaseId || !name || !isEmployeePackageManifest(payload.manifest)) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_employee_package_install_payload" }));
        return;
      }

      const result = await installHubEmployeePackage({
        outputDir: runtimeLayout.employeePackagesDir,
        itemId,
        releaseId,
        name,
        summary,
        downloadUrl,
        manifest: payload.manifest,
      });
      employees = [result.employee, ...employees];
      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...result, items: employees }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/workflow-packages/install") {
      const payload = await readJsonBody(request);
      const itemId = readNonEmptyString(payload, "itemId");
      const releaseId = readNonEmptyString(payload, "releaseId");
      const name = readNonEmptyString(payload, "name");
      const summary = readNonEmptyString(payload, "summary");
      const downloadUrl = readNonEmptyString(payload, "downloadUrl");

      if (!itemId || !releaseId || !name || !isWorkflowPackageManifest(payload.manifest)) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_workflow_package_install_payload" }));
        return;
      }

      const result = await installHubWorkflowPackage({
        outputDir: runtimeLayout.workflowsDir,
        itemId,
        releaseId,
        name,
        summary,
        downloadUrl,
        manifest: payload.manifest,
      });
      workflows = [normalizeWorkflowSummary(result.workflow), ...workflows];
      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...result, items: workflows }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/publish-drafts") {
      const payload = await readJsonBody(request);
      const publishPayload = readPublishDraftPayload(payload);

      if (!publishPayload) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_publish_draft_payload" }));
        return;
      }

      if (publishPayload.kind === "employee-package") {
        const employee = employees.find((item) => item.id === publishPayload.sourceId);
        if (!employee) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "employee_not_found" }));
          return;
        }

        const draft = await createPublishDraft({
          outputDir: runtimeLayout.publishDraftsDir,
          kind: "employee-package",
          version: publishPayload.version,
          employee,
          workflows,
        });

        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ draft }));
        return;
      }

      const workflow = workflows.find((item) => item.id === publishPayload.sourceId);
      if (!workflow) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_not_found" }));
        return;
      }

      const draft = await createPublishDraft({
        outputDir: runtimeLayout.publishDraftsDir,
        kind: "workflow-package",
        version: publishPayload.version,
        workflow,
      });

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ draft }));
      return;
    }

    if (request.method === "GET" && request.url === "/api/employees") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: employees }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/employees") {
      const payload = await readJsonBody(request);
      const employee = createEmployeeSummaryFromPayload(payload);

      if (!employee) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_employee_payload" }));
        return;
      }

      employees = [employee, ...employees];
      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ employee, items: employees }));
      return;
    }

    const employeeRunMatch = request.url.match(/^\/api\/employees\/([^/]+)\/runs$/);
    if (employeeRunMatch && request.method === "POST") {
      const employeeId = decodeURIComponent(employeeRunMatch[1]);
      const employee = employees.find((item) => item.id === employeeId);
      if (!employee) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "employee_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const runPayload = createEmployeeRunPayload(payload);
      if (!runPayload) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_employee_run_payload" }));
        return;
      }

      if (runPayload.workflowId && !workflows.some((item) => item.id === runPayload.workflowId)) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_not_found" }));
        return;
      }

      const result = executeEmployeeRun({
        employeeId,
        workflowId: runPayload.workflowId,
        summary: runPayload.summary,
        memory: runPayload.memory,
        pendingWork: runPayload.pendingWork,
      });

      if (result.memoryRecord) {
        memoryRecords = [result.memoryRecord, ...memoryRecords];
      }

      if (result.pendingWork) {
        pendingWorkItems = [result.pendingWork, ...pendingWorkItems];
      }

      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }

    const employeeMatch = request.url.match(/^\/api\/employees\/([^/]+)$/);
    if (employeeMatch && request.method === "GET") {
      const employee = employees.find((item) => item.id === decodeURIComponent(employeeMatch[1]));
      if (!employee) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "employee_not_found" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ employee }));
      return;
    }

    if (employeeMatch && request.method === "PATCH") {
      const employeeId = decodeURIComponent(employeeMatch[1]);
      const index = employees.findIndex((item) => item.id === employeeId);
      if (index < 0) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "employee_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const updatedEmployee = updateEmployeeSummary(employees[index], payload);
      if (!updatedEmployee) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_employee_payload" }));
        return;
      }

      employees = employees.map((item, itemIndex) => (itemIndex === index ? updatedEmployee : item));
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ employee: updatedEmployee }));
      return;
    }

    // workflow-runs: 工作流图运行（create/inspect/resume/list），用于桌面个人工作流的确定性执行与恢复。
    if (request.method === "GET" && request.url === "/api/workflow-runs") {
      const items = workflowCheckpointStore
        .listRuns()
        .map((run) => toWorkflowRunSummary(run.id))
        .filter((run): run is NonNullable<typeof run> => Boolean(run));

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/workflow-runs") {
      const payload = await readJsonBody(request);
      const workflowId = typeof payload.workflowId === "string" ? payload.workflowId.trim() : "";
      const initialState = payload.initialState;

      let definition: WorkflowGraphDefinition | null = null;
      let definitionWorkflowId = "";
      let definitionWorkflowVersion = 1;

      const rawDefinition = payload.definition as WorkflowGraphDefinition | undefined;
      if (
        rawDefinition &&
        typeof rawDefinition === "object" &&
        typeof rawDefinition.id === "string" &&
        typeof rawDefinition.entryNodeId === "string" &&
        Array.isArray(rawDefinition.nodes) &&
        Array.isArray(rawDefinition.edges)
      ) {
        const entryNode = rawDefinition.nodes.find((node) => node && (node as { id?: unknown }).id === rawDefinition.entryNodeId);
        if (!entryNode || (entryNode as { kind?: unknown }).kind !== "start") {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "invalid_workflow_run_payload" }));
          return;
        }
        definition = rawDefinition;
        definitionWorkflowId = rawDefinition.id;
        definitionWorkflowVersion = 1;
      } else if (workflowId) {
        const summary = workflows.find((item) => item.id === workflowId);
        if (!summary) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "workflow_not_found" }));
          return;
        }
        const loadResult = await readWorkflowDefinitionStrict(summary);
        if (!loadResult.ok) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "workflow_definition_load_failed", detail: loadResult.detail }));
          return;
        }

        const adapted = adaptWorkflowDefinitionToGraph(loadResult.definition);
        if (!adapted.ok) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "workflow_definition_unsupported", detail: adapted.error }));
          return;
        }

        definition = adapted.graph;
        definitionWorkflowId = loadResult.definition.id;
        definitionWorkflowVersion = loadResult.definition.version;
      } else {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_workflow_run_payload" }));
        return;
      }

      const safeInitialState =
        initialState && typeof initialState === "object" && !Array.isArray(initialState)
          ? (initialState as Record<string, unknown>)
          : {};

      const run = workflowCheckpointStore.createRun({
        definitionId: definitionWorkflowId || definition.id,
        initialState: safeInitialState,
      });
      workflowRunDefinitions.set(run.id, definition);
      workflowRunMeta.set(run.id, { workflowId: definitionWorkflowId || definition.id, workflowVersion: definitionWorkflowVersion });

      const executor = createWorkflowExecutorForDefinition(definition);
      const result = await executor.run({ runId: run.id, definition });
      const runSummary = toWorkflowRunSummary(run.id);

      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          run: runSummary ?? workflowCheckpointStore.getRun(run.id) ?? run,
          result,
          checkpoints: workflowCheckpointStore.listCheckpoints(run.id),
        }),
      );
      return;
    }

    const workflowRunMatch = request.url.match(/^\/api\/workflow-runs\/([^/]+)$/);
    if (workflowRunMatch && request.method === "GET") {
      const runId = decodeURIComponent(workflowRunMatch[1]);
      const run = toWorkflowRunSummary(runId);
      if (!run) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_run_not_found" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          run,
          checkpoints: workflowCheckpointStore.listCheckpoints(runId),
        }),
      );
      return;
    }

    const workflowRunResumeMatch = request.url.match(/^\/api\/workflow-runs\/([^/]+)\/resume$/);
    if (workflowRunResumeMatch && request.method === "POST") {
      const runId = decodeURIComponent(workflowRunResumeMatch[1]);
      const run = workflowCheckpointStore.getRun(runId);
      if (!run) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_run_not_found" }));
        return;
      }

      const definition = workflowRunDefinitions.get(runId);
      if (!definition) {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_run_definition_missing" }));
        return;
      }

      const payload = await readJsonBody(request);
      const explicitInput = payload.input;
      const input =
        explicitInput && typeof explicitInput === "object" && !Array.isArray(explicitInput)
          ? (explicitInput as Record<string, unknown>)
          : payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : {};

      const executor = createWorkflowExecutorForDefinition(definition);
      const result = await executor.resume({ runId, definition, input });
      const runSummary = toWorkflowRunSummary(runId);

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          run: runSummary ?? run,
          result,
          checkpoints: workflowCheckpointStore.listCheckpoints(runId),
        }),
      );
      return;
    }

    if (request.method === "GET" && request.url === "/api/workflows") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: workflows }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/workflows") {
      const payload = await readJsonBody(request);
      const workflowDefinition = createDraftWorkflowDefinition(payload);
      if (!workflowDefinition) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_workflow_payload" }));
        return;
      }

      const validationResult = validateWorkflowDefinition(workflowDefinition);
      if (!validationResult.valid) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_workflow_payload", detail: validationResult.error }));
        return;
      }

      await saveWorkflowDefinition({
        definition: workflowDefinition,
        roots: workflowLibraryRoots,
        layout: runtimeLayout,
      });
      const workflowSummary = buildWorkflowSummaryFromDefinition(workflowDefinition);
      workflows = [workflowSummary, ...workflows];
      console.info("[workflow-api] 已创建工作流 definition 并更新摘要索引。", {
        workflowId: workflowDefinition.id,
      });
      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ workflow: workflowDefinition, items: workflows }));
      return;
    }

    const workflowMatch = request.url.match(/^\/api\/workflows\/([^/]+)$/);
    if (workflowMatch && request.method === "GET") {
      const workflowSummary = workflows.find((item) => item.id === decodeURIComponent(workflowMatch[1]));
      if (!workflowSummary) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_not_found" }));
        return;
      }
      const workflowDefinitionResult = await readWorkflowDefinitionStrict(workflowSummary);
      if (!workflowDefinitionResult.ok) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: "workflow_definition_load_failed",
            detail: workflowDefinitionResult.detail,
          }),
        );
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ workflow: workflowDefinitionResult.definition }));
      return;
    }

    if (workflowMatch && request.method === "PATCH") {
      const workflowId = decodeURIComponent(workflowMatch[1]);
      const index = workflows.findIndex((item) => item.id === workflowId);
      if (index < 0) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "workflow_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const existingWorkflowDefinitionResult = await readWorkflowDefinitionStrict(workflows[index]);
      if (!existingWorkflowDefinitionResult.ok) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: "workflow_definition_load_failed",
            detail: existingWorkflowDefinitionResult.detail,
          }),
        );
        return;
      }
      const existingWorkflowDefinition = existingWorkflowDefinitionResult.definition;
      const updatedWorkflowDefinition = applyWorkflowDefinitionPatch(existingWorkflowDefinition, payload);
      if (!updatedWorkflowDefinition) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_workflow_payload" }));
        return;
      }

      const validationResult = validateWorkflowDefinition(updatedWorkflowDefinition);
      if (!validationResult.valid) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_workflow_payload", detail: validationResult.error }));
        return;
      }

      await saveWorkflowDefinition({
        definition: updatedWorkflowDefinition,
        roots: workflowLibraryRoots,
        layout: runtimeLayout,
      });
      const updatedWorkflowSummary = buildWorkflowSummaryFromDefinition(updatedWorkflowDefinition);
      workflows = workflows.map((item, itemIndex) => (itemIndex === index ? updatedWorkflowSummary : item));
      console.info("[workflow-api] 已更新工作流 definition，并重建摘要索引。", {
        workflowId,
        version: updatedWorkflowDefinition.version,
      });
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ workflow: updatedWorkflowDefinition }));
      return;
    }

    if (request.method === "GET" && request.url === "/api/pending-work") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: pendingWorkItems }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/pending-work/heartbeat") {
      const payload = await readJsonBody(request);
      const now =
        payload.now === undefined
          ? new Date().toISOString()
          : typeof payload.now === "string" && payload.now.trim()
            ? payload.now.trim()
            : "";
      if (!now) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_heartbeat_payload" }));
        return;
      }

      const heartbeatResult = runHeartbeat({
        items: pendingWorkItems,
        now,
      });
      pendingWorkItems = heartbeatResult.items;
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(heartbeatResult));
      return;
    }

    if (request.method === "GET" && request.url === "/api/mcp/servers") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ servers: mcpService.listServers() }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/mcp/import") {
      const payload = await readJsonBody(request);
      if (!isMcpImportSource(payload.source)) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_mcp_import_source" }));
        return;
      }

      const servers = await mcpService.importServers(payload.source);
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ servers }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/mcp/servers") {
      const payload = await readJsonBody(request);
      const config = createMcpServerConfigFromPayload(payload, undefined);
      if (!config) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_mcp_server_config" }));
        return;
      }

      const server = await mcpService.saveServer(config);
      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ server, servers: mcpService.listServers() }));
      return;
    }

    const mcpServerMatch = request.url.match(/^\/api\/mcp\/servers\/([^/]+)$/);
    if (mcpServerMatch && request.method === "PUT") {
      const serverId = decodeURIComponent(mcpServerMatch[1]);
      const exists = mcpService.listServers().some((item) => item.id === serverId);
      if (!exists) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "mcp_server_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const config = createMcpServerConfigFromPayload(payload, serverId);
      if (!config) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_mcp_server_config" }));
        return;
      }

      const server = await mcpService.saveServer(config);
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ server, servers: mcpService.listServers() }));
      return;
    }

    if (mcpServerMatch && request.method === "DELETE") {
      const serverId = decodeURIComponent(mcpServerMatch[1]);
      const deleted = mcpService.deleteServer(serverId);
      if (!deleted) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "mcp_server_not_found" }));
        return;
      }

      await persistState();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ deletedServerId: serverId, servers: mcpService.listServers() }));
      return;
    }

    const mcpRefreshMatch = request.url.match(/^\/api\/mcp\/servers\/([^/]+)\/refresh$/);
    if (mcpRefreshMatch && request.method === "POST") {
      const serverId = decodeURIComponent(mcpRefreshMatch[1]);
      const exists = mcpService.listServers().some((item) => item.id === serverId);
      if (!exists) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "mcp_server_not_found" }));
        return;
      }

      const server = await mcpService.refreshServer(serverId);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ server, servers: mcpService.listServers() }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/model-profiles") {
      const payload = await readJsonBody(request);
      const required = ["name", "provider", "baseUrl", "apiKey", "model"] as const;
      const missingField = required.find((field) => typeof payload[field] !== "string" || !String(payload[field]).trim());
      const headers = readStringMap(payload.headers);
      const requestBody = readJsonRecord(payload.requestBody);

      if (missingField || headers === null || requestBody === null) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: missingField
              ? `${missingField}_required`
              : headers === null
                ? "invalid_profile_headers"
                : "invalid_profile_request_body",
          }),
        );
        return;
      }

      const profile: ModelProfile = {
        id: `model-${crypto.randomUUID()}`,
        name: String(payload.name).trim(),
        provider: isProviderKind(payload.provider) ? payload.provider : "openai-compatible",
        baseUrl: String(payload.baseUrl).trim(),
        apiKey: String(payload.apiKey),
        model: String(payload.model).trim(),
      };
      if (isBaseUrlMode(payload.baseUrlMode)) {
        profile.baseUrlMode = payload.baseUrlMode;
      }
      if (headers && Object.keys(headers).length > 0) {
        profile.headers = headers;
      }
      if (requestBody && Object.keys(requestBody).length > 0) {
        profile.requestBody = requestBody;
      }

      models.push(profile);
      await persistState();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ profile }));
      return;
    }

    const modelProfileMatch = request.url.match(/^\/api\/model-profiles\/([^/]+)$/);
    if (modelProfileMatch && request.method === "PUT") {
      const profileId = decodeURIComponent(modelProfileMatch[1]);
      const profileIndex = models.findIndex((item) => item.id === profileId);
      if (profileIndex < 0) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "profile_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const required = ["name", "provider", "baseUrl", "apiKey", "model"] as const;
      const missingField = required.find((field) => typeof payload[field] !== "string" || !String(payload[field]).trim());
      const headers = readStringMap(payload.headers);
      const requestBody = readJsonRecord(payload.requestBody);

      if (missingField || headers === null || requestBody === null) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: missingField
              ? `${missingField}_required`
              : headers === null
                ? "invalid_profile_headers"
                : "invalid_profile_request_body",
          }),
        );
        return;
      }

      const current = models[profileIndex];
      const profile: ModelProfile = {
        ...current,
        name: String(payload.name).trim(),
        provider: isProviderKind(payload.provider) ? payload.provider : current.provider,
        baseUrl: String(payload.baseUrl).trim(),
        apiKey: String(payload.apiKey),
        model: String(payload.model).trim(),
      };
      if (isBaseUrlMode(payload.baseUrlMode)) {
        profile.baseUrlMode = payload.baseUrlMode;
      } else {
        delete profile.baseUrlMode;
      }
      if (headers && Object.keys(headers).length > 0) {
        profile.headers = headers;
      } else {
        delete profile.headers;
      }
      if (requestBody && Object.keys(requestBody).length > 0) {
        profile.requestBody = requestBody;
      } else {
        delete profile.requestBody;
      }
      models[profileIndex] = profile;
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ profile }));
      return;
    }

    if (modelProfileMatch && request.method === "DELETE") {
      const profileId = decodeURIComponent(modelProfileMatch[1]);
      const profileIndex = models.findIndex((item) => item.id === profileId);
      if (profileIndex < 0) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "profile_not_found" }));
        return;
      }

      const [deletedProfile] = models.splice(profileIndex, 1);
      if (models.length === 0) {
        models.push(...createDefaultProfiles());
      }

      if (defaultModelProfileId === deletedProfile.id || !models.some((item) => item.id === defaultModelProfileId)) {
        defaultModelProfileId = createDefaultModelProfileId(models);
      }

      if (defaultModelProfileId) {
        const fallbackModelProfileId = defaultModelProfileId;
        sessions.sessions.forEach((session) => {
          if (session.modelProfileId === deletedProfile.id) {
            session.modelProfileId = fallbackModelProfileId;
          }
        });
      }

      await persistState();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          deletedProfileId: deletedProfile.id,
          defaultModelProfileId,
          models,
          sessions: sessions.sessions,
        }),
      );
      return;
    }

    if (request.method === "POST" && request.url === "/api/model-profiles/catalog") {
      const payload = await readJsonBody(request);
      const baseUrl = typeof payload.baseUrl === "string" ? String(payload.baseUrl).trim() : "";
      const apiKey = typeof payload.apiKey === "string" ? String(payload.apiKey) : "";
      const headers = readStringMap(payload.headers);
      const requestBody = readJsonRecord(payload.requestBody);

      if (!baseUrl) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "baseUrl_required" }));
        return;
      }

      if (!apiKey.trim()) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "apiKey_required" }));
        return;
      }

      if (!isProviderKind(payload.provider) || headers === null || requestBody === null) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: !isProviderKind(payload.provider)
              ? "provider_required"
              : headers === null
                ? "invalid_profile_headers"
                : "invalid_profile_request_body",
          }),
        );
        return;
      }

      const profile: ModelProfile = {
        id: "model-catalog-preview",
        name: "模型目录预览",
        provider: payload.provider,
        baseUrl,
        apiKey,
        model: typeof payload.model === "string" ? payload.model.trim() : "",
      };
      if (isBaseUrlMode(payload.baseUrlMode)) {
        profile.baseUrlMode = payload.baseUrlMode;
      }
      if (headers && Object.keys(headers).length > 0) {
        profile.headers = headers;
      }
      if (requestBody && Object.keys(requestBody).length > 0) {
        profile.requestBody = requestBody;
      }

      console.info("[runtime] 开始拉取模型目录", {
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        baseUrlMode: profile.baseUrlMode ?? "manual",
      });

      try {
        const result = await profileModelCatalog({ profile });
        console.info("[runtime] 模型目录拉取完成", {
          provider: profile.provider,
          count: result.modelIds.length,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ modelIds: result.modelIds }));
      } catch (error) {
        console.warn("[runtime] 模型目录拉取失败", {
          provider: profile.provider,
          detail: error instanceof Error ? error.message : "Unknown catalog failure",
        });
        response.writeHead(502, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: "model_catalog_failed",
            detail: error instanceof Error ? error.message : "Unknown catalog failure",
          }),
        );
      }

      return;
    }

    if (request.method === "POST" && request.url === "/api/model-profiles/default") {
      const payload = await readJsonBody(request);
      const profileId = typeof payload.profileId === "string" ? payload.profileId : "";
      const exists = models.some((profile) => profile.id === profileId);

      if (!exists) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "profile_not_found" }));
        return;
      }

      defaultModelProfileId = profileId;
      await persistState();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ defaultModelProfileId }));
      return;
    }

    const profileConnectivityMatch = request.url.match(/^\/api\/model-profiles\/([^/]+)\/test$/);
    if (request.method === "POST" && profileConnectivityMatch) {
      const profileId = decodeURIComponent(profileConnectivityMatch[1]);
      const profile = models.find((item) => item.id === profileId);

      if (!profile) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "profile_not_found" }));
        return;
      }

      try {
        const result = await profileConnectivityCheck({ profile });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            latencyMs: Math.max(0, Math.round(result.latencyMs)),
          }),
        );
      } catch (error) {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: false,
            error: "model_connectivity_failed",
            detail: error instanceof Error ? error.message : "Unknown connectivity failure",
          }),
        );
      }

      return;
    }

    if (request.method === "POST" && request.url === "/api/approvals/policy") {
      const payload = await readJsonBody(request);
      const mode = payload.mode;
      const autoApproveReadOnly = payload.autoApproveReadOnly;
      const autoApproveSkills = payload.autoApproveSkills;

      if (
        !isApprovalMode(mode) ||
        typeof autoApproveReadOnly !== "boolean" ||
        typeof autoApproveSkills !== "boolean"
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_approval_policy" }));
        return;
      }

      approvals = {
        ...approvals,
        mode,
        autoApproveReadOnly,
        autoApproveSkills,
      };
      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ approvals }));
      return;
    }

    if (request.method === "GET" && request.url === "/api/tools/builtin") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: buildResolvedBuiltinTools() }));
      return;
    }

    if (request.method === "GET" && request.url === "/api/tools/mcp") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: buildResolvedMcpTools() }));
      return;
    }

    const builtinToolMatch = request.url.match(/^\/api\/tools\/builtin\/([^/]+)$/);
    if (request.method === "PUT" && builtinToolMatch) {
      const toolId = decodeURIComponent(builtinToolMatch[1]);
      const definition = getBuiltinToolDefinition(toolId);
      if (!definition) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "builtin_tool_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const enabled = payload.enabled;
      const exposedToModel = payload.exposedToModel;
      const approvalModeOverride = payload.approvalModeOverride;

      if (
        typeof enabled !== "boolean" ||
        typeof exposedToModel !== "boolean" ||
        !(approvalModeOverride === null || isBuiltinToolApprovalMode(approvalModeOverride))
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_builtin_tool_preference" }));
        return;
      }

      const nextPreference: BuiltinToolPreference = {
        toolId,
        enabled,
        exposedToModel: enabled ? exposedToModel : false,
        approvalModeOverride,
        updatedAt: new Date().toISOString(),
      };
      const existingIndex = builtinToolPreferences.findIndex((item) => item.toolId === toolId);

      if (existingIndex >= 0) {
        builtinToolPreferences = builtinToolPreferences.map((item, index) =>
          index === existingIndex ? nextPreference : item,
        );
      } else {
        builtinToolPreferences = [...builtinToolPreferences, nextPreference];
      }

      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          tool: buildResolvedBuiltinTools().find((item) => item.id === toolId),
        }),
      );
      return;
    }

    const mcpToolMatch = request.url.match(/^\/api\/tools\/mcp\/([^/]+)$/);
    if (request.method === "PUT" && mcpToolMatch) {
      const toolId = decodeURIComponent(mcpToolMatch[1]);
      const tool = mcpService.listTools().find((item) => item.id === toolId);
      if (!tool) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "mcp_tool_not_found" }));
        return;
      }

      const payload = await readJsonBody(request);
      const enabled = payload.enabled;
      const exposedToModel = payload.exposedToModel;
      const approvalModeOverride = payload.approvalModeOverride;

      if (
        typeof enabled !== "boolean" ||
        typeof exposedToModel !== "boolean" ||
        !(approvalModeOverride === null || isBuiltinToolApprovalMode(approvalModeOverride))
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_mcp_tool_preference" }));
        return;
      }

      const nextPreference: McpToolPreference = {
        toolId,
        serverId: tool.serverId,
        enabled,
        exposedToModel: enabled ? exposedToModel : false,
        approvalModeOverride,
        updatedAt: new Date().toISOString(),
      };
      const existingIndex = mcpToolPreferences.findIndex((item) => item.toolId === toolId);

      if (existingIndex >= 0) {
        mcpToolPreferences = mcpToolPreferences.map((item, index) =>
          index === existingIndex ? nextPreference : item,
        );
      } else {
        mcpToolPreferences = [...mcpToolPreferences, nextPreference];
      }

      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          tool: buildResolvedMcpTools().find((item) => item.id === toolId),
        }),
      );
      return;
    }

    const executionIntentMatch = request.url.match(/^\/api\/sessions\/([^/]+)\/execution-intents$/);
    if (request.method === "POST" && executionIntentMatch) {
      const payload = await readJsonBody(request);
      const session = sessions.sessions.find((item) => item.id === executionIntentMatch[1]);

      if (!session) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "session_not_found" }));
        return;
      }

      const source = payload.source;
      const toolId = typeof payload.toolId === "string" ? payload.toolId.trim() : "";
      const label = typeof payload.label === "string" ? payload.label.trim() : "";
      const risk = payload.risk;
      const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
      const serverId = typeof payload.serverId === "string" ? payload.serverId.trim() : "";
      const toolName = typeof payload.toolName === "string" ? payload.toolName.trim() : "";
      const structuredArguments = readJsonRecord(payload.arguments);

      if (
        !isApprovalRequestSource(source) ||
        !toolId ||
        !label ||
        !isToolRiskCategory(risk) ||
        !detail ||
        structuredArguments === null ||
        (source === "mcp-tool" && (!serverId || !toolName))
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_execution_intent" }));
        return;
      }

      const intent: ExecutionIntent = {
        source,
        toolId,
        label,
        risk,
        detail,
        ...(source === "mcp-tool"
          ? {
              serverId,
              toolName,
              arguments: structuredArguments ?? {},
            }
          : {}),
      };

      const result = createExecutionIntentResult({
        sessionId: session.id,
        policy: approvals,
        intent,
      });

      const updatedSession = session;
      if (result.status === "auto-approved") {
        appendSystemMessage(sessions.sessions, session.id, result.message);
        await executeIntentAndAppend(session.id, intent);
      }

      if (result.approvalRequest) {
        approvalRequests = [...approvalRequests, result.approvalRequest];
      }

      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ session: updatedSession, approvals, approvalRequests, result }));
      return;
    }

    const approvalResolveMatch = request.url.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
    if (request.method === "POST" && approvalResolveMatch) {
      const payload = await readJsonBody(request);
      const decision = payload.decision;

      if (!isApprovalDecision(decision)) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "decision_required" }));
        return;
      }

      const approvalIndex = approvalRequests.findIndex((item) => item.id === approvalResolveMatch[1]);
      if (approvalIndex < 0) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "approval_not_found" }));
        return;
      }

      const [approval] = approvalRequests.splice(approvalIndex, 1);

      if (decision === "always-allow-tool" && !approvals.alwaysAllowedTools.includes(approval.toolId)) {
        approvals = {
          ...approvals,
          alwaysAllowedTools: [...approvals.alwaysAllowedTools, approval.toolId],
        };
      }

      let session = appendSystemMessage(
        sessions.sessions,
        approval.sessionId,
        createApprovalResultMessage(decision, approval),
      );

      if (!session) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "session_not_found" }));
        return;
      }

      if (decision !== "deny" && isExecutableApproval(approval)) {
        session =
          (await executeIntentAndAppend(approval.sessionId, {
            source: approval.source,
            toolId: approval.toolId,
            label: approval.label,
            risk: approval.risk,
            detail: approval.detail,
            serverId: approval.serverId,
            toolName: approval.toolName,
            arguments: approval.arguments,
          })) ?? session;
      }

      if (approval.resumeConversation) {
        session = (await continueModelConversation(approval.sessionId)) ?? session;
      }

      await persistState();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ session, approvals, approvalRequests }));
      return;
    }

        return false;
      },
    }),
  );

  await new Promise<void>((resolve) => {
    server.listen(options.port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve runtime address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            const closeError = error as NodeJS.ErrnoException;
            if (closeError.code === "ERR_SERVER_NOT_RUNNING" || closeError.message === "Server is not running.") {
              resolve();
              return;
            }
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}
