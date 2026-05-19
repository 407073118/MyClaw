import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUp, BellRing, Boxes, FolderKanban, PanelRightClose, PanelRightOpen, Plug, Square, Wrench, X } from "lucide-react";
import { marked } from "marked";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWorkspaceStore, bufferStreamingDelta, getCachedMarkdown, flushStreamingBufferNow } from "../stores/workspace";
import { useShallow } from "zustand/react/shallow";
type ChatReminderBannerPayload = {
  id?: string;
  title: string;
  body?: string;
  deliveredAt: string;
};
import { PlanStatePanel } from "../components/plan-state-panel";
import { PlanSidePanel } from "../components/PlanSidePanel";
import WorkFilesPanel from "../components/WorkFilesPanel";
import InlineFileReferenceContent from "../components/InlineFileReferenceContent";
import { GlassSelect } from "../components/ui/GlassSelect";
import { useDialogA11y } from "../hooks/useDialogA11y";
import type {
  A2UiForm,
  A2UiPayload,
  A2UiFormField,
  ApprovalDecision,
  ApprovalRequest,
  AgentTask,
  ArtifactScopeRef,
  ChatMessage,
  ChatRunPhase,
  ChatRunRuntimeStatusPayload,
  ChatRunStatus,
  ChatSession,
  ProjectCapabilityDetail,
  ProjectCapabilityPref,
  ProjectCapabilityRef,
  ResolvedMcpTool,
  SkillDefinition,
  TaskResumeInput,
  ExecutionIntent,
  McpServer,
} from "@shared/contracts";
import { ToolRiskCategory, resolveSiliconPersonCurrentSessionId } from "@shared/contracts";
import { formatMessageTime, formatFullTime, formatDateSeparator, isDifferentDay } from "../utils/format-time";

const AGENT_TASK_STATUS_LABEL: Record<AgentTask["status"], string> = {
  queued: "排队中",
  running: "执行中",
  waiting_user: "待处理",
  succeeded: "已完成",
  failed: "异常",
  cancelled: "已取消",
};

const TASK_PANEL_DISMISS_PREFIX = "myclaw:task-panel-dismissed:";
const AGENT_TASK_CARD_DISMISS_PREFIX = "myclaw:agent-task-card-dismissed:";

const APPROVAL_SOURCE_LABELS: Record<string, string> = {
  "builtin-tool": "内置工具",
  "mcp-tool": "MCP 工具",
  skill: "技能",
  "shell-command": "Shell 命令",
  "network-request": "网络请求",
};

const APPROVAL_RISK_LABELS: Record<string, string> = {
  [ToolRiskCategory.Read]: "只读",
  [ToolRiskCategory.Write]: "写入",
  [ToolRiskCategory.Exec]: "执行",
  [ToolRiskCategory.Install]: "安装",
  [ToolRiskCategory.Network]: "联网",
};

type ApprovalCardViewModel = {
  sourceLabel: string;
  riskLabel: string;
  targetLabel: string;
  targetText: string;
  detailTitle: string;
  detailText: string;
};

// 配置 `marked`，统一启用 GFM 和换行转 `<br>`。
marked.setOptions({ gfm: true, breaks: true });

/** 把 Markdown 文本渲染成 HTML，失败时回退原文本。 */
function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    return marked.parse(content) as string;
  } catch {
    return content;
  }
}

/** 快速 HTML 转义，用于流式消息的轻量渲染（跳过 marked.parse 开销）。 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

/** 生成任务面板关闭状态的任务签名，新任务加入时签名变化会重新展示面板。 */
function buildTaskPanelSignature(
  tasks: ChatSession["tasks"] | undefined,
  interrupts: ChatSession["taskInterrupts"] | undefined,
): string {
  const taskPart = (tasks ?? [])
    .map((task) => `${task.id}:${task.status}:${String(task.metadata?.interruptRequestId ?? "")}`)
    .join("|");
  const interruptPart = (interrupts ?? [])
    .filter((request) => request.status === "active")
    .map((request) => `${request.requestId}:${request.taskId}:${request.status}`)
    .join("|");
  return [taskPart, interruptPart].filter(Boolean).join("::");
}

/** 生成任务面板关闭状态的会话级缓存键。 */
function buildTaskPanelDismissKey(sessionId: string | undefined, signature: string): string | null {
  if (!sessionId || !signature) return null;
  return `${TASK_PANEL_DISMISS_PREFIX}${sessionId}:${signature}`;
}

/** 生成 AgentTask 轻提示关闭状态的本地缓存键。 */
function buildAgentTaskCardDismissKey(task: AgentTask): string {
  return `${AGENT_TASK_CARD_DISMISS_PREFIX}${task.sourceSessionId}:${task.id}`;
}

/** 读取任务面板关闭状态，避免切换页面回来后重复弹出。 */
function readTaskPanelDismissed(key: string | null): boolean {
  if (!key || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** 读取 AgentTask 轻提示是否已被用户本地关闭。 */
function readAgentTaskCardDismissed(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** 保存任务面板关闭状态，只影响当前浏览器会话。 */
function writeTaskPanelDismissed(key: string | null): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // 忽略无痕模式或存储不可用场景，组件内状态仍会立即生效。
  }
}

/** 保存 AgentTask 轻提示关闭状态，只隐藏当前客户端里的提示，不取消任务。 */
function writeAgentTaskCardDismissed(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // 存储不可用时仍依赖组件内状态立即隐藏。
  }
}

/** 把审批参数转成稳定文本，避免渲染层直接展示对象时变成不可读内容。 */
function stringifyApprovalValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 尝试从 JSON 文本里读取字段，解析失败时返回空对象给展示层继续降级。 */
function parseApprovalJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** 将 fs.write 的旧 label 契约拆成文件目标与写入内容预览。 */
function splitFsWriteLabel(label: string): { targetText: string; detailText: string } {
  const match = label.match(/^([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { targetText: label.trim(), detailText: "" };
  return {
    targetText: match[1]?.trim() ?? "",
    detailText: match[2]?.trim() ?? "",
  };
}

/** 为审批卡片生成展示模型，确保工具身份优先于长参数展示。 */
function buildApprovalCardViewModel(approval: ApprovalRequest): ApprovalCardViewModel {
  const labelText = stringifyApprovalValue(approval.label).trim();
  const detailText = stringifyApprovalValue(approval.detail).trim();
  const viewModel: ApprovalCardViewModel = {
    sourceLabel: APPROVAL_SOURCE_LABELS[approval.source] ?? approval.source,
    riskLabel: APPROVAL_RISK_LABELS[approval.risk] ?? approval.risk,
    targetLabel: "操作",
    targetText: "",
    detailTitle: "参数预览",
    detailText,
  };

  if (approval.toolId === "fs.write") {
    const split = splitFsWriteLabel(labelText);
    viewModel.targetLabel = "目标";
    viewModel.targetText = split.targetText;
    viewModel.detailTitle = "写入内容预览";
    viewModel.detailText = split.detailText || detailText;
    return viewModel;
  }

  if (approval.toolId === "fs.edit") {
    const parsed = parseApprovalJsonObject(labelText);
    viewModel.targetLabel = "目标";
    viewModel.targetText = stringifyApprovalValue(parsed.path).trim();
    viewModel.detailTitle = "修改内容预览";
    viewModel.detailText = JSON.stringify({
      old_string: parsed.old_string ?? "",
      new_string: parsed.new_string ?? "",
    }, null, 2);
    return viewModel;
  }

  if (approval.toolId === "exec.command") {
    const parsed = parseApprovalJsonObject(labelText);
    viewModel.targetLabel = "命令";
    viewModel.targetText = stringifyApprovalValue(parsed.command ?? labelText).trim();
    viewModel.detailText = detailText || labelText;
    return viewModel;
  }

  if (approval.toolId.startsWith("fs.") || approval.toolId === "artifact.register") {
    viewModel.targetLabel = "目标";
    viewModel.targetText = labelText;
    return viewModel;
  }

  if (approval.toolName && approval.toolName !== approval.toolId) {
    viewModel.targetLabel = "调用";
    viewModel.targetText = approval.toolName;
  } else if (labelText && labelText !== approval.toolId) {
    viewModel.targetText = labelText;
  }

  return viewModel;
}

// ─── ToolLogContent 内联组件辅助类型 ─────────────────────────────────────────

interface DirectoryEntry {
  kind: string;
  name: string;
  size?: number;
  modifiedAt: string;
}
interface DirectoryTree {
  root: string;
  entries: DirectoryEntry[];
}

/** 解析 PowerShell 目录树输出，便于在工具日志中结构化展示。 */
function parsePowerShellDirectoryTree(content: string): DirectoryTree | null {
  // 这里保持最小解析逻辑，优先满足目录树预览场景。
  try {
    const lines = content.split(/\r?\n/);
    if (lines.length < 2) return null;
    const rootLine = lines[0].trim();
    if (!rootLine.startsWith("Directory:")) return null;
    const root = rootLine.replace("Directory:", "").trim();
    const entries: DirectoryEntry[] = lines.slice(3).filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s{2,}/);
      return { kind: parts[0] ?? "", name: parts[parts.length - 1] ?? "", modifiedAt: parts[1] ?? "" };
    });
    return { root, entries };
  } catch {
    return null;
  }
}

/** 优先以目录树样式渲染工具日志，否则退回普通文本。 */
function ToolLogContent({ content, messageId }: { content: string; messageId: string }) {
  const directoryTree = useMemo(() => parsePowerShellDirectoryTree(content), [content]);

  if (directoryTree) {
    return (
      <article data-testid={`tool-directory-tree-${messageId}`} className="tool-directory-tree">
        <header className="tool-directory-root">
          <strong>{directoryTree.root}</strong>
          <span>{directoryTree.entries.length} items</span>
        </header>
        <ul className="tool-directory-entries">
          {directoryTree.entries.map((entry, idx) => (
            <li key={`${entry.kind}-${entry.name}-${idx}`} className="tool-directory-entry">
              <span className="tool-directory-kind">{entry.kind}</span>
              <span className="tool-directory-name">{entry.name}</span>
              {entry.size != null && <span className="tool-directory-meta">{entry.size} B</span>}
              <span className="tool-directory-meta">{entry.modifiedAt}</span>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  return <span className="tool-log-text">{content}</span>;
}

// ─── 辅助方法 ─────────────────────────────────────────────────────────────────

/** 安全提取消息正文文本，兼容字符串和多模态数组两种结构。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  return String(content ?? "");
}

/** 将消息角色映射为更适合中文界面的标签。 */
function roleLabel(role: string) {
  return ({ user: "用户", assistant: "助手", system: "系统", tool: "工具" } as Record<string, string>)[role] ?? role;
}

const EXECUTION_CHAIN_BADGES: Record<string, string> = {
  MODEL: "模型",
  TOOL_CALL: "调用",
  SKILL: "技能",
  STATUS: "状态",
  RESULT: "结果",
};

/** 解析执行链前缀标签，拆出标记和详细内容。 */
function parseExecutionChainContent(content: string): { tag: string | null; detail: string } {
  const trimmed = content.trim();
  const matched = trimmed.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  if (!matched) return { tag: null, detail: trimmed };
  return { tag: matched[1] ?? null, detail: (matched[2] ?? "").trim() };
}

/** 为执行链消息计算角标文案。 */
function executionChainBadge(message: ChatMessage) {
  if (message.role === "tool") return "输出";
  if (message.role === "assistant" && Array.isArray((message as any).tool_calls) && (message as any).tool_calls.length > 0) {
    return "调用";
  }
  const parsed = parseExecutionChainContent(textOf(message.content));
  if (!parsed.tag) return roleLabel(message.role);
  return EXECUTION_CHAIN_BADGES[parsed.tag] ?? parsed.tag;
}

/** 提取执行链摘要，便于在折叠列表中快速浏览。 */
function executionChainSummary(message: ChatMessage) {
  if (message.role === "tool") {
    const text = textOf(message.content);
    const preview = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    return preview ?? "查看工具输出";
  }
  if (message.role === "assistant" && Array.isArray((message as any).tool_calls)) {
    const calls = (message as any).tool_calls as Array<{ function: { name: string } }>;
    return calls.map((tc) => tc.function.name.replace(/_/g, ".")).join(", ");
  }
  const text = textOf(message.content);
  const parsed = parseExecutionChainContent(text);
  return parsed.detail || text;
}

/** 生成一组工具链消息的标题，优先使用工具调用名。 */
function toolChainTitle(items: ChatMessage[]): string {
  // 优先寻找包含 `tool_calls` 的助手消息。
  const assistantWithTools = items.find((m) =>
    m.role === "assistant" && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0
  );
  if (assistantWithTools) {
    const calls = (assistantWithTools as any).tool_calls as Array<{ function: { name: string } }>;
    const names = calls.map((tc) => tc.function.name.replace(/_/g, ".")).join(", ");
    return names.length > 60 ? names.slice(0, 57) + "..." : names;
  }

  // 否则回退到带“调用”字样的系统消息。
  const firstCall = items.find((m) => m.role === "system" && textOf(m.content).includes("调用"));
  if (firstCall) {
    const parsed = parseExecutionChainContent(textOf(firstCall.content));
    if (parsed.detail) {
      return parsed.detail.length > 60 ? parsed.detail.slice(0, 57) + "..." : parsed.detail;
    }
  }
  return "工具调用";
}

/** 美化工具参数 JSON，方便在日志面板中阅读。 */
function formatToolArgs(argsJson: string): string {
  try {
    const parsed = JSON.parse(argsJson);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return argsJson;
  }
}

/** 格式化模型 token 与缓存用量，便于在消息徽标中快速判断缓存是否命中。 */
function formatTokenUsageBadge(usage: NonNullable<ChatMessage["usage"]>): { label: string; title: string } {
  const cacheHitTokens = readCacheHitInputTokens(usage);
  const parts = [
    `输入 ${usage.promptTokens}`,
    `输出 ${usage.completionTokens}`,
    `总计 ${usage.totalTokens} tokens`,
    cacheHitTokens !== undefined ? `命中 ${cacheHitTokens}` : null,
    usage.cacheMissInputTokens !== undefined ? `未命中 ${usage.cacheMissInputTokens}` : null,
    usage.cacheWriteInputTokens !== undefined ? `写入 ${usage.cacheWriteInputTokens}` : null,
  ].filter((value): value is string => !!value);
  const title = [
    `输入: ${usage.promptTokens}`,
    `输出: ${usage.completionTokens}`,
    usage.reasoningTokens !== undefined ? `推理: ${usage.reasoningTokens}` : null,
    cacheHitTokens !== undefined ? `缓存命中: ${cacheHitTokens}` : null,
    usage.cacheMissInputTokens !== undefined ? `缓存未命中: ${usage.cacheMissInputTokens}` : null,
    usage.cacheWriteInputTokens !== undefined ? `缓存写入: ${usage.cacheWriteInputTokens}` : null,
    usage.cacheEfficiency !== undefined ? `命中率: ${(usage.cacheEfficiency * 100).toFixed(1)}%` : null,
  ].filter((value): value is string => !!value).join(" | ");
  return { label: parts.join(" · "), title };
}

/** 统一读取各厂商的缓存命中 token，避免 UI 和会话汇总漏掉 cache_read/cached 字段。 */
function readCacheHitInputTokens(usage: NonNullable<ChatMessage["usage"]>): number | undefined {
  return usage.cacheHitInputTokens ?? usage.cacheReadInputTokens ?? usage.cachedInputTokens;
}

/** 规范化 Slash 指令中的标识符，避免生成非法 toolId。 */
function normalizeIntentId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** 尝试把 MCP 参数解析成结构化对象，兼容读写类快捷输入。 */
function parseMcpArguments(toolName: string, rawArgs: string): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* 解析失败后继续走兜底分支 */ }
  const normalized = toolName.trim().toLowerCase();
  if (normalized.includes("write") && rawArgs.includes("::")) {
    const [path, ...rest] = rawArgs.split("::");
    return { path: path.trim(), content: rest.join("::") };
  }
  if (normalized.includes("read") || normalized.includes("list") || normalized.includes("find") || normalized.includes("search")) {
    return { path: rawArgs };
  }
  return { input: rawArgs };
}

/** 根据工具名称启发式推断 MCP 风险等级。 */
function inferMcpRisk(label: string): ToolRiskCategory {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("read") || normalized.includes("list") || normalized.includes("search") || normalized.includes("find") || normalized.includes("get")) {
    return ToolRiskCategory.Read;
  }
  return ToolRiskCategory.Write;
}

/** 解析 Slash 命令，生成统一的执行意图对象。 */
function parseExecutionIntentCommand(input: string): ExecutionIntent | null {
  if (!input.startsWith("/")) return null;
  const [command] = input.split(/\s+/, 1);
  const payload = input.slice(command.length).trim();
  if (!payload) return null;

  switch (command) {
    case "/skill":
      return { source: "skill", toolId: `skill.${normalizeIntentId(payload)}`, label: payload, risk: ToolRiskCategory.Exec, detail: `Skills 准备执行 ${payload}。` };
    case "/cmd":
      return { source: "shell-command", toolId: "shell.command", label: payload, risk: ToolRiskCategory.Exec, detail: `准备执行命令：${payload}` };
    case "/read":
      return { source: "mcp-tool", toolId: "fs.read_file", label: payload, risk: ToolRiskCategory.Read, detail: `准备读取文件：${payload}` };
    case "/network":
      return { source: "network-request", toolId: "network.request", label: payload, risk: ToolRiskCategory.Network, detail: `准备访问外部网络：${payload}` };
    case "/mcp": {
      const [serverId, toolName, ...rest] = payload.split(/\s+/);
      if (!serverId || !toolName) return null;
      const rawArgs = rest.join(" ").trim();
      const target = rawArgs || toolName;
      const argumentsPayload = parseMcpArguments(toolName, rawArgs);
      return { source: "mcp-tool", toolId: `${serverId}:${toolName}`, label: toolName, risk: inferMcpRisk(toolName), serverId, toolName, arguments: argumentsPayload, detail: `MCP 准备执行 ${toolName} ${target}`.trim() };
    }
    default:
      return null;
  }
}

/** 判断消息中的 A2UI 载荷是否适合以内联表单方式展示。 */
function shouldRenderInlineA2UiForm(payload: A2UiPayload | null | undefined): payload is A2UiForm {
  return payload?.kind === "form" && Array.isArray((payload as A2UiForm).fields) && (payload as A2UiForm).fields.length >= 1;
}

type CapabilityPanelItem = {
  id: string;
  label: string;
  description: string;
  status: string;
};

/** 判断 unknown 是否是可读取字段的普通对象。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 在项目详情中查找能力偏好。 */
function findProjectPref(detail: ProjectCapabilityDetail | null, refId: string): ProjectCapabilityPref | null {
  return detail?.prefs.find((pref) => pref.capabilityRefId === refId) ?? null;
}

/** 读取项目 MCP 的本地确认策略。 */
function readProjectMcpPolicy(pref: ProjectCapabilityPref | null): { localConfirmed: boolean; secretsConfigured: boolean; allowExposeToModel: boolean } {
  const policy = isPlainRecord(pref?.localPolicyJson) ? pref.localPolicyJson : {};
  return {
    localConfirmed: policy.localConfirmed === true,
    secretsConfigured: policy.secretsConfigured === true,
    allowExposeToModel: policy.allowExposeToModel === true,
  };
}

/** 判断项目能力按本地偏好是否应被纳入可见运行能力。 */
function isProjectCapabilityEnabled(ref: ProjectCapabilityRef, pref: ProjectCapabilityPref | null): boolean {
  const state = pref?.localState ?? "inherit";
  if (state === "enabled") return true;
  if (state === "disabled" || state === "hidden") return false;
  return ref.defaultEnabled;
}

/** 读取项目能力安装状态，缺失记录视为未安装。 */
function readProjectInstallStatus(detail: ProjectCapabilityDetail | null, ref: ProjectCapabilityRef): string {
  if (ref.kind !== "skill") return "ready";
  return detail?.installations.find((item) => item.capabilityRefId === ref.id)?.installStatus ?? "missing";
}

/** 查找项目 Skill 的安装记录，用于判断 slash 是否可直接调用。 */
function findProjectInstallation(detail: ProjectCapabilityDetail | null, ref: ProjectCapabilityRef) {
  return detail?.installations.find((item) => item.capabilityRefId === ref.id) ?? null;
}

/** 判断项目 Skill 是否已同步、已安装且具备本地目录，可进入 slash 可调用列表。 */
function isProjectSkillCallable(detail: ProjectCapabilityDetail | null, ref: ProjectCapabilityRef): boolean {
  const pref = findProjectPref(detail, ref.id);
  const installation = findProjectInstallation(detail, ref);
  return ref.kind === "skill"
    && ref.syncStatus === "synced"
    && isProjectCapabilityEnabled(ref, pref)
    && installation?.installStatus === "ready"
    && Boolean(installation.installDir);
}

/** 计算项目 MCP 是否已经满足本机暴露条件。 */
function canExposeProjectMcp(ref: ProjectCapabilityRef, pref: ProjectCapabilityPref | null): boolean {
  const policy = readProjectMcpPolicy(pref);
  const runtimePolicy = isPlainRecord(ref.runtimePolicyJson) ? ref.runtimePolicyJson : {};
  return policy.localConfirmed
    && policy.secretsConfigured
    && policy.allowExposeToModel
    && runtimePolicy.allowAutoExposeToModel === true;
}

/** 统计当前项目能力中需要用户注意的项。 */
function countChatProjectWarnings(detail: ProjectCapabilityDetail | null): number {
  if (!detail) return 0;
  let count = detail.project.lastSyncStatus === "synced" ? 0 : 1;
  for (const ref of detail.refs) {
    if (ref.syncStatus !== "synced") count += 1;
    if (ref.kind === "skill" && readProjectInstallStatus(detail, ref) !== "ready") count += 1;
    if (ref.kind === "mcp" && !canExposeProjectMcp(ref, findProjectPref(detail, ref.id))) count += 1;
  }
  return count;
}

/** 把项目、我的 Skill 和全局 MCP 整理成 Chat 侧边可扫描分组。 */
function buildCapabilityPanelGroups(input: {
  detail: ProjectCapabilityDetail | null;
  skills: SkillDefinition[];
  mcpTools: ResolvedMcpTool[];
  mcpServers: McpServer[];
}): Array<{ id: string; title: string; icon: "boxes" | "wrench" | "plug"; items: CapabilityPanelItem[] }> {
  const projectSkills = (input.detail?.refs ?? [])
    .filter((ref) => ref.kind === "skill")
    .map((ref) => {
      const pref = findProjectPref(input.detail, ref.id);
      const enabled = isProjectCapabilityEnabled(ref, pref);
      const installStatus = readProjectInstallStatus(input.detail, ref);
      return {
        id: ref.id,
        label: ref.displayName,
        description: ref.description ?? ref.cloudCapabilityId,
        status: enabled && installStatus === "ready" ? "可用" : enabled ? "待安装" : "已停用",
      };
    });
  const userSkills = input.skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      id: skill.id,
      label: skill.name,
      description: skill.description || skill.id,
      status: "可用",
    }));
  const projectMcps = (input.detail?.refs ?? [])
    .filter((ref) => ref.kind === "mcp")
    .map((ref) => {
      const pref = findProjectPref(input.detail, ref.id);
      const enabled = isProjectCapabilityEnabled(ref, pref);
      return {
        id: ref.id,
        label: ref.displayName,
        description: ref.description ?? ref.cloudCapabilityId,
        status: enabled && canExposeProjectMcp(ref, pref) ? "可暴露" : enabled ? "待确认" : "已停用",
      };
    });
  const globalMcpItems = input.mcpTools.length > 0
    ? input.mcpTools.map((tool) => ({
      id: tool.id,
      label: tool.name,
      description: tool.description ?? tool.serverId ?? tool.id,
      status: tool.enabled ? "可用" : "已停用",
    }))
    : input.mcpServers.map((server) => ({
      id: server.id,
      label: server.name,
      description: server.transport,
      status: server.enabled ? "可用" : "已停用",
    }));
  return [
    { id: "project-skills", title: "项目 Skills", icon: "boxes", items: projectSkills },
    { id: "user-skills", title: "我的 Skills", icon: "wrench", items: userSkills },
    { id: "project-mcp", title: "项目 MCP", icon: "plug", items: projectMcps },
    { id: "global-mcp", title: "全局 MCP", icon: "plug", items: globalMcpItems },
  ];
}

type ComposerRunState = {
  sessionId: string;
  runId: string | null;
  status: "dispatching" | ChatRunStatus;
  phase: ChatRunPhase | null;
  messageId?: string;
  reason?: string | null;
};

const TERMINAL_RUN_STATUSES = new Set<ChatRunStatus>(["canceled", "completed", "failed"]);

/** 读取当前会话上已经持久化的运行态，供前端 stop 按钮与输入框复用。 */
function readSessionRunState(session: ChatSession | null | undefined): ComposerRunState | null {
  const runState = session?.chatRunState;
  if (!session || !runState) return null;
  if (runState.status !== "running" && runState.status !== "canceling") return null;
  return {
    sessionId: session.id,
    runId: runState.runId,
    status: runState.status,
    phase: runState.phase,
    messageId: runState.activeMessageId,
    reason: runState.lastReason ?? null,
  };
}

/** 兼容扁平事件与 payload 包裹事件，提取 runtime.status 的关键字段。 */
function readRuntimeStatus(event: Record<string, unknown>): ChatRunRuntimeStatusPayload | null {
  const payload = event.payload && typeof event.payload === "object"
    ? event.payload as Record<string, unknown>
    : event;
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  const status = typeof payload.status === "string" ? payload.status as ChatRunStatus : null;
  const phase = typeof payload.phase === "string" ? payload.phase as ChatRunPhase : null;
  if (!sessionId || !runId || !status || !phase) return null;
  return {
    sessionId,
    runId,
    status,
    phase,
    ...(typeof payload.messageId === "string" ? { messageId: payload.messageId } : {}),
    ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
  };
}

// ─── 主页面组件 ───────────────────────────────────────────────────────────────

/** 渲染聊天主界面，并负责消息流、审批和内联表单交互。 */
export default function ChatPage() {
  const workspace = useWorkspaceStore(useShallow((s) => ({
    // Data properties ChatPage actually reads
    sessions: s.sessions,
    currentSession: s.currentSession,
    siliconPersons: s.siliconPersons,
    activeSiliconPersonId: s.activeSiliconPersonId,
    agentTasks: s.agentTasks,
    skills: s.skills,
    models: s.models,
    defaultModelProfileId: s.defaultModelProfileId,
    approvalRequests: s.approvalRequests,
    myClawRootPath: s.myClawRootPath,
    workspaceRootPath: s.workspaceRootPath,
    time: s.time,
    modelSwitchNotice: s.modelSwitchNotice,
    webPanel: s.webPanel,
    mcpTools: s.mcpTools,
    mcpServers: s.mcpServers,
    projectDetails: s.projectDetails,
    currentProjectBinding: s.currentProjectBinding,
    // Actions (stable references, never trigger re-render by themselves)
    loadSessionProjectBinding: s.loadSessionProjectBinding,
    loadProjectDetail: s.loadProjectDetail,
    loadSiliconPersonById: s.loadSiliconPersonById,
    markSiliconPersonSessionRead: s.markSiliconPersonSessionRead,
    updateSessionRuntimeIntent: s.updateSessionRuntimeIntent,
    applySessionUpdate: s.applySessionUpdate,
    cancelSessionRun: s.cancelSessionRun,
    approvePlan: s.approvePlan,
    cancelPlanMode: s.cancelPlanMode,
    pushAssistantMessage: s.pushAssistantMessage,
    createSiliconPersonSession: s.createSiliconPersonSession,
    createSession: s.createSession,
    createWebPanelTab: s.createWebPanelTab,
    closeWebPanel: s.closeWebPanel,
    dismissModelSwitchNotice: s.dismissModelSwitchNotice,
    switchSiliconPersonSession: s.switchSiliconPersonSession,
    selectSession: s.selectSession,
    deleteSession: s.deleteSession,
    setActiveSiliconPersonId: s.setActiveSiliconPersonId,
    cancelAgentTask: s.cancelAgentTask,
    retryAgentTask: s.retryAgentTask,
    followUpAgentTask: s.followUpAgentTask,
    appendAgentTaskResultToSource: s.appendAgentTaskResultToSource,
    createAgentTask: s.createAgentTask,
    sendSiliconPersonMessage: s.sendSiliconPersonMessage,
    sendMessage: s.sendMessage,
    resolveApproval: s.resolveApproval,
    pollBackgroundTask: s.pollBackgroundTask,
    cancelBackgroundTask: s.cancelBackgroundTask,
  })));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composerDraft, setComposerDraft] = useState("");
  const [activeRunState, setActiveRunState] = useState<ComposerRunState | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(new Set());
  const [resolvingApprovalIds, setResolvingApprovalIds] = useState<Set<string>>(new Set());
  const [formDrafts, setFormDrafts] = useState<Record<string, Record<string, string>>>({});
  const [submittedFormIds, setSubmittedFormIds] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => Promise<void> | void } | null>(null);
  const timelinePanelRef = useRef<HTMLElement | null>(null);
  const timelineStickToBottomRef = useRef(true);
  const streamingMessageIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  // 投递痕迹 5s 自动消失的定时器集中管理，组件 unmount 时统一清理。
  const dispatchTraceTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // 跟踪当前轮次工具执行状态，用于增强聊天时间线展示。
  const [activeTools, setActiveTools] = useState<Map<string, { toolId: string; toolName: string; startTime: number; args?: Record<string, unknown> }>>(new Map());
  const [toolTimings, setToolTimings] = useState<Map<string, number>>(new Map());
  const [currentRound, setCurrentRound] = useState(0);
  const [dismissedTaskPanelKey, setDismissedTaskPanelKey] = useState<string | null>(null);
  const [showWorkFiles, setShowWorkFiles] = useState(false);
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [showContextWarning, setShowContextWarning] = useState(false);
  const prevTaskCountRef = React.useRef(0);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionMenuIndex, setMentionMenuIndex] = useState(0);
  const [mentionTargetSiliconPersonId, setMentionTargetSiliconPersonId] = useState<string | null>(null);
  const [dismissedAgentTaskCardKeys, setDismissedAgentTaskCardKeys] = useState<Set<string>>(new Set());
  const [activeAgentTaskFollowUpId, setActiveAgentTaskFollowUpId] = useState<string | null>(null);
  const [agentTaskFollowUpDrafts, setAgentTaskFollowUpDrafts] = useState<Record<string, string>>({});
  const [appendingAgentTaskIds, setAppendingAgentTaskIds] = useState<Set<string>>(new Set());
  const [dispatchTraces, setDispatchTraces] = useState<Array<{ id: string; personName: string; personId: string; content: string; timestamp: string }>>([]);
  const [autoExpandedReasoningMessageId, setAutoExpandedReasoningMessageId] = useState<string | null>(null);
  const [reasoningPanelOverrides, setReasoningPanelOverrides] = useState<Record<string, boolean>>({});
  const [activeReminderBanner, setActiveReminderBanner] = useState<ChatReminderBannerPayload | null>(null);
  const webPanelIsOpen = Boolean(workspace.webPanel?.isOpen);

  const siliconPersons = workspace.siliconPersons ?? [];
  const activeSiliconPersonId = workspace.activeSiliconPersonId;
  const selectedSiliconPerson = activeSiliconPersonId
    ? siliconPersons.find((sp) => sp.id === activeSiliconPersonId) ?? null
    : null;
  const mentionTargetSiliconPerson = mentionTargetSiliconPersonId
    ? siliconPersons.find((sp) => sp.id === mentionTargetSiliconPersonId) ?? null
    : null;
  const agentTasks = workspace.agentTasks ?? [];
  const siliconPersonNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of siliconPersons) {
      map.set(person.id, person.name);
    }
    return map;
  }, [siliconPersons]);

  const filteredMentions = useMemo(() => {
    if (!mentionMenuOpen) return [];
    const q = mentionFilter.toLowerCase();
    return siliconPersons.filter(
      (sp) => sp.name.toLowerCase().includes(q) || sp.title.toLowerCase().includes(q),
    );
  }, [mentionMenuOpen, mentionFilter, siliconPersons]);

  // ── Session 解析：共享页面承载主聊天与硅基员工聊天，两者使用同一套 UI，但 session 隔离 ──
  const selectedSiliconSessionId = useMemo(() => {
    if (!selectedSiliconPerson) return null;
    return resolveSiliconPersonCurrentSessionId({
      currentSessionId: selectedSiliconPerson.currentSessionId,
      sessions: selectedSiliconPerson.sessions,
    });
  }, [selectedSiliconPerson]);

  const selectedSiliconSession = useMemo(() => {
    if (!selectedSiliconPerson || !selectedSiliconSessionId) return null;
    return workspace.sessions.find(
      (item) => item.id === selectedSiliconSessionId && item.siliconPersonId === selectedSiliconPerson.id,
    ) ?? null;
  }, [selectedSiliconPerson, selectedSiliconSessionId, workspace.sessions]);

  const isSiliconPersonView = Boolean(selectedSiliconPerson);
  const session = isSiliconPersonView ? selectedSiliconSession : workspace.currentSession;
  const taskPanelSignature = useMemo(
    () => buildTaskPanelSignature(session?.tasks, session?.taskInterrupts),
    [session?.tasks, session?.taskInterrupts],
  );
  const taskPanelDismissKey = useMemo(
    () => buildTaskPanelDismissKey(session?.id, taskPanelSignature),
    [session?.id, taskPanelSignature],
  );
  const taskPanelDismissed = Boolean(
    taskPanelDismissKey
    && (dismissedTaskPanelKey === taskPanelDismissKey || readTaskPanelDismissed(taskPanelDismissKey)),
  );
  const visibleAgentTasks = useMemo(() => {
    if (!session?.id || isSiliconPersonView) return [];
    return agentTasks.filter((task) => {
      if (task.sourceSessionId !== session.id) return false;
      const dismissKey = buildAgentTaskCardDismissKey(task);
      return !dismissedAgentTaskCardKeys.has(dismissKey) && !readAgentTaskCardDismissed(dismissKey);
    });
  }, [agentTasks, dismissedAgentTaskCardKeys, isSiliconPersonView, session?.id]);

  const selectedSiliconSessionSummary = useMemo(() => {
    if (!selectedSiliconPerson || !session?.id) return null;
    return selectedSiliconPerson.sessions.find((item) => item.id === session.id) ?? null;
  }, [selectedSiliconPerson, session?.id]);

  const currentChildAgentTask = useMemo(() => {
    if (!isSiliconPersonView || !session?.id) return null;
    return agentTasks.find((task) => Object.values(task.childSessionIds ?? {}).includes(session.id)) ?? null;
  }, [agentTasks, isSiliconPersonView, session?.id]);

  const workFilesScope = useMemo<ArtifactScopeRef | null>(() => {
    if (!session?.id) return null;
    return { scopeKind: "session", scopeId: session.id };
  }, [session?.id]);
  const inlineFileBaseDirectory = session?.attachedDirectory
    ?? workspace.myClawRootPath
    ?? workspace.workspaceRootPath
    ?? null;
  const currentProjectDetail = workspace.currentProjectBinding
    ? workspace.projectDetails?.[workspace.currentProjectBinding.id] ?? null
    : null;
  const projectWarningCount = countChatProjectWarnings(currentProjectDetail);
  const capabilityPanelGroups = useMemo(() => buildCapabilityPanelGroups({
    detail: currentProjectDetail,
    skills: workspace.skills ?? [],
    mcpTools: workspace.mcpTools ?? [],
    mcpServers: workspace.mcpServers ?? [],
  }), [currentProjectDetail, workspace.skills, workspace.mcpTools, workspace.mcpServers]);

  /** 渲染 Chat 项目能力面板中的单个分组图标。 */
  function renderCapabilityGroupIcon(icon: "boxes" | "wrench" | "plug") {
    if (icon === "boxes") return <Boxes size={14} aria-hidden />;
    if (icon === "wrench") return <Wrench size={14} aria-hidden />;
    return <Plug size={14} aria-hidden />;
  }

  /** 统一会话列表来源：主聊天看主 session，硅基员工聊天看该员工自己的私域 session。 */
  const displaySessions = useMemo(() => {
    if (!selectedSiliconPerson) {
      return workspace.sessions.filter((item) => !item.siliconPersonId);
    }

    const sessionMap = new Map(
      workspace.sessions
        .filter((item) => item.siliconPersonId === selectedSiliconPerson.id)
        .map((item) => [item.id, item] as const),
    );

    const orderedSessions = selectedSiliconPerson.sessions
      .map((summary) => sessionMap.get(summary.id))
      .filter((item): item is ChatSession => Boolean(item));

    for (const item of sessionMap.values()) {
      if (!orderedSessions.some((sessionItem) => sessionItem.id === item.id)) {
        orderedSessions.push(item);
      }
    }

    return orderedSessions;
  }, [selectedSiliconPerson, workspace.sessions]);

  /** 定时任务 id → job 元信息查表，给 session 列表行/header 显示「来自定时任务 X」用。 */
  const scheduleJobsById = useMemo(() => {
    const map = new Map<string, { id: string; title: string }>();
    for (const job of workspace.time?.scheduleJobs ?? []) {
      map.set(job.id, { id: job.id, title: job.title });
    }
    return map;
  }, [workspace.time?.scheduleJobs]);

  const associatedScheduleJob = useMemo(() => {
    const associatedId = (session as { associatedScheduleJobId?: string | null } | null)?.associatedScheduleJobId;
    if (!associatedId) return null;
    return scheduleJobsById.get(associatedId) ?? null;
  }, [session, scheduleJobsById]);

  const sessionRuntimeIntent = session?.runtimeIntent as Record<string, unknown> | undefined;
  const planModeState = (session as (ChatSession & {
    planModeState?: { mode?: string; approvalStatus?: string; planVersion?: number } | null;
  }) | null)?.planModeState ?? null;
  const planModeEnabled = sessionRuntimeIntent?.workflowMode === "plan"
    || sessionRuntimeIntent?.planModeEnabled === true;
  const isRunBusy = activeRunState !== null;
  const isRunCanceling = activeRunState?.status === "canceling";
  const activeViewSessionIdRef = useRef<string | null>(session?.id ?? null);
  const activeViewSiliconPersonIdRef = useRef<string | null>(selectedSiliconPerson?.id ?? null);

  /** 当前硅基员工是否缺少有效 modelProfileId（空或不在已配置模型列表里）。 */
  const siliconPersonModelMissing = useMemo(() => {
    if (!isSiliconPersonView) return false;
    const sid = (session as { siliconPersonId?: string | null } | null)?.siliconPersonId ?? null;
    if (!sid) return false;
    const person = siliconPersons.find((p) => p.id === sid);
    if (!person) return false;
    const profileId = person.modelProfileId?.trim();
    if (!profileId) return true;
    const models = workspace.models as Array<Record<string, unknown>> | undefined;
    if (!models || models.length === 0) return true;
    return !models.find((m) => m.id === profileId);
  }, [isSiliconPersonView, session, siliconPersons, workspace.models]);

  activeViewSessionIdRef.current = session?.id ?? null;
  activeViewSiliconPersonIdRef.current = selectedSiliconPerson?.id ?? null;

  /** 切换到新的聊天对象时清空本地 @ 投递目标，避免“进入聊天”被误显示成“待投递给某人”。 */
  useEffect(() => {
    setMentionTargetSiliconPersonId(null);
  }, [activeSiliconPersonId]);

  /** 会话切换后同步查询当前项目绑定，保证顶部 pill 不依赖临时页面状态。 */
  useEffect(() => {
    if (typeof workspace.loadSessionProjectBinding !== "function") return;
    void workspace.loadSessionProjectBinding(session?.id ?? null).catch((error: unknown) => {
      console.warn("[chat-page] 查询会话项目绑定失败", {
        sessionId: session?.id ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [session?.id, workspace.loadSessionProjectBinding]);

  /** 已知会话绑定项目后，懒加载项目能力详情用于 Chat 运行能力面板。 */
  useEffect(() => {
    const projectId = workspace.currentProjectBinding?.id ?? null;
    if (!projectId || workspace.projectDetails?.[projectId]) return;
    if (typeof workspace.loadProjectDetail !== "function") return;
    void workspace.loadProjectDetail(projectId).catch((error: unknown) => {
      console.warn("[chat-page] 加载会话项目能力详情失败", {
        localProjectId: projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [workspace.currentProjectBinding?.id, workspace.projectDetails, workspace.loadProjectDetail]);

  /** 项目能力面板打开后允许 Esc 收起，保持键盘用户的关闭路径。 */
  useEffect(() => {
    if (!projectPanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectPanelOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [projectPanelOpen]);

  /** 组件 unmount 时清理所有挂起的 5s 投递痕迹定时器，避免 React state-on-unmounted 警告。 */
  useEffect(() => {
    const timers = dispatchTraceTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  /** 路由参数 ?sessionId= 一次性命中 → 切到该 session 并清掉 query，避免回退/刷新时反复触发。 */
  /** 监听主进程提醒投递事件，在聊天顶部提供应用内兜底提示。 */
  useEffect(() => {
    const unsubscribe = window.myClawAPI?.onTimeReminderDelivered?.((payload) => {
      console.info("[chat-page] 收到应用内提醒事件", {
        id: payload.id,
        title: payload.title,
      });
      setActiveReminderBanner(payload);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const queryId = searchParams.get("sessionId");
    if (!queryId) return;
    const exists = workspace.sessions.some((item) => item.id === queryId);
    if (!exists) return;
    useWorkspaceStore.getState().selectSession(queryId);
    const next = new URLSearchParams(searchParams);
    next.delete("sessionId");
    setSearchParams(next, { replace: true });
  }, [searchParams, workspace.sessions, setSearchParams]);

  /** 进入硅基员工聊天页后先刷新一次员工摘要，保证 currentSession 摘要与未读状态同步。 */
  useEffect(() => {
    if (!activeSiliconPersonId) return;
    console.info("[chat-page] 进入硅基员工聊天视图，刷新员工摘要", {
      siliconPersonId: activeSiliconPersonId,
    });
    void workspace.loadSiliconPersonById(activeSiliconPersonId).catch((error) => {
      console.error("[chat-page] 刷新硅基员工摘要失败", {
        siliconPersonId: activeSiliconPersonId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [activeSiliconPersonId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 切换到硅基员工视图后，effort selector 不再渲染，清掉 runtimeIntent 里残留的 reasoningEffort，
   * 避免发送时仍把上次的 effort 偷偷带进 wire 请求。 */
  useEffect(() => {
    if (!isSiliconPersonView) return;
    if (!session) return;
    const intent = session.runtimeIntent as Record<string, unknown> | undefined;
    if (!intent || intent.reasoningEffort === undefined) return;
    void updateDisplayedSessionRuntimeIntent({ reasoningEffort: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSiliconPersonView, session?.id]);

  /** 查看硅基员工当前会话时立即消费未读，保持侧边栏和页内状态一致。 */
  useEffect(() => {
    if (!selectedSiliconPerson?.id || !selectedSiliconSessionSummary?.id) return;
    if (!selectedSiliconSessionSummary.hasUnread && selectedSiliconSessionSummary.unreadCount <= 0) return;

    console.info("[chat-page] 标记硅基员工当前会话已读", {
      siliconPersonId: selectedSiliconPerson.id,
      sessionId: selectedSiliconSessionSummary.id,
    });
    void workspace.markSiliconPersonSessionRead(selectedSiliconPerson.id, selectedSiliconSessionSummary.id).catch((error) => {
      console.error("[chat-page] 标记硅基员工会话已读失败", {
        siliconPersonId: selectedSiliconPerson.id,
        sessionId: selectedSiliconSessionSummary.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [
    selectedSiliconPerson?.id,
    selectedSiliconSessionSummary?.id,
    selectedSiliconSessionSummary?.hasUnread,
    selectedSiliconSessionSummary?.unreadCount,
  ]);

  useEffect(() => {
    setActiveRunState((current) => {
      const next = readSessionRunState(session);
      if (!session?.id) return null;
      if (next) {
        if (current?.sessionId === session.id && current.status === "canceling" && (!current.runId || current.runId === next.runId)) {
          return { ...next, status: "canceling", reason: current.reason ?? next.reason ?? null };
        }
        return next;
      }
      if (current?.sessionId !== session.id) return null;
      if (current.status === "dispatching") return current;
      return null;
    });
  }, [
    session?.id,
    session?.chatRunState?.runId,
    session?.chatRunState?.status,
    session?.chatRunState?.phase,
    session?.chatRunState?.activeMessageId,
    session?.chatRunState?.lastReason,
  ]);

  useEffect(() => {
    setAutoExpandedReasoningMessageId(readSessionRunState(session)?.messageId ?? null);
  }, [session?.id]);

  useEffect(() => {
    timelineStickToBottomRef.current = true;
    setReasoningPanelOverrides({});
  }, [session?.id]);

  useEffect(() => {
    if (activeRunState?.messageId) {
      setAutoExpandedReasoningMessageId(activeRunState.messageId);
      return;
    }
    setAutoExpandedReasoningMessageId(null);
  }, [activeRunState?.messageId, activeRunState?.status, activeRunState?.sessionId]);

  // 切换 session 时重置上下文警告
  useEffect(() => {
    setShowContextWarning(false);
  }, [session?.id]);

  // 新 task 被创建时自动取消 dismissed，重新显示面板
  useEffect(() => {
    const count = session?.tasks?.length ?? 0;
    if (count > prevTaskCountRef.current) {
      setDismissedTaskPanelKey(null);
    }
    prevTaskCountRef.current = count;
  }, [session?.tasks?.length]);

  const { captureTrigger: captureConfirmTrigger } = useDialogA11y({
    isOpen: confirmDialog !== null,
    onClose: closeConfirmDialog,
    initialFocusRef: confirmCancelRef,
    dialogName: "删除会话确认弹层",
  });

  /** 判断思考过程面板是否展开，优先尊重用户手动指定的开合状态。 */
  function isReasoningPanelOpen(messageId: string) {
    if (Object.prototype.hasOwnProperty.call(reasoningPanelOverrides, messageId)) {
      return reasoningPanelOverrides[messageId] === true;
    }
    return autoExpandedReasoningMessageId === messageId;
  }

  /** 记录用户对思考过程面板的展开或折叠选择，保证箭头和提示文案同步。 */
  function handleReasoningPanelToggle(messageId: string, open: boolean) {
    console.info("[chat-page] 用户切换思考过程面板", {
      sessionId: session?.id ?? null,
      messageId,
      open,
    });
    setReasoningPanelOverrides((prev) => ({ ...prev, [messageId]: open }));
  }

  const sessionMessages = session?.messages;

  const sessionUsageSummary = useMemo(() => {
    const empty = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
      cacheWriteInputTokens: 0,
      hasCacheUsage: false,
    };
    if (!sessionMessages) return empty;
    return sessionMessages.reduce((summary, msg) => {
      if (!msg.usage) return summary;
      const cacheHitTokens = readCacheHitInputTokens(msg.usage);
      summary.promptTokens += msg.usage.promptTokens;
      summary.completionTokens += msg.usage.completionTokens;
      summary.totalTokens += msg.usage.totalTokens;
      summary.cacheHitInputTokens += cacheHitTokens ?? 0;
      summary.cacheMissInputTokens += msg.usage.cacheMissInputTokens ?? 0;
      summary.cacheWriteInputTokens += msg.usage.cacheWriteInputTokens ?? 0;
      summary.hasCacheUsage = summary.hasCacheUsage
        || cacheHitTokens !== undefined
        || msg.usage.cacheMissInputTokens !== undefined
        || msg.usage.cacheWriteInputTokens !== undefined;
      return summary;
    }, empty);
  }, [sessionMessages]);

  const parsedMessages = useMemo(() => {
    if (!sessionMessages) return [];
    const streamingId = streamingMessageIdRef.current;
    return sessionMessages.map((msg: ChatMessage) => {
      if (!msg || typeof msg.content !== "string") return msg;
      const a2uiSubmitMatch = msg.content.match(/^\[A2UI_FORM:([a-zA-Z0-9_-]+)\]\s*(.*)$/);
      if (a2uiSubmitMatch && msg.role === "user") {
        return { ...msg, content: "", uiSubmitResult: { id: a2uiSubmitMatch[1], pairs: a2uiSubmitMatch[2] }, renderedHtml: "" };
      }
      const a2uiMatch = msg.content.match(/```a2ui\s*([\s\S]*?)\s*```/);
      if (!a2uiMatch) {
        const isStreaming = msg.id === streamingId;
        return {
          ...msg,
          renderedHtml: isStreaming
            ? escapeHtml(msg.content)
            : getCachedMarkdown(msg.id, msg.content, renderMarkdown),
          renderedReasoningHtml: msg.reasoning
            ? (isStreaming ? escapeHtml(msg.reasoning) : getCachedMarkdown(msg.id + "-r", msg.reasoning, renderMarkdown))
            : "",
          _isStreaming: isStreaming,
        };
      }
      try {
        const parsed = JSON.parse(a2uiMatch[1]);
        const replacedContent = msg.content.replace(a2uiMatch[0], "").trim();
        let finalUi = (msg as any).ui;
        if (!finalUi && parsed.ui) finalUi = { ...parsed.ui, id: parsed.ui.id || msg.id };
        const finalContent = replacedContent || parsed.text || "";
        return { ...msg, content: finalContent, ui: finalUi, renderedHtml: getCachedMarkdown(msg.id, finalContent, renderMarkdown), renderedReasoningHtml: msg.reasoning ? getCachedMarkdown(msg.id + "-r", msg.reasoning, renderMarkdown) : "" };
      } catch {
        return { ...msg, renderedHtml: getCachedMarkdown(msg.id, textOf(msg.content), renderMarkdown), renderedReasoningHtml: msg.reasoning ? getCachedMarkdown(msg.id + "-r", msg.reasoning, renderMarkdown) : "" };
      }
    });
  }, [sessionMessages]);

  const groupedMessages = useMemo(() => {
    // 收集所有 task 工具调用的 call ID，用于过滤对应的 tool 输出消息
    const taskCallIds = new Set<string>();
    for (const msg of parsedMessages) {
      if (msg.role === "assistant" && Array.isArray((msg as any).tool_calls)) {
        for (const tc of (msg as any).tool_calls as Array<{ id: string; function: { name: string } }>) {
          if (tc.function.name.startsWith("task_")) {
            taskCallIds.add(tc.id);
          }
        }
      }
    }

    const result: any[] = [];
    let currentGroup: any = null;
    for (const message of parsedMessages) {
      // 过滤 task 工具的输出消息
      if (message.role === "tool" && message.tool_call_id && taskCallIds.has(message.tool_call_id)) {
        continue;
      }
      // 过滤纯 task 调用的 assistant 消息（所有 tool_calls 都是 task_*）
      if (message.role === "assistant" && Array.isArray((message as any).tool_calls) && (message as any).tool_calls.length > 0) {
        const calls = (message as any).tool_calls as Array<{ function: { name: string } }>;
        const allTask = calls.every((tc) => tc.function.name.startsWith("task_"));
        if (allTask && !textOf(message.content).trim()) {
          continue;
        }
      }

      const isTechnical = message.role === "system" || message.role === "tool";
      // 没有正文且没有 reasoning 但带 `tool_calls` 的助手消息属于中间思考步骤，归并到技术链中展示。
      // 如果有 reasoning（思考过程），即使没有正文也应作为正常消息展示，让用户能看到模型的推理。
      const hasVisibleContent = !!(textOf(message.content).trim() || (message as any).reasoning?.trim());
      const isToolCallAssistant = message.role === "assistant"
        && Array.isArray((message as any).tool_calls)
        && (message as any).tool_calls.length > 0
        && !hasVisibleContent;

      if (isTechnical || isToolCallAssistant) {
        if (!currentGroup) {
          currentGroup = { id: "group-" + message.id, role: "technical", isTechnicalGroup: true, items: [] };
          result.push(currentGroup);
        }
        currentGroup.items.push(message);
      } else {
        currentGroup = null;
        result.push({ ...message, isTechnicalGroup: false });
      }
    }
    // 移除过滤后变空的技术分组
    return result.filter((g) => !g.isTechnicalGroup || (g.items && g.items.length > 0));
  }, [parsedMessages]);

  // ── 虚拟滚动 ──
  const virtualizer = useVirtualizer({
    count: groupedMessages.length,
    getScrollElement: () => timelinePanelRef.current,
    estimateSize: (index: number) => {
      const msg = groupedMessages[index];
      if (!msg) return 100;
      if (msg.isTechnicalGroup) return 60;
      const len = (msg.content ?? "").length;
      if (len > 2000) return 400;
      if (len > 500) return 200;
      return 120;
    },
    overscan: 5,
  });

  const sessionApprovalRequests = useMemo(() => {
    if (!session) return [];
    // 后端 shouldRequestApproval 已判断是否需要审批，前端只需展示所有待审批请求
    return workspace.approvalRequests.filter((item: ApprovalRequest) => item.sessionId === session.id);
  }, [session, workspace.approvalRequests]);

  const isAwaitingModelResponse = useMemo(() => {
    if (!isRunBusy) return false;
    const msgs = session?.messages;
    if (!msgs || msgs.length === 0) return true;
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role === "assistant") {
      return !textOf(lastMsg.content).trim() && !(lastMsg as any).reasoning?.trim();
    }
    return lastMsg.role === "user" || lastMsg.role === "system";
  }, [isRunBusy, session]);

  // ─── Slash 命令菜单 ─────────────────────────────────────────────────────────

  const slashItems = useMemo(() => {
    const builtins = [
      { id: "c-cmd", command: "/cmd ", label: "/cmd", description: "执行终端命令", category: "command" as const },
      { id: "c-read", command: "/read ", label: "/read", description: "读取文件", category: "command" as const },
      { id: "c-mcp", command: "/mcp ", label: "/mcp", description: "调用 MCP 工具", category: "command" as const },
      { id: "c-network", command: "/network ", label: "/network", description: "发起网络请求", category: "command" as const },
    ];
    const skillEntries = (workspace.skills ?? []).filter((s) => s.enabled).map((s) => ({
      id: `s-${s.id}`,
      command: `/skill ${s.id} `,
      label: s.name,
      description: s.description || "自定义技能",
      category: "skill" as const,
    }));
    const projectSkillEntries = (currentProjectDetail?.refs ?? [])
      .filter((ref) => ref.kind === "skill")
      .filter((ref) => isProjectSkillCallable(currentProjectDetail, ref))
      .map((ref) => ({
        id: `ps-${ref.id}`,
        command: `/skill ${ref.alias ?? ref.cloudCapabilityId} `,
        label: ref.displayName,
        description: ref.description || "项目技能",
        category: "project-skill" as const,
      }));
    return [...builtins, ...projectSkillEntries, ...skillEntries];
  }, [currentProjectDetail, workspace.skills]);

  const slashMenuOpen = /^\/[^\s]*$/.test(composerDraft) && !isRunBusy;
  const slashFilter = composerDraft.slice(1).toLowerCase();
  const filteredSlash = useMemo(() => {
    if (!slashMenuOpen) return [];
    return slashItems.filter((it) =>
      it.label.toLowerCase().includes(slashFilter) ||
      it.description.includes(slashFilter)
    );
  }, [slashMenuOpen, slashFilter, slashItems]);
  const slashIdx = filteredSlash.length > 0 ? Math.min(slashMenuIndex, filteredSlash.length - 1) : 0;

  /** 选择某个 Slash 菜单项，并把命令写回输入框。 */
  function selectSlashItem(item: (typeof slashItems)[number]) {
    setComposerDraft(item.command);
    setSlashMenuIndex(0);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  /** 判断当前分组是否是时间线中最后一个技术链分组。 */
  function isLastTechnicalGroup(index: number): boolean {
    const groups = groupedMessages;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].isTechnicalGroup) return i === index;
    }
    return false;
  }

  /** 判断用户是否仍停留在时间线底部附近。 */
  const isNearBottom = useCallback((): boolean => {
    const el = timelinePanelRef.current;
    if (!el) return true;
    // 距离底部 150px 以内就视为“接近底部”。
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  /** 在合适时机把时间线滚动到底部，可强制覆盖用户当前阅读位置。 */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth", force = false) => {
    const el = timelinePanelRef.current;
    if (!el) return;
    // 用户正在回看历史消息时，不主动抢走滚动位置，除非显式强制。
    if (!force && !timelineStickToBottomRef.current) return;
    requestAnimationFrame(() => {
      if (typeof el.scrollTo === "function") {
        el.scrollTo({ top: el.scrollHeight, behavior });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      timelineStickToBottomRef.current = true;
      if (behavior === "auto") {
        setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 80);
      }
    });
  }, []);

  // 保持 ref 与最新的 scrollToBottom 同步，供流式回调内部调用。
  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  /** 针对当前展示中的会话更新运行时意图；硅基员工模式下要显式写回该私域 session。 */
  async function updateDisplayedSessionRuntimeIntent(intent: Record<string, unknown>) {
    if (!session?.id) return;
    if (!selectedSiliconPerson) {
      await workspace.updateSessionRuntimeIntent(intent);
      return;
    }

    console.info("[chat-page] 更新硅基员工会话运行时意图", {
      siliconPersonId: selectedSiliconPerson.id,
      sessionId: session.id,
      intent,
    });
    const payload = await window.myClawAPI.updateSessionRuntimeIntent(session.id, intent);
    workspace.applySessionUpdate(payload.session);
  }

  /** 针对当前展示中的会话取消运行；硅基员工模式下不能误打到主聊天 currentSession。 */
  async function cancelDisplayedSessionRun(input: { runId?: string; messageId?: string; reason?: string }) {
    if (!session?.id) return;
    if (!selectedSiliconPerson) {
      await workspace.cancelSessionRun(input);
      return;
    }

    console.info("[chat-page] 取消硅基员工会话运行", {
      siliconPersonId: selectedSiliconPerson.id,
      sessionId: session.id,
      runId: input.runId ?? null,
      messageId: input.messageId ?? null,
      reason: input.reason ?? null,
    });
    const payload = await window.myClawAPI.cancelSessionRun(session.id, input);
    if (payload?.session) {
      workspace.applySessionUpdate(payload.session);
    }
  }

  /** 针对当前展示中的会话批准计划；硅基员工模式下需要直连该私域 session。 */
  async function approveDisplayedSessionPlan() {
    if (!session?.id) return;
    if (!selectedSiliconPerson) {
      await workspace.approvePlan();
      return;
    }

    console.info("[chat-page] 批准硅基员工会话计划", {
      siliconPersonId: selectedSiliconPerson.id,
      sessionId: session.id,
    });
    const payload = await window.myClawAPI.approvePlan(session.id);
    workspace.applySessionUpdate(payload.session);
  }

  /** 针对当前展示中的会话取消计划模式；避免硅基员工页面误改主聊天状态。 */
  async function cancelDisplayedSessionPlanMode() {
    if (!session?.id) return;
    if (!selectedSiliconPerson) {
      await workspace.cancelPlanMode();
      return;
    }

    console.info("[chat-page] 取消硅基员工会话 Plan Mode", {
      siliconPersonId: selectedSiliconPerson.id,
      sessionId: session.id,
    });
    const payload = await window.myClawAPI.cancelPlanMode(session.id);
    workspace.applySessionUpdate(payload.session);
  }

  // 订阅主进程转发的 `session:stream` 事件，接收实时流式消息与工具状态。
  useEffect(() => {
    const unsubscribe = window.myClawAPI.onSessionStream((event) => {
      const ws = useWorkspaceStore.getState();
      const runtimeStatus = readRuntimeStatus(event);
      const {
        type, sessionId, messageId, delta,
        session: updatedSession,
        toolCallId, toolId, toolName, output, success, error: toolError,
      } = event as {
        type: string;
        sessionId?: string;
        messageId?: string;
        delta?: { content?: string; reasoning?: string };
        session?: ChatSession;
        toolCallId?: string;
        toolId?: string;
        toolName?: string;
        output?: string;
        success?: boolean;
        error?: string;
        round?: number;
      };
      const eventSessionId = runtimeStatus?.sessionId ?? sessionId ?? updatedSession?.id;

      // 判断事件 sessionId 是否属于当前活跃视图。
      const isActiveViewSession = (sid: string): boolean => {
        return sid === activeViewSessionIdRef.current;
      };

      if (type !== "approval.requested" && !eventSessionId) return;

      if (type === "run.started") {
        const round = (event as any).round ?? 0;
        if (round > 0) setCurrentRound(round);
      } else if (type === "runtime.status" && runtimeStatus) {
        if (!isActiveViewSession(runtimeStatus.sessionId)) return;
        if (TERMINAL_RUN_STATUSES.has(runtimeStatus.status)) {
          streamingMessageIdRef.current = null;
          flushStreamingBufferNow();
          setActiveRunState(null);
          setCurrentRound(0);
          setActiveTools(new Map());
        } else {
          setActiveRunState({
            sessionId: runtimeStatus.sessionId,
            runId: runtimeStatus.runId,
            status: runtimeStatus.status,
            phase: runtimeStatus.phase,
            messageId: runtimeStatus.messageId,
            reason: runtimeStatus.reason ?? null,
          });
        }
      } else if (type === "message.delta" && eventSessionId && messageId && (delta?.content || delta?.reasoning)) {
        streamingMessageIdRef.current = messageId;
        bufferStreamingDelta(eventSessionId, messageId, delta.content ?? null, delta.reasoning ?? null);
        // 流式输出时持续滚动到底部，避免用户需要手动滚动查看新内容。
        scrollToBottomRef.current("smooth");
      } else if (type === "session.updated" && updatedSession) {
        streamingMessageIdRef.current = null;
        flushStreamingBufferNow();
        ws.applySessionUpdate(updatedSession);
        if (updatedSession.siliconPersonId) {
          void ws.loadSiliconPersonById(updatedSession.siliconPersonId).catch((error) => {
            console.error("[chat-page] 刷新硅基员工摘要失败", {
              siliconPersonId: updatedSession.siliconPersonId,
              sessionId: updatedSession.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
        if (isActiveViewSession(updatedSession.id)) {
          setActiveRunState((current) => {
            const next = readSessionRunState(updatedSession);
            if (next) {
              if (current?.sessionId === updatedSession.id && current.status === "canceling" && (!current.runId || current.runId === next.runId)) {
                return { ...next, status: "canceling", reason: current.reason ?? next.reason ?? null };
              }
              return next;
            }
            if (current?.sessionId === updatedSession.id && current.status === "dispatching") {
              return current;
            }
            return null;
          });
        }
        setCurrentRound(0);
        setActiveTools(new Map());
      } else if (type === "tasks.updated" && eventSessionId) {
        // Task V2 实时更新：将最新 tasks 合并到当前 session
        const tasks = (event as { tasks?: unknown[] }).tasks;
        if (Array.isArray(tasks)) {
          ws.patchSessionTasks(eventSessionId, tasks as import("@shared/contracts").Task[]);
        }
      } else if (type === "tool.started" && toolCallId) {
        setActiveTools((prev) => {
          const next = new Map(prev);
          next.set(toolCallId, {
            toolId: toolId ?? "",
            toolName: toolName ?? "",
            startTime: Date.now(),
            args: (event as any).arguments,
          });
          return next;
        });
      } else if (type === "tool.completed" && toolCallId) {
        setActiveTools((prev) => {
          const next = new Map(prev);
          const entry = next.get(toolCallId);
          if (entry) {
            setToolTimings((tp) => {
              const n = new Map(tp);
              n.set(toolCallId, Date.now() - entry.startTime);
              return n;
            });
          }
          next.delete(toolCallId);
          return next;
        });
      } else if (type === "tool.failed" && toolCallId) {
        setActiveTools((prev) => {
          const next = new Map(prev);
          const entry = next.get(toolCallId);
          if (entry) {
            setToolTimings((tp) => {
              const n = new Map(tp);
              n.set(toolCallId, Date.now() - entry.startTime);
              return n;
            });
          }
          next.delete(toolCallId);
          return next;
        });
      } else if (type === "context.limit_warning" && eventSessionId) {
        if (eventSessionId === activeViewSessionIdRef.current) {
          setShowContextWarning(true);
        }
      } else if (type === "approval.requested") {
        const req = (event as any).approvalRequest;
        if (req) {
          ws.addApprovalRequest(req);
        }
      }
    });
    return unsubscribe;
  }, []);

  // 订阅 `web-panel:open` 事件，在带 `view.html` 的 Skill 被调用时自动打开侧边面板。
  useEffect(() => {
    const unsubscribe = window.myClawAPI.onWebPanelOpen((payload) => {
      if (payload?.viewPath) {
        useWorkspaceStore.getState().openWebPanel(payload.viewPath, payload.title || "Skill", payload.data ?? null);
      }
    });
    return unsubscribe;
  }, []);

  // 会话切换或消息更新后，按规则滚动到底部。
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const isSwitch = prevSessionIdRef.current !== session?.id;
    prevSessionIdRef.current = session?.id;
    scrollToBottom(isSwitch ? "auto" : "smooth", isSwitch);
    if (isSwitch) {
      // 切换会话后把焦点还给输入框，包括删除后自动新建会话的场景。
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [session?.id, groupedMessages.length, scrollToBottom]);

  /** 把错误以助手消息形式写回当前会话，避免静默失败。 */
  function reportChatError(error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (session) {
      workspace.pushAssistantMessage(session.id, `> [!CAUTION]\n> **发生错误**\n> ${errorMessage}`);
      scrollToBottom("smooth");
    }
  }

  /** 创建新会话，并处理失败提示。 */
  async function createSession() {
    setCreatingSession(true);
    try {
      if (selectedSiliconPerson) {
        console.info("[chat-page] 为硅基员工新建会话", {
          siliconPersonId: selectedSiliconPerson.id,
        });
        await workspace.createSiliconPersonSession(selectedSiliconPerson.id);
      } else {
        await workspace.createSession();
      }
      // 新建对话后清除模型切换通知
      workspace.dismissModelSwitchNotice();
    } catch (error) {
      reportChatError(error);
    } finally {
      setCreatingSession(false);
    }
  }

  /** 切换 Chat 顶部右侧 WebPanel 入口，让新对话旁的图标按钮直接控制右侧 Web 栏。 */
  function handleToggleWebPanel() {
    console.info("[chat-page] 用户切换 Chat 顶部 WebPanel 图标按钮", {
      sessionId: session?.id ?? null,
      open: !webPanelIsOpen,
    });
    if (webPanelIsOpen) {
      workspace.closeWebPanel();
      return;
    }
    workspace.createWebPanelTab();
  }

  /** 切换当前下拉列表中的会话；硅基员工模式下切的是该员工的 currentSession。 */
  async function handleSelectDisplaySession(sessionId: string) {
    if (selectedSiliconPerson) {
      console.info("[chat-page] 切换硅基员工当前会话", {
        siliconPersonId: selectedSiliconPerson.id,
        sessionId,
      });
      await workspace.switchSiliconPersonSession(selectedSiliconPerson.id, sessionId);
      return;
    }

    workspace.selectSession(sessionId);
  }

  /** 判断指定会话是否正处于删除中状态。 */
  function isDeletingSession(sessionId: string) {
    return deletingSessionIds.has(sessionId);
  }

  /** 关闭删除确认框，并让弹层 hook 处理焦点回收。 */
  function closeConfirmDialog() {
    setConfirmDialog((current) => {
      if (!current) return null;
      console.info("[chat-page] 关闭删除确认弹层", { message: current.message });
      return null;
    });
  }

  /** 打开删除确认框，并在确认后执行会话删除。 */
  function handleDeleteSession(sessionId: string, trigger?: HTMLElement | null) {
    if (isDeletingSession(sessionId)) return;
    captureConfirmTrigger(trigger);
    console.info("[chat-page] 打开删除确认弹层", { sessionId });
    setConfirmDialog({
      message: "删除这条对话记录？",
      onConfirm: async () => {
        closeConfirmDialog();
        setDeletingSessionIds((prev) => new Set([...prev, sessionId]));
        try {
          await workspace.deleteSession(sessionId);
        } catch (error) {
          reportChatError(error);
        } finally {
          setDeletingSessionIds((prev) => { const next = new Set(prev); next.delete(sessionId); return next; });
        }
      },
    });
  }

  /** 找到任务中可进入的第一个员工子会话。 */
  function resolveAgentTaskEntry(task: AgentTask): { siliconPersonId: string; sessionId: string } | null {
    for (const siliconPersonId of task.assigneeIds) {
      const sessionId = task.childSessionIds[siliconPersonId];
      if (sessionId) return { siliconPersonId, sessionId };
    }
    return null;
  }

  /** 打开 Agent Task 对应的员工子会话，便于继续查看执行细节。 */
  async function handleOpenAgentTask(task: AgentTask) {
    const entry = resolveAgentTaskEntry(task);
    if (!entry) return;
    try {
      console.info("[chat-page] 打开 Agent Task 子会话", {
        taskId: task.id,
        siliconPersonId: entry.siliconPersonId,
        sessionId: entry.sessionId,
      });
      workspace.setActiveSiliconPersonId(entry.siliconPersonId);
      await workspace.switchSiliconPersonSession(entry.siliconPersonId, entry.sessionId);
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 取消正在排队或执行中的 Agent Task。 */
  async function handleCancelAgentTask(taskId: string) {
    try {
      console.info("[chat-page] 取消 Agent Task", { taskId });
      await workspace.cancelAgentTask(taskId);
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 重新执行 Agent Task，并生成新的员工子会话。 */
  async function handleRetryAgentTask(taskId: string) {
    try {
      console.info("[chat-page] 重试 Agent Task", { taskId });
      await workspace.retryAgentTask(taskId);
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 打开 AgentTask 的内联追问输入框。 */
  function handleStartAgentTaskFollowUp(taskId: string) {
    console.info("[chat-page] 打开 Agent Task 追问输入", { taskId });
    setActiveAgentTaskFollowUpId(taskId);
  }

  /** 记录 AgentTask 追问草稿。 */
  function handleChangeAgentTaskFollowUp(taskId: string, value: string) {
    setAgentTaskFollowUpDrafts((current) => ({
      ...current,
      [taskId]: value,
    }));
  }

  /** 基于已有 Agent Task 创建追问任务。 */
  async function handleSubmitAgentTaskFollowUp(taskId: string) {
    const trimmedInstruction = agentTaskFollowUpDrafts[taskId]?.trim();
    if (!trimmedInstruction) return;
    try {
      console.info("[chat-page] 创建 Agent Task 追问", {
        taskId,
        instructionLength: trimmedInstruction.length,
      });
      await workspace.followUpAgentTask(taskId, trimmedInstruction);
      setActiveAgentTaskFollowUpId(null);
      setAgentTaskFollowUpDrafts((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 关闭 AgentTask 追问输入框。 */
  function handleCancelAgentTaskFollowUp(taskId: string) {
    console.info("[chat-page] 关闭 Agent Task 追问输入", { taskId });
    setActiveAgentTaskFollowUpId((current) => (current === taskId ? null : current));
  }

  /** 判断 AgentTask 是否具备追加到来源主会话的结果。 */
  function canAppendAgentTaskResult(task: AgentTask): boolean {
    return Boolean(task.resultSummary?.trim() && task.status === "succeeded" && !task.appendedMessageId);
  }

  /** 将 AgentTask 结果追加到来源主会话，并按需切回来源主聊天。 */
  async function handleAppendAgentTaskResult(task: AgentTask, options: { returnToSource: boolean }) {
    if (!canAppendAgentTaskResult(task) || appendingAgentTaskIds.has(task.id)) return;
    setAppendingAgentTaskIds((current) => new Set([...current, task.id]));
    try {
      console.info("[chat-page] 追加 Agent Task 结果到主会话", {
        taskId: task.id,
        sourceSessionId: task.sourceSessionId,
        returnToSource: options.returnToSource,
      });
      await workspace.appendAgentTaskResultToSource(task.id);
      if (options.returnToSource) {
        workspace.selectSession(task.sourceSessionId);
        workspace.setActiveSiliconPersonId(null);
      }
    } catch (error) {
      reportChatError(error);
    } finally {
      setAppendingAgentTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  /** 关闭 AgentTask 轻提示，只隐藏当前客户端提示，不影响任务记录和后台执行。 */
  function handleDismissAgentTaskCard(task: AgentTask) {
    const dismissKey = buildAgentTaskCardDismissKey(task);
    writeAgentTaskCardDismissed(dismissKey);
    setDismissedAgentTaskCardKeys((current) => new Set([...current, dismissKey]));
    console.info("[chat-page] 已隐藏 Agent Task 轻提示", {
      taskId: task.id,
      sourceSessionId: task.sourceSessionId,
    });
  }

  /** 关闭会话任务面板，并记住当前任务集合的关闭状态。 */
  function handleDismissTaskPanel() {
    writeTaskPanelDismissed(taskPanelDismissKey);
    setDismissedTaskPanelKey(taskPanelDismissKey);
  }

  /** 提交 Task V2 等待卡片的结构化恢复输入。 */
  async function handleResumeTaskInterrupt(input: TaskResumeInput) {
    try {
      await window.myClawAPI.taskResume(input);
      console.info("[chat-page] 已提交 Task V2 恢复输入", {
        taskId: input.taskId,
        requestId: input.requestId,
        action: input.action,
      });
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 把输入内容发送给运行时，统一处理发送态和异常展示。 */
  async function sendMessageToRuntime(draft: string): Promise<boolean> {
    // 显式 @ 目标始终代表“指令下发”，和当前正在查看哪个聊天对象无关。
    if (mentionTargetSiliconPersonId) {
      try {
        const sourceSessionId = workspace.currentSession?.id ?? session?.id;
        if (!sourceSessionId) return false;
        await workspace.createAgentTask({
          sourceSessionId,
          instruction: draft,
          mode: "delegate",
          assigneeIds: [mentionTargetSiliconPersonId],
        });
        setMentionTargetSiliconPersonId(null);
        return true;
      } catch (error) {
        reportChatError(error);
        return false;
      }
    }

    // 直接处于硅基员工聊天页时，发送默认进入该员工自己的 currentSession。
    if (selectedSiliconPerson) {
      try {
        console.info("[chat-page] 向当前硅基员工会话发送消息", {
          siliconPersonId: selectedSiliconPerson.id,
          sessionId: session?.id ?? null,
          contentLength: draft.length,
        });
        await workspace.sendSiliconPersonMessage(selectedSiliconPerson.id, draft);
        return true;
      } catch (error) {
        reportChatError(error);
        return false;
      }
    }

    if (!session?.id) return false;
    setCurrentRound(0);
    setActiveTools(new Map());
    setActiveRunState({
      sessionId: session.id,
      runId: session.chatRunState?.runId ?? null,
      status: "dispatching",
      phase: planModeEnabled && planModeState?.mode !== "executing" ? "planning" : "model",
      messageId: session.chatRunState?.activeMessageId,
      reason: null,
    });
    try {
      // Slash 命令仍按普通消息发送，由模型自行解析意图并调用工具。
      await workspace.sendMessage(draft);
      return true;
    } catch (error) {
      setActiveRunState(null);
      reportChatError(error);
      return false;
    }
  }

  /** 从硅基员工私域聊天返回主聊天视图，只切换展示对象，不改主聊天 session 本身。 */
  function handleReturnToMainChat() {
    if (!selectedSiliconPerson) return;
    console.info("[chat-page] 从硅基员工聊天返回主聊天", {
      siliconPersonId: selectedSiliconPerson.id,
      sessionId: session?.id ?? null,
      sourceSessionId: currentChildAgentTask?.sourceSessionId ?? null,
    });
    if (currentChildAgentTask?.sourceSessionId) {
      workspace.selectSession(currentChildAgentTask.sourceSessionId);
    }
    workspace.setActiveSiliconPersonId(null);
  }

  /** 提交当前输入框内容。 */
  /** 请求中断当前正在运行的聊天回合，并保留已经流出的半截回答。 */
  async function handleStopRun() {
    if (!session || !activeRunState) return;
    setActiveRunState((current) => {
      if (!current || current.sessionId !== session.id) return current;
      return {
        ...current,
        status: "canceling",
        reason: current.reason ?? "user_stop",
      };
    });
    try {
      await cancelDisplayedSessionRun({
        runId: activeRunState.runId ?? undefined,
        messageId: activeRunState.messageId,
        reason: "user_stop",
      });
    } catch (error) {
      setActiveRunState((current) => {
        if (!current || current.sessionId !== session.id) return current;
        return {
          ...current,
          status: current.status === "canceling" ? "running" : current.status,
          reason: null,
        };
      });
      reportChatError(error);
    }
  }

  async function submitMessage() {
    if (isRunBusy) return;
    const draft = composerDraft.trim();
    if (!draft) return;
    setComposerDraft("");
    await sendMessageToRuntime(draft);
  }

  /** 处理输入框快捷键，包括 Slash 菜单、@ 菜单导航和回车发送。 */
  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // @ mention 菜单导航
    if (mentionMenuOpen && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionMenuIndex((i) => (i + 1) % filteredMentions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionMenuIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectMentionItem(filteredMentions[mentionMenuIndex]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMentionMenuOpen(false); setMentionFilter(""); return; }
    }
    if (slashMenuOpen && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashMenuIndex((i) => (i + 1) % filteredSlash.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashMenuIndex((i) => (i - 1 + filteredSlash.length) % filteredSlash.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectSlashItem(filteredSlash[slashIdx]); return; }
      if (e.key === "Escape") { e.preventDefault(); setComposerDraft(""); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.keyCode !== 229 && e.which !== 229) {
      e.preventDefault();
      void submitMessage();
    }
  }

  /** 选择 @ 菜单中的硅基员工。 */
  function selectMentionItem(person: (typeof siliconPersons)[number]) {
    setMentionTargetSiliconPersonId(person.id);
    setMentionMenuOpen(false);
    setMentionFilter("");
    // 把 @xxx 替换成干净的输入——去掉 @ 前缀部分
    setComposerDraft((prev) => prev.replace(/@\S*$/, "").trimEnd() + (prev.replace(/@\S*$/, "").trimEnd() ? " " : ""));
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  /** 读取某条内联表单消息中指定字段的草稿值。 */
  function readFormFieldValue(messageId: string, fieldName: string): string {
    return formDrafts[messageId]?.[fieldName] ?? "";
  }

  /** 写入某条内联表单消息中指定字段的草稿值。 */
  function writeFormFieldValue(messageId: string, fieldName: string, value: string) {
    setFormDrafts((prev) => ({
      ...prev,
      [messageId]: { ...(prev[messageId] ?? {}), [fieldName]: value },
    }));
  }

  /** 找出首个未填写的必填字段，供提交前校验提示使用。 */
  function findMissingRequiredField(messageId: string, form: A2UiForm): A2UiFormField | null {
    for (const field of form.fields) {
      if (!field.required) continue;
      if (!readFormFieldValue(messageId, field.name).trim()) return field;
    }
    return null;
  }

  /** 组装 A2UI 表单提交报文，沿用现有消息协议。 */
  function createFormSubmissionPayload(messageId: string, form: A2UiForm): string {
    const pairs = form.fields.map((f) => `${f.name}=${readFormFieldValue(messageId, f.name).trim()}`);
    return `[A2UI_FORM:${form.id}] ${pairs.join("; ")}`;
  }

  /** 提交某条消息上的内联 A2UI 表单。 */
  async function submitA2UiForm(message: ChatMessage) {
    if (!shouldRenderInlineA2UiForm((message as any).ui)) return;
    const form = (message as any).ui as A2UiForm;
    const missingField = findMissingRequiredField(message.id, form);
    if (missingField) {
      setFormErrors((prev) => ({ ...prev, [message.id]: `必填项不能为空：${missingField.label}` }));
      return;
    }
    setFormErrors((prev) => ({ ...prev, [message.id]: "" }));
    const payload = createFormSubmissionPayload(message.id, form);
    const sent = await sendMessageToRuntime(payload);
    if (sent) {
      setSubmittedFormIds((prev) => [...prev, message.id]);
      setFormDrafts((prev) => { const next = { ...prev }; delete next[message.id]; return next; });
    }
  }

  /** 判断指定审批请求是否正处于处理中状态。 */
  function isResolvingApproval(approvalId: string) {
    return resolvingApprovalIds.has(approvalId);
  }

  /** 提交审批决定，并在处理期间锁定对应按钮。 */
  async function handleApproval(approvalId: string, decision: ApprovalDecision) {
    if (isResolvingApproval(approvalId)) return;
    setResolvingApprovalIds((prev) => new Set([...prev, approvalId]));
    try {
      await workspace.resolveApproval(approvalId, decision);
    } catch (error) {
      reportChatError(error);
    } finally {
      setResolvingApprovalIds((prev) => { const next = new Set(prev); next.delete(approvalId); return next; });
    }
  }

  /** 批准当前计划并进入执行阶段。 */
  async function handlePlanApprove() {
    try {
      const localDraft = composerDraft;
      const hasLocalDraft = composerDraft.length > 0;
      const executionPrompt = composerDraft.trim() || "请开始执行当前计划。";
      await approveDisplayedSessionPlan();
      const sent = await sendMessageToRuntime(executionPrompt);
      if (sent && hasLocalDraft) {
        setComposerDraft("");
      }
      if (!sent && hasLocalDraft) {
        setComposerDraft(localDraft);
      }
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 把当前补充说明回传给计划模式，并立刻把同一条反馈重新送入规划链路。 */
  async function handlePlanRevise() {
    try {
      const hasLocalDraft = composerDraft.length > 0;
      const feedback = composerDraft.trim() || "请根据最新补充继续完善当前计划。";
      const sent = await sendMessageToRuntime(feedback);
      if (sent && hasLocalDraft) {
        setComposerDraft("");
      }
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 放弃当前计划模式并恢复普通对话流程。 */
  async function handlePlanCancel() {
    try {
      await cancelDisplayedSessionPlanMode();
    } catch (error) {
      reportChatError(error);
    }
  }

  /** 生成会话列表预览文案，优先取最后一条消息。 */
  function previewMessage(item: ChatSession) {
    const last = item.messages.at(-1);
    return last ? textOf(last.content) : "暂无消息";
  }

  // ─── 渲染辅助方法 ───────────────────────────────────────────────────────────

  /** 渲染内联 A2UI 表单字段与提交区域。 */
  function renderUiFields(message: any) {
    const form = message.ui as A2UiForm;
    const isSubmitted = submittedFormIds.includes(message.id);
    return (
      <article
        data-testid={`ui-form-${message.id}`}
        className={`message-form${isSubmitted ? " form-submitted" : ""}`}
      >
        <div className="message-form-header">
          <svg className="form-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <div className="form-title-group">
            <h3 className="message-form-title">{form.title}</h3>
            {form.description && <p className="message-form-description">{form.description}</p>}
          </div>
        </div>
        <fieldset disabled={isSubmitted || isRunBusy} className="message-form-fieldset">
          <div className="message-form-fields">
            {form.fields.map((field) => (
              <label key={`${message.id}-${field.name}`} className="message-form-field">
                <span>
                  {field.label}
                  {field.required && <em className="required-mark"> *</em>}
                </span>
                {field.input === "select" ? (
                  <GlassSelect
                    data-testid={`ui-field-${message.id}-${field.name}`}
                    value={readFormFieldValue(message.id, field.name)}
                    placeholder="请选择"
                    ariaLabel={field.label}
                    disabled={isSubmitted || isRunBusy}
                    options={(field.options ?? []).map((opt: any) => ({
                      label: String(opt.label ?? opt.value ?? ""),
                      value: String(opt.value ?? ""),
                    }))}
                    onChange={(nextValue) => writeFormFieldValue(message.id, field.name, nextValue)}
                  />
                ) : field.input === "textarea" ? (
                  <textarea
                    data-testid={`ui-field-${message.id}-${field.name}`}
                    placeholder={field.placeholder ?? ""}
                    value={readFormFieldValue(message.id, field.name)}
                    rows={3}
                    onChange={(e) => writeFormFieldValue(message.id, field.name, e.target.value)}
                  />
                ) : (
                  <input
                    data-testid={`ui-field-${message.id}-${field.name}`}
                    placeholder={field.placeholder ?? ""}
                    value={readFormFieldValue(message.id, field.name)}
                    onChange={(e) => writeFormFieldValue(message.id, field.name, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          {formErrors[message.id] && (
            <div className="form-inline-error">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {formErrors[message.id]}
            </div>
          )}
          <div className="message-form-footer">
            {!isSubmitted ? (
              <button
                data-testid={`ui-submit-${message.id}`}
                className="primary form-submit-btn"
                onClick={() => void submitA2UiForm(message)}
              >
                {isRunBusy ? "提交中..." : (form.submitLabel ?? "提交表单")}
              </button>
            ) : (
              <div className="form-success-badge">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                已提交
              </div>
            )}
          </div>
        </fieldset>
      </article>
    );
  }

  return (
    <section className="chat-shell">
      <section className="chat-main">
        {/* 顶部栏 */}
        <header className="chat-title-header">
          <div className="header-left">
            {/* 会话下拉选择器 */}
            <div className="session-dropdown-container">
              <button className="session-dropdown-trigger" aria-haspopup="listbox">
                <h1 className="header-title">
                  {associatedScheduleJob ? <span className="session-schedule-badge" aria-hidden="true">⏰</span> : null}
                  {session?.title ?? "暂无会话"}
                </h1>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {associatedScheduleJob ? (
                <div className="session-from-schedule" data-testid="session-from-schedule">
                  来自定时任务「{associatedScheduleJob.title}」
                  <button
                    type="button"
                    className="session-from-schedule__link"
                    onClick={() => navigate(`/time/jobs/${associatedScheduleJob.id}`)}
                  >
                    打开任务详情 →
                  </button>
                </div>
              ) : null}
              <div className="session-dropdown-menu">
                <div className="dropdown-header">历史记录</div>
                <ul data-testid="session-list" className="session-list session-list-dropdown">
                  {displaySessions.map((item: ChatSession) => (
                    <li key={item.id}>
                      <div className={`session-row${item.id === session?.id ? " active" : ""}`}>
                        <button
                          data-testid={`session-item-${item.id}`}
                          className={`session-item${item.id === session?.id ? " active" : ""}`}
                          onClick={() => {
                            void handleSelectDisplaySession(item.id);
                          }}
                        >
                          <div className="session-info">
                            <strong>
                              {(item as { associatedScheduleJobId?: string | null }).associatedScheduleJobId
                                ? <span className="session-schedule-badge" aria-label="来自定时任务" title="来自定时任务">⏰</span>
                                : null}
                              {item.title}
                            </strong>
                            <span>{previewMessage(item)}</span>
                          </div>
                        </button>
                        <button
                          data-testid={`session-delete-${item.id}`}
                          className="session-delete"
                          disabled={isDeletingSession(item.id)}
                          onClick={(e) => void handleDeleteSession(item.id, e.currentTarget)}
                          title="删除会话"
                        >
                          {isDeletingSession(item.id) ? (
                            <span className="loading-dots">...</span>
                          ) : (
                            <svg viewBox="0 0 24 24" width="14" height="14">
                              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="header-right">
            {isSiliconPersonView && (
              <>
                {currentChildAgentTask && (
                  currentChildAgentTask.appendedMessageId ? (
                    <span className="agent-task-append-state" data-testid={`agent-task-appended-${currentChildAgentTask.id}`}>
                      已追加
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`agent-task-append-and-return-${currentChildAgentTask.id}`}
                      className="chat-header-action-btn chat-header-action-btn--primary"
                      onClick={() => void handleAppendAgentTaskResult(currentChildAgentTask, { returnToSource: true })}
                      disabled={!canAppendAgentTaskResult(currentChildAgentTask) || appendingAgentTaskIds.has(currentChildAgentTask.id)}
                      title={canAppendAgentTaskResult(currentChildAgentTask) ? "追加到主聊天并返回" : "无可追加内容"}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
                      </svg>
                      <span>{appendingAgentTaskIds.has(currentChildAgentTask.id) ? "追加中..." : "追加到主聊天并返回"}</span>
                    </button>
                  )
                )}
                <button
                  type="button"
                  data-testid="return-main-chat-button"
                  className="chat-header-action-btn"
                  onClick={handleReturnToMainChat}
                  title="返回主聊天"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
                  </svg>
                  <span>返回主聊天</span>
                </button>
              </>
            )}
            {workspace.modelSwitchNotice && (
              <div
                className="model-switch-inline-notice"
                data-testid="model-switch-inline-notice"
                title={`默认模型已从 ${workspace.modelSwitchNotice.fromName} 切换为 ${workspace.modelSwitchNotice.toName}`}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="model-switch-inline-text">模型已切换，建议新对话</span>
                <button
                  type="button"
                  className="model-switch-inline-action"
                  data-testid="model-switch-inline-new-chat"
                  onClick={() => void createSession()}
                >
                  新建
                </button>
                <button
                  type="button"
                  className="model-switch-inline-dismiss"
                  data-testid="model-switch-inline-dismiss"
                  aria-label="继续当前对话"
                  onClick={() => workspace.dismissModelSwitchNotice()}
                >
                  继续
                </button>
              </div>
            )}
            <div className={`chat-project-runtime${projectPanelOpen ? " is-open" : ""}`} data-testid="chat-project-runtime">
              <button
                type="button"
                className={`chat-project-pill${workspace.currentProjectBinding ? " chat-project-pill--bound" : ""}`}
                data-testid="chat-project-pill"
                aria-haspopup="dialog"
                aria-expanded={projectPanelOpen ? "true" : "false"}
                aria-controls="chat-project-capability-panel"
                title={workspace.currentProjectBinding ? `当前项目：${workspace.currentProjectBinding.name}` : "当前会话未绑定项目"}
                onClick={() => setProjectPanelOpen((current) => !current)}
              >
                <FolderKanban size={14} aria-hidden />
                <span>{workspace.currentProjectBinding?.name ?? "无项目"}</span>
                {workspace.currentProjectBinding && (
                  <span className={`chat-project-state${projectWarningCount > 0 ? " chat-project-state--warn" : ""}`}>
                    {projectWarningCount > 0 ? `警告 ${projectWarningCount}` : "已就绪"}
                  </span>
                )}
              </button>
              <div
                id="chat-project-capability-panel"
                className="chat-project-panel"
                data-testid="chat-project-capability-panel"
                role="dialog"
                aria-label="会话项目能力"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setProjectPanelOpen(false);
                }}
              >
                <header className="chat-project-panel-header">
                  <strong>{workspace.currentProjectBinding?.name ?? "无项目"}</strong>
                  <span>{workspace.currentProjectBinding ? "当前会话能力包来源" : "当前会话只使用我的全局能力"}</span>
                </header>
                <div className="chat-project-panel-groups">
                  {capabilityPanelGroups.map((group) => (
                    <section key={group.id} className="chat-project-panel-group" data-testid={`chat-capability-group-${group.id}`}>
                      <div className="chat-project-panel-group-title">
                        {renderCapabilityGroupIcon(group.icon)}
                        <strong>{group.title}</strong>
                        <span>{group.items.length}</span>
                      </div>
                      {group.items.length > 0 ? (
                        <ul className="chat-project-capability-list">
                          {group.items.slice(0, 6).map((item) => (
                            <li key={item.id}>
                              <span className="chat-project-capability-name">{item.label}</span>
                              <span className="chat-project-capability-status">{item.status}</span>
                              <span className="chat-project-capability-desc">{item.description}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="chat-project-panel-empty">暂无</p>
                      )}
                    </section>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              data-testid="work-files-toggle"
              className={`chat-header-action-btn${showWorkFiles ? " chat-header-action-btn--active" : ""}`}
              aria-expanded={showWorkFiles ? "true" : "false"}
              aria-controls="chat-work-files-drawer"
              disabled={!workFilesScope}
              onClick={() => setShowWorkFiles((current) => !current)}
              title={showWorkFiles ? "关闭文件面板" : "展开文件面板"}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l1.6 2h5.9A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9z" />
              </svg>
              <span>{showWorkFiles ? "关闭文件" : "展开文件"}</span>
            </button>
            <button
              data-testid="new-chat-button"
              className="chat-header-action-btn chat-header-action-btn--primary"
              disabled={creatingSession}
              onClick={() => void createSession()}
              title="新建对话"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>新对话</span>
            </button>
            <button
              type="button"
              data-testid="chat-web-panel-toggle"
              className={`chat-header-action-btn chat-header-icon-btn${webPanelIsOpen ? " chat-header-icon-btn--active" : ""}`}
              aria-label={webPanelIsOpen ? "收起 WebPanel" : "打开 WebPanel"}
              aria-pressed={webPanelIsOpen}
              onClick={handleToggleWebPanel}
              title={webPanelIsOpen ? "收起 WebPanel" : "打开 WebPanel"}
            >
              {webPanelIsOpen ? <PanelRightClose size={15} aria-hidden /> : <PanelRightOpen size={15} aria-hidden />}
            </button>
          </div>
        </header>

        {/* 时间线区域 */}
        {activeReminderBanner && (
          <div className="chat-reminder-banner" data-testid="chat-reminder-banner" role="status">
            <div className="chat-reminder-banner__accent" aria-hidden />
            <div className="chat-reminder-banner__icon" data-testid="chat-reminder-banner-icon" aria-hidden>
              <BellRing size={15} strokeWidth={2} />
            </div>
            <div className="chat-reminder-banner__main">
              <div className="chat-reminder-banner__title-row">
                <span className="chat-reminder-banner__label">系统提醒</span>
                <strong>{activeReminderBanner.title}</strong>
              </div>
              {activeReminderBanner.body ? <span className="chat-reminder-banner__body">{activeReminderBanner.body}</span> : null}
            </div>
            <button
              type="button"
              className="chat-reminder-banner__close"
              aria-label="关闭提醒提示"
              onClick={() => setActiveReminderBanner(null)}
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>
        )}

        <div className={`chat-timeline-container${showWorkFiles ? " chat-timeline-container--with-sidebar" : ""}`}>
          <section
            className="timeline-panel"
            ref={timelinePanelRef as React.RefObject<HTMLElement>}
            onScroll={() => {
              timelineStickToBottomRef.current = isNearBottom();
            }}
          >
            <div className="timeline">

              {/* 上下文压缩警告 */}
              {showContextWarning && (
                <div className="context-limit-warning">
                  <div className="context-limit-warning-content">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>当前对话较长，上下文已多次压缩，回答质量可能下降。建议新建对话继续工作。</span>
                    <div className="context-limit-warning-actions">
                      <button
                        className="btn-new-chat"
                        onClick={async () => {
                          setShowContextWarning(false);
                          await createSession();
                        }}
                      >
                        新建对话
                      </button>
                      <button className="btn-dismiss" onClick={() => setShowContextWarning(false)}>
                        继续当前对话
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 消息列表：虚拟滚动 ── */}
              <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const message = groupedMessages[virtualItem.index];
                  if (!message) return null;
                  const msgCreatedAt = message.isTechnicalGroup
                    ? message.items[0]?.createdAt
                    : message.createdAt;
                  const prevCreatedAt = virtualItem.index > 0
                    ? (groupedMessages[virtualItem.index - 1].isTechnicalGroup
                        ? groupedMessages[virtualItem.index - 1].items[0]?.createdAt
                        : groupedMessages[virtualItem.index - 1].createdAt)
                    : undefined;
                  const showDateSep = msgCreatedAt && (
                    virtualItem.index === 0 || (prevCreatedAt && isDifferentDay(prevCreatedAt, msgCreatedAt))
                  );
                  const virtualItemStyle: React.CSSProperties = {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: "32px",
                  };

                  if (!message.isTechnicalGroup) {
                  const isReasoningOpen = message.role === "assistant" && message.renderedReasoningHtml
                    ? isReasoningPanelOpen(message.id)
                    : false;
                  const reasoningToggleLabel = isReasoningOpen ? "点击折叠" : "点击展开";
                  return (
                    <div
                      key={message.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={virtualItemStyle}
                    >
                    {showDateSep && (
                      <div className="date-separator"><span>{formatDateSeparator(msgCreatedAt)}</span></div>
                    )}
                    <div className={`message-row role-${message.role}`}>
                      <div className="message-avatar">
                        {message.role === "user" ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        ) : message.role === "assistant" ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
                          </svg>
                        )}
                      </div>
                      <div className="message-body">
                        <div className="message-header">
                          {roleLabel(message.role)}
                          {msgCreatedAt && (
                            <span className="message-time" title={formatFullTime(msgCreatedAt)}>
                              {formatMessageTime(msgCreatedAt)}
                            </span>
                          )}
                        </div>

                        {message.role === "assistant" && message.renderedReasoningHtml && (
                          <details
                            data-testid={`reasoning-${message.id}`}
                            className="message-details"
                            open={isReasoningOpen}
                          >
                            <summary
                              className="details-summary"
                              onClick={(event) => {
                                event.preventDefault();
                                handleReasoningPanelToggle(message.id, !isReasoningOpen);
                              }}
                            >
                              <div className="summary-inner">
                                <span className="pulse-dot active"></span>
                                <strong>思考过程</strong>
                              </div>
                              <span className="details-toggle-hint" aria-hidden="true">
                                <span className="details-chevron" data-testid={`reasoning-toggle-icon-${message.id}`}>
                                  {isReasoningOpen ? "▾" : "▸"}
                                </span>
                                <span className="details-toggle-label" data-testid={`reasoning-toggle-label-${message.id}`}>
                                  {reasoningToggleLabel}
                                </span>
                              </span>
                            </summary>
                            <div
                              className="details-content reasoning-content"
                              dangerouslySetInnerHTML={{ __html: message.renderedReasoningHtml }}
                            />
                          </details>
                        )}

                        {message.content && (
                          <InlineFileReferenceContent
                            className={`message-content${(message as any)._isStreaming ? " message-content--streaming" : ""}`}
                            html={message.renderedHtml}
                            baseDirectory={inlineFileBaseDirectory}
                          />
                        )}

                        {message.role === "assistant" && Array.isArray((message as any).tool_calls) && (message as any).tool_calls.length > 0 && (
                          <details className="message-details">
                            <summary className="details-summary">
                              <div className="summary-inner">
                                <span className="pulse-dot"></span>
                                <strong>工具调用</strong>
                                <span style={{ opacity: 0.6, marginLeft: 6 }}>
                                  {((message as any).tool_calls as Array<{ function: { name: string } }>).map((tc) => tc.function.name).join(", ")}
                                </span>
                              </div>
                            </summary>
                            <div className="details-content">
                              {((message as any).tool_calls as Array<{ function: { name: string; arguments: string } }>).map((tc, i) => (
                                <div key={i} className="tool-call-args" style={{ marginBottom: 8 }}>
                                  <div className="tool-call-name" style={{ fontWeight: 600, marginBottom: 2 }}>{tc.function.name}</div>
                                  <pre className="tool-args-json" style={{ fontSize: 12, opacity: 0.8, overflow: "auto", maxHeight: 200 }}>{formatToolArgs(tc.function.arguments)}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {message.role === "assistant" && message.usage && (
                          <span className="token-usage-badge" title={formatTokenUsageBadge(message.usage).title}>
                            {formatTokenUsageBadge(message.usage).label}
                          </span>
                        )}

                        {message.uiSubmitResult && (
                          <article className="form-submission-summary">
                            <div className="summary-header">
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
                              </svg>
                              <span>已提交表单</span>
                            </div>
                            <div className="summary-body">
                              {message.uiSubmitResult.pairs.split("; ").map((pair: string, idx: number) => (
                                <div key={idx} className="summary-pair">
                                  <span className="pair-key">{pair.split("=")[0]}:</span>
                                  <span className="pair-val">{pair.split("=")[1]}</span>
                                </div>
                              ))}
                            </div>
                          </article>
                        )}

                        {shouldRenderInlineA2UiForm(message.ui) && renderUiFields(message)}
                      </div>
                    </div>
                    </div>
                  );
                  } else {
                    // 技术链分组，用于折叠展示工具调用过程。
                    return (
                      <div
                        key={message.id}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        style={virtualItemStyle}
                      >
                      {showDateSep && (
                        <div className="date-separator"><span>{formatDateSeparator(msgCreatedAt)}</span></div>
                      )}
                      <div className="message-row role-tool">
                        <div className="message-avatar">
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
                          </svg>
                        </div>
                        <div
                          className="message-body"
                          data-testid={`execution-chain-group-${message.items[0]?.id ?? message.id}`}
                        >
                          <details className="tool-chain-details" open={isLastTechnicalGroup(virtualItem.index)}>
                            <summary className="tool-chain-summary">
                              <svg className="tool-chain-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                              {activeTools.size > 0 && isLastTechnicalGroup(virtualItem.index) && (
                                <span className="tool-spinner"></span>
                              )}
                              <span className="tool-chain-title">{toolChainTitle(message.items)}</span>
                              <span className="tool-chain-count">{message.items.length} 步</span>
                              {currentRound > 0 && isLastTechnicalGroup(virtualItem.index) && (
                                <span className="tool-chain-round">轮次 {currentRound}</span>
                              )}
                              {msgCreatedAt && (
                                <span className="tool-chain-time" title={formatFullTime(msgCreatedAt)}>
                                  {formatMessageTime(msgCreatedAt)}
                                </span>
                              )}
                            </summary>
                            <ol className="execution-chain-list">
                              {message.items.map((item: ChatMessage) => {
                                const tcId = item.tool_call_id;
                                const timing = tcId ? toolTimings.get(tcId) : undefined;
                                const isActive = tcId ? activeTools.has(tcId) : false;

                                return (
                                  <li
                                    key={item.id}
                                    data-testid={`execution-chain-step-${item.id}`}
                                    className={`execution-chain-step execution-chain-step--${item.role}${isActive ? " is-active" : ""}`}
                                  >
                                    {isActive && <span className="tool-step-spinner"></span>}
                                    <span className="execution-chain-badge">{executionChainBadge(item)}</span>
                                    <div className="execution-chain-main">
                                      {item.role === "assistant" && Array.isArray((item as any).tool_calls) && (item as any).tool_calls.length > 0 ? (
                                        <details className="execution-chain-output">
                                          <summary className="execution-chain-output-summary">
                                            {executionChainSummary(item)}
                                          </summary>
                                          <div className="execution-chain-output-body tool-args-preview">
                                            {((item as any).tool_calls as Array<{ function: { name: string; arguments: string } }>).map((tc, i) => (
                                              <div key={i} className="tool-call-args">
                                                <div className="tool-call-name">{tc.function.name}</div>
                                                <pre className="tool-args-json">{formatToolArgs(tc.function.arguments)}</pre>
                                              </div>
                                            ))}
                                          </div>
                                        </details>
                                      ) : item.role === "tool" ? (
                                        <details className="execution-chain-output">
                                          <summary className="execution-chain-output-summary">
                                            {executionChainSummary(item)}
                                            {timing !== undefined && (
                                              <span className="tool-timing">{timing}ms</span>
                                            )}
                                          </summary>
                                          <div className="execution-chain-output-body">
                                            <ToolLogContent messageId={item.id} content={typeof item.content === "string" ? item.content : (item.content as any[])?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") || ""} />
                                          </div>
                                        </details>
                                      ) : (
                                        <span className="execution-chain-text">{executionChainSummary(item)}</span>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                              {/* 展示仍在执行、尚未产出结果的工具。 */}
                              {isLastTechnicalGroup(virtualItem.index) && Array.from(activeTools.entries()).map(([tcId, info]) => (
                                <li key={`active-${tcId}`} className="execution-chain-step execution-chain-step--active is-active">
                                  <span className="tool-step-spinner"></span>
                                  <span className="execution-chain-badge">执行中</span>
                                  <div className="execution-chain-main">
                                    <span className="execution-chain-text">{info.toolName?.replace(/_/g, ".") ?? info.toolId}</span>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </details>
                        </div>
                      </div>
                      </div>
                    );
                  }
                })}
              </div>

              {/* 等待模型响应中 */}
              {isAwaitingModelResponse && (
                <div className="message-row role-assistant">
                  <div className="message-avatar pending-avatar">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                    </svg>
                  </div>
                  <div className="message-body">
                    <div className="message-header">助手</div>
                    <div className="typing-dots">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              )}

              {/* 审批请求列表 */}
              {sessionApprovalRequests.map((approval: ApprovalRequest) => {
                const externalPathMeta = approval.source === "external-path" ? approval.pathMeta : undefined;
                const isExternalPath = !!externalPathMeta;
                const approvalView = buildApprovalCardViewModel(approval);
                return (
                <div key={approval.id} className="message-row role-system">
                  <div className="message-avatar">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#eab308" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="message-body">
                    <div className="message-header">{isExternalPath ? "需要授权访问工作区外路径" : "需要审批"}</div>
                    <article className="approval-card" data-testid={`approval-card-${approval.id}`}>
                      {isExternalPath ? (
                        <>
                          <h3>
                            {externalPathMeta.operation === "read" ? "读取" : externalPathMeta.operation === "write" ? "写入" : externalPathMeta.operation === "delete" ? "删除" : "执行"}{" "}
                            <code style={{ background: "var(--color-bg-subtle,#1c1d22)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>
                              {externalPathMeta.path}
                            </code>
                          </h3>
                          <p style={{ fontSize: 12, color: "var(--color-text-secondary,#9ca3af)" }}>
                            工具 <strong>{approval.toolId}</strong>
                            {typeof externalPathMeta.size === "number" ? ` · ${(externalPathMeta.size / 1024).toFixed(1)} KB` : ""}
                            {externalPathMeta.isBinary ? " · 二进制" : ""}
                          </p>
                          {isResolvingApproval(approval.id) ? (
                            <div className="approval-loading">
                              <div className="typing-dots"><span></span><span></span><span></span></div>
                              <span>正在提交决策...</span>
                            </div>
                          ) : (
                            <div className="approval-actions">
                              <div className="approval-actions__reject">
                                <button data-testid="approval-action-deny" className="secondary approval-action--danger" onClick={() => void handleApproval(approval.id, "deny")}>拒绝</button>
                                <button data-testid="approval-action-deny-persistent" className="secondary approval-action--danger" onClick={() => void handleApproval(approval.id, "deny-persistent")}>永久拒绝此路径</button>
                              </div>
                              <div className="approval-actions__allow">
                                <button data-testid="approval-action-allow-directory" className="secondary" onClick={() => void handleApproval(approval.id, "allow-directory")}>本目录（始终）</button>
                                <button data-testid="approval-action-allow-session" className="secondary" onClick={() => void handleApproval(approval.id, "allow-session")}>本会话</button>
                                <button data-testid="approval-action-allow-once" className="primary" onClick={() => void handleApproval(approval.id, "allow-once")}>仅此次</button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <h3>是否允许工具 <code>{approval.toolId}</code> 执行？</h3>
                          <div className="approval-meta" aria-label="审批工具信息">
                            <span><b>工具</b><code>{approval.toolId}</code></span>
                            <span><b>来源</b>{approvalView.sourceLabel}</span>
                            <span><b>风险</b>{approvalView.riskLabel}</span>
                          </div>
                          {approvalView.targetText && (
                            <dl className="approval-summary">
                              <dt>{approvalView.targetLabel}</dt>
                              <dd><code>{approvalView.targetText}</code></dd>
                            </dl>
                          )}
                          {approvalView.detailText && (
                            <details className="approval-detail" open>
                              <summary>{approvalView.detailTitle}</summary>
                              <pre>{approvalView.detailText}</pre>
                            </details>
                          )}
                          {isResolvingApproval(approval.id) ? (
                            <div className="approval-loading">
                              <div className="typing-dots"><span></span><span></span><span></span></div>
                              <span>正在提交审批并继续执行...</span>
                            </div>
                          ) : (
                            <div className="approval-actions">
                              <div className="approval-actions__reject">
                                <button data-testid="approval-action-deny" className="secondary approval-action--danger" onClick={() => void handleApproval(approval.id, "deny")}>拒绝</button>
                              </div>
                              <div className="approval-actions__allow">
                                <button data-testid="approval-action-always-allow-tool" className="secondary" onClick={() => void handleApproval(approval.id, "always-allow-tool")}>始终允许此工具</button>
                                <button data-testid="approval-action-allow-session" className="secondary" onClick={() => void handleApproval(approval.id, "allow-session")}>允许本次运行</button>
                                <button data-testid="approval-action-allow-once" className="primary" onClick={() => void handleApproval(approval.id, "allow-once")}>允许一次</button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  </div>
                </div>
                );
              })}

              {/* @ 投递痕迹（轻量系统提示，跟随消息流滚动，5s 后自动消失） */}
              {visibleAgentTasks.length > 0 && (
                <div className="agent-task-thread" data-testid="agent-task-thread">
                  {visibleAgentTasks.map((task) => {
                    const assigneeNames = task.assigneeIds
                      .map((id) => siliconPersonNameById.get(id) ?? id)
                      .join(" / ");
                    const statusLabel = AGENT_TASK_STATUS_LABEL[task.status] ?? task.status;
                    const canCancelTask = task.status === "queued" || task.status === "running" || task.status === "waiting_user";
                    const taskEntry = resolveAgentTaskEntry(task);
                    const isFollowUpOpen = activeAgentTaskFollowUpId === task.id;
                    const followUpDraft = agentTaskFollowUpDrafts[task.id] ?? "";
                    return (
                      <article
                        key={task.id}
                        className={`agent-task-activity agent-task-activity--${task.status}`}
                        data-testid={`agent-task-activity-${task.id}`}
                      >
                        <div className="agent-task-activity-main">
                          <span className={`agent-task-activity-dot agent-task-activity-dot--${task.status}`} />
                          <div className="agent-task-activity-copy">
                            <div className="agent-task-activity-title-row">
                              <span className="agent-task-kicker">Agent Task</span>
                              <span className="agent-task-title">{task.title}</span>
                            </div>
                            <div className="agent-task-meta">
                              <span>{assigneeNames}</span>
                              <span>{new Date(task.createdAt).toLocaleTimeString()}</span>
                              <span className="agent-task-status">{statusLabel}</span>
                            </div>
                            {task.resultSummary && (
                              <div className="agent-task-result">{task.resultSummary}</div>
                            )}
                            {task.error && (
                              <div className="agent-task-error">{task.error}</div>
                            )}
                          </div>
                        </div>
                        <div className="agent-task-actions">
                          <button
                            type="button"
                            className="agent-task-action"
                            data-testid={`agent-task-open-${task.id}`}
                            disabled={!taskEntry}
                            onClick={() => void handleOpenAgentTask(task)}
                          >
                            进入
                          </button>
                          {canCancelTask && (
                            <button
                              type="button"
                              className="agent-task-action"
                              data-testid={`agent-task-cancel-${task.id}`}
                              onClick={() => void handleCancelAgentTask(task.id)}
                            >
                              取消
                            </button>
                          )}
                          <button
                            type="button"
                            className="agent-task-action"
                            data-testid={`agent-task-retry-${task.id}`}
                            onClick={() => void handleRetryAgentTask(task.id)}
                          >
                            重试
                          </button>
                          <button
                            type="button"
                            className="agent-task-action"
                            data-testid={`agent-task-follow-${task.id}`}
                            onClick={() => handleStartAgentTaskFollowUp(task.id)}
                          >
                            追问
                          </button>
                          {task.appendedMessageId ? (
                            <span className="agent-task-action-state" data-testid={`agent-task-appended-${task.id}`}>已追加</span>
                          ) : task.resultSummary && (
                            <button
                              type="button"
                              className="agent-task-action agent-task-action--primary"
                              data-testid={`agent-task-append-${task.id}`}
                              disabled={!canAppendAgentTaskResult(task) || appendingAgentTaskIds.has(task.id)}
                              onClick={() => void handleAppendAgentTaskResult(task, { returnToSource: false })}
                            >
                              {appendingAgentTaskIds.has(task.id) ? "追加中..." : "追加到主聊天"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="agent-task-dismiss"
                            title="隐藏任务提示"
                            aria-label="隐藏任务提示"
                            data-testid={`agent-task-dismiss-${task.id}`}
                            onClick={() => handleDismissAgentTaskCard(task)}
                          >
                            x
                          </button>
                        </div>
                        {isFollowUpOpen && (
                          <div className="agent-task-follow-up" data-testid={`agent-task-follow-panel-${task.id}`}>
                            <textarea
                              className="agent-task-follow-input"
                              data-testid={`agent-task-follow-input-${task.id}`}
                              value={followUpDraft}
                              onChange={(event) => handleChangeAgentTaskFollowUp(task.id, event.target.value)}
                              placeholder="补充追问内容"
                              rows={2}
                            />
                            <div className="agent-task-follow-actions">
                              <button
                                type="button"
                                className="agent-task-action"
                                data-testid={`agent-task-follow-cancel-${task.id}`}
                                onClick={() => handleCancelAgentTaskFollowUp(task.id)}
                              >
                                收起
                              </button>
                              <button
                                type="button"
                                className="agent-task-action agent-task-action--primary"
                                data-testid={`agent-task-follow-submit-${task.id}`}
                                disabled={!followUpDraft.trim()}
                                onClick={() => void handleSubmitAgentTaskFollowUp(task.id)}
                              >
                                发送
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              {dispatchTraces.length > 0 && (
                <div className="dispatch-traces">
                  {dispatchTraces.map((trace) => (
                    <div key={trace.id} className="dispatch-trace-card">
                      <span className="dispatch-trace-dot" />
                      <span className="dispatch-trace-text">
                        已投递给 @{trace.personName}: {trace.content.length > 30 ? `${trace.content.slice(0, 30)}...` : trace.content}
                      </span>
                      <button
                        type="button"
                        className="dispatch-trace-link"
                        onClick={() => workspace.setActiveSiliconPersonId(trace.personId)}
                      >进入对话</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {showWorkFiles && (
            <aside id="chat-work-files-drawer" className="chat-work-files-drawer">
              <WorkFilesPanel
                scope={workFilesScope}
                title="会话文件"
                description="当前对话产生的文件"
              />
            </aside>
          )}
        </div>

        {/* 计划面板 - Codex 风格，紧贴输入框上方 */}
        {!taskPanelDismissed && (
          <PlanStatePanel
            tasks={session?.tasks ?? []}
            interrupts={session?.taskInterrupts ?? []}
            onDismiss={handleDismissTaskPanel}
            onResumeInterrupt={handleResumeTaskInterrupt}
          />
        )}

        {/* ── 后台研究面板 ── */}
        {session?.backgroundTask && session.backgroundTask.status === "in_progress" && (
          <div className="background-task-panel" data-testid="background-task-panel">
            <span className="background-task-label">后台研究进行中</span>
            <button type="button" aria-label="立即刷新" onClick={() => void workspace.pollBackgroundTask()}>立即刷新</button>
            <button type="button" aria-label="取消后台任务" onClick={() => void workspace.cancelBackgroundTask()}>取消后台任务</button>
          </div>
        )}

        {/* ── 引用来源列表 ── */}
        {session?.lastTurnCitations && session.lastTurnCitations.length > 0 && (
          <div className="citation-panel" data-testid="citation-list">
            {session.lastTurnCitations.map((cite: any) => (
              <div key={cite.id} className="citation-item">
                {cite.url ? <a href={cite.url} target="_blank" rel="noreferrer">{cite.title ?? cite.url}</a> : <span>{cite.title ?? cite.filename}</span>}
                {cite.sourceType && <span className="citation-badge">{cite.sourceType}</span>}
                {cite.fileId && <span className="citation-file-id">{cite.fileId}</span>}
                {cite.snippet && <p className="citation-snippet">{cite.snippet}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── 能力轨迹时间线 ── */}
        {session?.lastCapabilityEvents && session.lastCapabilityEvents.length > 0 && (
          <div className="capability-trace" data-testid="capability-trace-timeline">
            {session.lastCapabilityEvents.map((evt: any, idx: number) => (
              <div key={idx} className="capability-trace-item">
                <span className="capability-trace-type">{evt.type}</span>
                {evt.payload?.queries && (evt.payload.queries as string[]).map((q: string, qi: number) => (
                  <span key={qi} className="capability-trace-query">{q}</span>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── 计算机操作卡片 ── */}
        {session?.lastComputerCalls && session.lastComputerCalls.length > 0 && (
          <div className="computer-call-panel" data-testid="computer-call-list">
            {session.lastComputerCalls.map((cc: any) => (
              <div key={cc.id} className="computer-call-card">
                {cc.actions.map((action: any, ai: number) => (
                  <span key={ai} className="computer-action-badge">{action.type}</span>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <footer className="composer-panel">
          <div className="composer-container">
            {/* @ mention 目标指示器 */}
            {mentionTargetSiliconPerson && (
              <div data-testid="mention-target-indicator" className="mention-target-indicator">
                <span className="mention-target-label">投递给</span>
                <span className="mention-target-name">@{mentionTargetSiliconPerson.name}</span>
                <button
                  type="button"
                  className="mention-target-clear"
                  onClick={() => setMentionTargetSiliconPersonId(null)}
                  title="取消投递"
                >
                  &times;
                </button>
              </div>
            )}

            {/* @ mention 弹出菜单 */}
            {mentionMenuOpen && filteredMentions.length > 0 && (
              <div className="slash-menu mention-menu" data-testid="mention-menu">
                {filteredMentions.map((person, idx) => (
                  <div
                    key={person.id}
                    ref={idx === mentionMenuIndex ? (el) => {
                      if (el && typeof el.scrollIntoView === "function") {
                        el.scrollIntoView({ block: "nearest" });
                      }
                    } : undefined}
                    className={`slash-menu-item${idx === mentionMenuIndex ? " active" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); selectMentionItem(person); }}
                    onMouseEnter={() => setMentionMenuIndex(idx)}
                  >
                    <span className="mention-avatar">{(person.name || "?").charAt(0).toUpperCase()}</span>
                    <span className="slash-cmd">{person.name}</span>
                    <span className="slash-desc">{person.description.slice(0, 40)}</span>
                    <span className={`mention-status mention-status-${person.status}`}>{person.status}</span>
                  </div>
                ))}
              </div>
            )}

            {slashMenuOpen && filteredSlash.length > 0 && (
              <div className="slash-menu">
                {filteredSlash.map((item, idx) => {
                  const prev = idx > 0 ? filteredSlash[idx - 1] : null;
                  return (
                    <React.Fragment key={item.id}>
                      {prev && prev.category !== item.category && <div className="slash-divider" />}
                      <div
                        ref={idx === slashIdx ? (el) => {
                          if (el && typeof el.scrollIntoView === "function") {
                            el.scrollIntoView({ block: "nearest" });
                          }
                        } : undefined}
                        className={`slash-menu-item${idx === slashIdx ? " active" : ""}`}
                        onMouseDown={(e) => { e.preventDefault(); selectSlashItem(item); }}
                        onMouseEnter={() => setSlashMenuIndex(idx)}
                      >
                        <span className="slash-cmd">{item.label}</span>
                        <span className="slash-desc">{item.description}</span>
                        {item.category === "project-skill" && <span className="slash-badge slash-badge--project">项目技能</span>}
                        {item.category === "skill" && <span className="slash-badge">我的技能</span>}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {siliconPersonModelMissing && (
              <div className="composer-warn" data-testid="silicon-person-model-missing-banner">
                该员工未配置模型
              </div>
            )}
            <textarea
              ref={composerRef}
              data-testid="composer-input"
              value={composerDraft}
              onChange={(e) => {
                const val = e.target.value;
                setComposerDraft(val);
                // 检测 @ 触发
                const atMatch = val.match(/@(\S*)$/);
                if (atMatch && siliconPersons.length > 0) {
                  setMentionMenuOpen(true);
                  setMentionFilter(atMatch[1] ?? "");
                  setMentionMenuIndex(0);
                } else if (mentionMenuOpen) {
                  setMentionMenuOpen(false);
                  setMentionFilter("");
                }
              }}
              className="composer-input"
              disabled={siliconPersonModelMissing}
              placeholder={
                siliconPersonModelMissing
                  ? "该员工未配置模型，请先在员工设置中选择模型"
                  : (isRunBusy ? "正在响应..." : "输入消息 (Enter 发送, Shift+Enter 换行)，或输入 / 获取快捷命令")
              }
              rows={1}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                {!composerDraft ? (
                  <span className="composer-hints">可用命令: /skill, /cmd, /read, /mcp</span>
                ) : (
                  <span className="composer-hints"></span>
                )}
                {!isSiliconPersonView && (
                  <>
                    <div className="effort-selector" data-testid="effort-selector">
                      {(["low", "medium", "high", "xhigh"] as const).map((level) => (
                        <button
                          key={level}
                          className={`effort-btn${(session?.runtimeIntent as Record<string, unknown> | undefined)?.reasoningEffort === level || (!((session?.runtimeIntent as Record<string, unknown> | undefined)?.reasoningEffort) && level === "medium") ? " active" : ""}`}
                          onClick={() => void updateDisplayedSessionRuntimeIntent({ reasoningEffort: level })}
                          title={level === "low" ? "快速回答" : level === "medium" ? "默认思考" : level === "high" ? "深度推理" : "极深推理"}
                        >
                          {level === "low" ? "快速" : level === "medium" ? "思考" : level === "high" ? "深度" : "极深"}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* Plan Mode 功能暂时隐藏，待后续完善后重新启用 */}
              </div>
              {!isRunBusy ? (
                <button
                  data-testid="composer-submit"
                  className="submit-btn"
                  disabled={!composerDraft.trim() || !session || siliconPersonModelMissing}
                  onClick={() => void submitMessage()}
                  title="发送消息"
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  data-testid="composer-stop"
                  className="stop-btn"
                  disabled={!session || isRunCanceling}
                  onClick={() => void handleStopRun()}
                >
                  <Square size={14} fill="currentColor" strokeWidth={0} />
                </button>
              )}
            </div>
            {sessionUsageSummary.totalTokens > 0 && (
              <div className="session-token-total">
                {sessionUsageSummary.hasCacheUsage
                  ? `会话总计: 输入 ${sessionUsageSummary.promptTokens.toLocaleString()} · 输出 ${sessionUsageSummary.completionTokens.toLocaleString()} · 命中 ${sessionUsageSummary.cacheHitInputTokens.toLocaleString()} · 未命中 ${sessionUsageSummary.cacheMissInputTokens.toLocaleString()} · 写入 ${sessionUsageSummary.cacheWriteInputTokens.toLocaleString()} · 总计 ${sessionUsageSummary.totalTokens.toLocaleString()} tokens`
                  : `会话总计: ${sessionUsageSummary.totalTokens.toLocaleString()} tokens`}
              </div>
            )}
          </div>
        </footer>
      </section>

      {/* Plan Mode 侧边面板 */}
      {!!(session as { planModeState?: { mode?: string } | null } | null)?.planModeState?.mode && (
        <PlanSidePanel
          planState={session?.planState ?? null}
          planModeState={(session as { planModeState?: { mode?: string; approvalStatus?: string; planVersion?: number; currentTaskTitle?: string; currentTaskKind?: string; workflowRun?: { status?: string } | null; workstreams?: Array<{ id: string; label: string; status: string; stepIds: string[] }> } | null } | null)?.planModeState ?? null}
          onApprove={handlePlanApprove}
          onRevise={handlePlanRevise}
          onCancel={handlePlanCancel}
        />
      )}

      {/* 确认弹窗 */}
      {confirmDialog && (
        <div className="confirm-overlay" onClick={closeConfirmDialog}>
          <div
            className="confirm-dialog confirm-dialog--danger"
            data-testid="chat-confirm-dialog"
            data-variant="danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-confirm-title"
            aria-describedby="chat-confirm-message chat-confirm-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-dialog__header">
              <div className="confirm-dialog__icon" data-testid="chat-confirm-dialog-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                </svg>
              </div>
              <div className="confirm-dialog__copy">
                <h3 id="chat-confirm-title" className="confirm-title" data-testid="chat-confirm-dialog-title">删除会话</h3>
                <p id="chat-confirm-message" className="confirm-message">{confirmDialog.message}</p>
                <p id="chat-confirm-detail" className="confirm-detail" data-testid="chat-confirm-dialog-detail">
                  删除后将移除本地会话记录和消息内容，此操作不可撤销。
                </p>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                ref={confirmCancelRef}
                className="confirm-cancel"
                onClick={closeConfirmDialog}
              >
                取消
              </button>
              <button className="confirm-ok" onClick={() => void confirmDialog.onConfirm()}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .chat-shell { display: flex; flex: 1; height: 100%; min-height: 0; }
        .chat-main { flex: 1; display: flex; flex-direction: column; background: var(--bg-base); min-width: 0; position: relative; }
        .chat-title-header { padding: 20px 32px; border-bottom: 1px solid var(--glass-border); background: var(--bg-base); z-index: 30; display: flex; align-items: center; justify-content: space-between; }
        .header-left { display: flex; align-items: center; }
        .session-dropdown-container { position: relative; }
        .session-dropdown-trigger { display: flex; align-items: center; gap: 8px; background: transparent; border: none; cursor: pointer; padding: 8px 12px; margin-left: -12px; border-radius: var(--radius-md); color: var(--text-primary); transition: background 0.2s; }
        .session-dropdown-trigger:hover, .session-dropdown-container:focus-within .session-dropdown-trigger { background: var(--glass-reflection); }
        .header-title { margin: 0; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
        .session-dropdown-menu { position: absolute; top: calc(100% + 8px); left: -12px; width: 320px; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); box-shadow: 0 12px 40px rgba(0,0,0,0.4); opacity: 0; visibility: hidden; transform: translateY(-8px); transition: all 0.2s cubic-bezier(0.16,1,0.3,1); display: flex; flex-direction: column; max-height: 60vh; }
        .session-dropdown-container:hover .session-dropdown-menu, .session-dropdown-container:focus-within .session-dropdown-menu { opacity: 1; visibility: visible; transform: translateY(0); }
        .dropdown-header { padding: 16px; border-bottom: 1px solid var(--glass-border); font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

        /* ── 头部操作按钮 ── */
        .header-right { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
        .chat-header-action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; height: 28px; box-sizing: border-box; border: 1px solid var(--glass-border); border-radius: 8px; background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; text-decoration: none; white-space: nowrap; line-height: 1; }
        .chat-header-action-btn:hover:not(:disabled) { border-color: var(--glass-border-hover); color: var(--text-primary); background: rgba(255,255,255,0.04); }
        .chat-header-action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .chat-header-action-btn--primary { border-color: var(--accent-cyan); color: var(--accent-cyan); background: rgba(16,163,127,0.06); }
        .chat-header-action-btn--primary:hover:not(:disabled) { background: rgba(16,163,127,0.12); border-color: var(--accent-cyan); color: var(--accent-cyan); }
        .chat-header-action-btn--active { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.3); color: #60a5fa; }
        .chat-header-icon-btn { width: 28px; padding: 0; justify-content: center; color: var(--text-muted); }
        .chat-header-icon-btn--active { color: var(--accent-cyan); border-color: rgba(16,163,127,0.34); background: rgba(16,163,127,0.12); }
        .chat-header-icon-btn:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
        .agent-task-append-state { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(34,197,94,0.24); background: rgba(34,197,94,0.08); color: var(--status-green); font-size: 12px; font-weight: 600; }
        .model-switch-inline-notice { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 360px; height: 28px; padding: 0 8px; border: 1px solid rgba(16,163,127,0.28); border-radius: 8px; background: rgba(16,163,127,0.08); color: var(--text-secondary); font-size: 12px; line-height: 1; box-sizing: border-box; }
        .model-switch-inline-notice > svg { flex-shrink: 0; color: var(--accent-cyan); }
        .model-switch-inline-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .model-switch-inline-action, .model-switch-inline-dismiss { flex-shrink: 0; height: 20px; padding: 0 8px; border-radius: 6px; border: 1px solid transparent; font-size: 12px; font-family: inherit; line-height: 1; cursor: pointer; }
        .model-switch-inline-action { background: var(--accent-cyan); color: #000; font-weight: 600; }
        .model-switch-inline-dismiss { background: transparent; border-color: rgba(148,163,184,0.22); color: var(--text-muted); }
        .model-switch-inline-action:hover { opacity: 0.86; }
        .model-switch-inline-dismiss:hover { color: var(--text-primary); border-color: var(--glass-border-hover); background: rgba(255,255,255,0.04); }
        .chat-project-runtime { position: relative; display: inline-flex; }
        .chat-project-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: 230px;
          height: 28px;
          padding: 0 10px;
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          background: rgba(255,255,255,0.025);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
          white-space: nowrap;
        }
        .chat-project-pill > span:first-of-type {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chat-project-pill--bound {
          color: var(--accent-cyan);
          border-color: rgba(16,163,127,0.28);
          background: rgba(16,163,127,0.08);
        }
        .chat-project-state {
          flex-shrink: 0;
          padding: 1px 5px;
          border-radius: 6px;
          background: rgba(34,197,94,0.12);
          color: var(--status-green);
          font-size: 10px;
          line-height: 1.4;
        }
        .chat-project-state--warn {
          background: rgba(245,158,11,0.12);
          color: #fbbf24;
        }
        .chat-project-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 80;
          width: min(480px, calc(100vw - 32px));
          max-height: min(68vh, 620px);
          overflow: auto;
          display: grid;
          gap: 12px;
          padding: 14px;
          border: 1px solid var(--glass-border);
          border-radius: 10px;
          background: var(--bg-card);
          box-shadow: 0 18px 54px rgba(0,0,0,0.42);
          opacity: 0;
          visibility: hidden;
          transform: translateY(-6px);
          transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
        }
        .chat-project-runtime:hover .chat-project-panel,
        .chat-project-runtime:focus-within .chat-project-panel,
        .chat-project-runtime.is-open .chat-project-panel {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }
        .chat-project-panel-header {
          display: grid;
          gap: 3px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--glass-border);
        }
        .chat-project-panel-header strong {
          color: var(--text-primary);
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .chat-project-panel-header span {
          color: var(--text-muted);
          font-size: 11px;
        }
        .chat-project-panel-groups {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .chat-project-panel-group {
          min-width: 0;
          display: grid;
          gap: 8px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px;
          background: rgba(255,255,255,0.025);
        }
        .chat-project-panel-group-title {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-primary);
          font-size: 12px;
        }
        .chat-project-panel-group-title span {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 11px;
        }
        .chat-project-capability-list {
          list-style: none;
          display: grid;
          gap: 7px;
          padding: 0;
          margin: 0;
        }
        .chat-project-capability-list li {
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 2px 8px;
        }
        .chat-project-capability-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
          font-size: 12px;
        }
        .chat-project-capability-status {
          color: var(--accent-cyan);
          font-size: 11px;
          white-space: nowrap;
        }
        .chat-project-capability-desc {
          grid-column: 1 / -1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-size: 11px;
        }
        .chat-project-panel-empty {
          margin: 0;
          color: var(--text-muted);
          font-size: 11px;
        }
        .slash-badge--project {
          color: #93c5fd;
          border-color: rgba(147,197,253,0.24);
          background: rgba(59,130,246,0.08);
        }

        /* ── 时间线容器 (支持文件侧边栏) ── */
        .chat-reminder-banner { display: grid; grid-template-columns: 4px 28px minmax(0, 1fr) 28px; align-items: center; gap: 12px; padding: 10px 28px 10px 0; border-bottom: 1px solid var(--glass-border); background: rgba(16,163,127,0.07); color: var(--text-primary); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
        .chat-reminder-banner__accent { align-self: stretch; width: 4px; background: var(--accent-cyan); box-shadow: 0 0 12px rgba(16,163,127,0.35); }
        .chat-reminder-banner__icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(16,163,127,0.28); border-radius: var(--radius-md); background: rgba(16,163,127,0.10); color: var(--accent-cyan); }
        .chat-reminder-banner__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 13px; }
        .chat-reminder-banner__title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .chat-reminder-banner__main strong { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chat-reminder-banner__label { flex-shrink: 0; color: var(--accent-cyan); font-size: 11px; font-weight: 700; }
        .chat-reminder-banner__body { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chat-reminder-banner__close { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); cursor: pointer; line-height: 1; }
        .chat-reminder-banner__close:hover { border-color: var(--glass-border-hover); color: var(--text-primary); background: rgba(255,255,255,0.06); }
        .chat-reminder-banner__close:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: -2px; }
        .chat-timeline-container { display: flex; flex: 1; overflow: hidden; min-height: 0; }
        .chat-timeline-container--with-sidebar .timeline-panel { border-right: 1px solid var(--glass-border); }
        .chat-work-files-drawer { width: 340px; min-width: 320px; background: color-mix(in srgb, var(--bg-card) 94%, transparent); display: flex; flex-direction: column; flex-shrink: 0; min-height: 0; position: relative; z-index: 5; overflow-y: auto; }
        @media (max-width: 1200px) { .chat-work-files-drawer { width: 300px; min-width: 280px; } }
        .session-list-dropdown { flex: 1; overflow-y: auto; padding: 8px; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
        .session-item { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 12px; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: inherit; text-align: left; cursor: pointer; transition: all 0.2s ease; }
        .session-item:hover { background: var(--glass-reflection); }
        .session-item.active { background: var(--glass-reflection); border-color: var(--glass-border); }
        .session-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
        .session-info strong { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .session-info span { color: var(--text-secondary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .session-row { display: flex; align-items: stretch; gap: 4px; }
        .session-schedule-badge { display: inline-block; margin-right: 6px; font-size: 11px; line-height: 1; vertical-align: baseline; opacity: 0.85; }
        .session-from-schedule { display: inline-flex; align-items: center; gap: 8px; margin: 6px 0 0 -4px; padding: 4px 10px; background: rgba(16, 163, 127, 0.08); border: 1px solid rgba(16, 163, 127, 0.25); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 11px; }
        .session-from-schedule__link { background: transparent; border: 0; padding: 0; color: var(--accent-cyan); font-size: 11px; font-weight: 600; cursor: pointer; }
        .session-from-schedule__link:hover { text-decoration: underline; }
        .session-delete { width: 32px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); border: 1px solid transparent; background: transparent; color: var(--text-muted); cursor: pointer; opacity: 0; transition: all 0.2s ease; }
        .session-row:hover .session-delete, .session-row .session-delete:focus-within { opacity: 1; }
        .session-delete:hover:not(:disabled) { background: rgba(239,68,68,0.1); color: #ef4444; }
        .timeline-panel { flex: 1; overflow-y: auto; padding: 32px 48px; }
        .timeline { display: flex; flex-direction: column; gap: 32px; max-width: 1200px; margin: 0 auto; }
        .message-row { display: flex; align-items: flex-start; gap: 16px; width: 100%; }
        .message-avatar { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--bg-card); border: 1px solid var(--glass-border); color: var(--text-primary); }
        .role-assistant .message-avatar { background: var(--glass-reflection); border-color: var(--glass-border); color: var(--accent-cyan); }
        .role-user { flex-direction: row-reverse; }
        .role-user .message-body { align-items: flex-end; max-width: 72%; }
        .role-user .message-header { justify-content: flex-end; margin-right: 0; }
        .role-user .message-content { background: var(--accent-soft, rgba(64, 180, 220, 0.08)); padding: 10px 14px; border-radius: var(--radius-xl); border: 1px solid var(--glass-border); }
        .role-user .message-avatar { background: transparent; border-color: var(--glass-border); color: var(--text-primary); }
        .pending-avatar { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
        .message-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
        .message-header { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; display: flex; align-items: baseline; gap: 8px; }
        .message-time { font-size: 11px; font-weight: 400; color: var(--text-muted); cursor: default; }
        .tool-chain-time { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--text-muted); cursor: default; }
        .date-separator { display: flex; align-items: center; gap: 16px; padding: 8px 0; }
        .date-separator::before, .date-separator::after { content: ""; flex: 1; height: 1px; background: var(--glass-border); }
        .date-separator span { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
        .message-content { line-height: 1.7; font-size: 14px; color: var(--text-primary); }
        .message-content--streaming { white-space: pre-wrap; word-break: break-word; }
        .message-content p { margin: 0 0 16px; }
        .message-content p:last-child { margin-bottom: 0; }
        .message-content ul, .message-content ol { margin: 0 0 16px; padding-left: 24px; }
        .message-content li { margin-bottom: 6px; }
        .message-content code { background: var(--glass-reflection); padding: 3px 6px; border-radius: 4px; font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size: 0.85em; color: var(--accent-cyan); }
        .message-content pre { background: var(--bg-sidebar); padding: 16px; border-radius: var(--radius-lg); overflow-x: auto; margin: 16px 0; border: 1px solid var(--glass-border); }
        .message-content pre code { background: transparent; padding: 0; color: inherit; }
        .message-content code:has(.inline-file-ref) {
          background: transparent;
          padding: 0;
        }
        .message-content .inline-file-ref {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 20px;
          margin: 0 1px;
          padding: 1px 6px;
          border: 1px solid rgba(103, 232, 249, 0.18);
          border-radius: 5px;
          background: rgba(103, 232, 249, 0.07);
          color: var(--accent-cyan);
          font: inherit;
          font-size: 0.92em;
          cursor: pointer;
          vertical-align: baseline;
          white-space: nowrap;
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
        }
        .message-content .inline-file-ref::before {
          content: "";
          width: 7px;
          height: 9px;
          border: 1px solid currentColor;
          border-radius: 2px;
          opacity: 0.82;
          flex-shrink: 0;
        }
        .message-content .inline-file-ref:hover,
        .message-content .inline-file-ref:focus-visible {
          border-color: rgba(103, 232, 249, 0.5);
          background: rgba(103, 232, 249, 0.14);
          color: var(--text-primary);
          outline: none;
        }
        .message-content .inline-file-ref[data-state="loading"] {
          cursor: progress;
          opacity: 0.78;
        }
        .message-content .inline-file-ref[data-state="missing"] {
          border-color: rgba(248, 113, 113, 0.35);
          background: rgba(248, 113, 113, 0.08);
          color: #fca5a5;
        }
        .message-content .inline-file-ref[data-state="missing"]::after {
          content: attr(data-error);
          margin-left: 2px;
          font-size: 0.78em;
          color: #fecaca;
        }
        .message-content h1, .message-content h2, .message-content h3 { margin: 24px 0 12px; color: var(--text-primary); font-weight: 600; }
        .message-content blockquote { border-left: 4px solid var(--accent-cyan); margin: 16px 0; padding: 8px 0 8px 16px; color: var(--text-secondary); background: var(--glass-reflection); border-radius: 0 var(--radius-md) var(--radius-md) 0; }
        .message-details { background: rgba(255,255,255,0.02); border: 1px solid transparent; border-radius: var(--radius-md); overflow: hidden; margin-bottom: 12px; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
        .message-details:not([open]):hover { background: var(--glass-reflection); border-color: var(--glass-border); }
        .message-details[open] { background: var(--bg-card); border-color: var(--glass-border); box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
        .details-summary { padding: 10px 16px; cursor: pointer; list-style: none; user-select: none; font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; justify-content: space-between; transition: color 0.2s; }
        .details-summary:hover { color: var(--text-primary); }
        .details-summary::-webkit-details-marker { display: none; }
        .summary-inner { display: flex; align-items: center; gap: 8px; }
        .details-toggle-hint { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 11px; letter-spacing: 0.02em; }
        .details-chevron { font-size: 12px; line-height: 1; color: var(--text-secondary); }
        .details-toggle-label { white-space: nowrap; }
        .message-details[open] .details-toggle-hint { color: var(--accent-cyan); }
        .message-details[open] .details-chevron { color: var(--accent-cyan); }
        .details-content { padding: 16px; border-top: 1px solid var(--glass-border); font-size: 13px; color: var(--text-secondary); line-height: 1.6; background: rgba(0,0,0,0.1); }
        .reasoning-content p { margin: 0 0 12px; }
        .reasoning-content p:last-child { margin-bottom: 0; }
        .reasoning-content ul, .reasoning-content ol { margin: 0 0 12px; padding-left: 22px; }
        .reasoning-content li { margin-bottom: 4px; }
        .reasoning-content code { background: rgba(255,255,255,0.06); padding: 2px 5px; border-radius: 3px; font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size: 0.85em; color: var(--accent-cyan); }
        .reasoning-content pre { background: var(--bg-sidebar); padding: 14px; border-radius: var(--radius-md); overflow-x: auto; margin: 12px 0; border: 1px solid var(--glass-border); }
        .reasoning-content pre code { background: transparent; padding: 0; color: inherit; }
        .reasoning-content h1, .reasoning-content h2, .reasoning-content h3 { margin: 18px 0 8px; color: var(--text-primary); font-weight: 600; font-size: 14px; }
        .reasoning-content h1 { font-size: 16px; }
        .reasoning-content h2 { font-size: 15px; }
        .reasoning-content blockquote { border-left: 3px solid rgba(45,212,191,0.4); margin: 12px 0; padding: 6px 0 6px 14px; color: var(--text-muted); background: rgba(255,255,255,0.02); border-radius: 0 var(--radius-md) var(--radius-md) 0; }
        .reasoning-content strong { color: var(--text-primary); }
        .reasoning-content a { color: var(--accent-cyan); text-decoration: none; }
        .reasoning-content a:hover { text-decoration: underline; }
        .reasoning-content table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
        .reasoning-content th, .reasoning-content td { padding: 6px 10px; border: 1px solid var(--glass-border); text-align: left; }
        .reasoning-content th { background: rgba(255,255,255,0.04); color: var(--text-primary); font-weight: 600; }
        .reasoning-content hr { border: none; border-top: 1px solid var(--glass-border); margin: 14px 0; }
        .tool-chain-details { width: 100%; }
        .tool-chain-summary { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px 12px; border-radius: var(--radius-md); background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 13px; user-select: none; transition: all 0.2s ease; list-style: none; }
        .tool-chain-summary::-webkit-details-marker { display: none; }
        .tool-chain-summary:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .tool-chain-chevron { flex-shrink: 0; transition: transform 0.2s ease; }
        .tool-chain-details[open] .tool-chain-chevron { transform: rotate(180deg); }
        .tool-chain-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tool-chain-count { flex-shrink: 0; padding: 1px 8px; border-radius: 999px; background: var(--glass-reflection); font-size: 11px; font-weight: 600; }
        .tool-chain-round { flex-shrink: 0; padding: 1px 8px; border-radius: 999px; background: rgba(45,212,191,0.15); color: var(--accent-cyan); font-size: 11px; font-weight: 600; }
        .tool-spinner { width: 14px; height: 14px; border: 2px solid var(--glass-border); border-top-color: var(--accent-cyan); border-radius: 50%; animation: tool-spin 0.8s linear infinite; flex-shrink: 0; }
        .tool-step-spinner { width: 12px; height: 12px; border: 2px solid var(--glass-border); border-top-color: var(--accent-cyan); border-radius: 50%; animation: tool-spin 0.8s linear infinite; flex-shrink: 0; margin-top: 2px; }
        @keyframes tool-spin { to { transform: rotate(360deg); } }
        .tool-timing { margin-left: 8px; padding: 1px 6px; border-radius: 999px; background: rgba(255,255,255,0.05); color: var(--text-muted); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .tool-args-preview { padding: 8px 0; }
        .tool-call-args { margin-bottom: 8px; }
        .tool-call-name { font-size: 12px; font-weight: 600; color: var(--accent-cyan); margin-bottom: 4px; }
        .tool-args-json { font-size: 12px; line-height: 1.5; color: var(--text-secondary); background: var(--bg-sidebar); padding: 8px 12px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); margin: 0; overflow-x: auto; max-height: 200px; white-space: pre-wrap; word-break: break-word; }
        .execution-chain-list { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; }
        .execution-chain-step { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; border-radius: var(--radius-md); border: 1px solid transparent; background: rgba(255,255,255,0.02); border-left: 2px solid var(--glass-border); }
        .execution-chain-step.is-active { background: rgba(45,212,191,0.06); border-left-color: var(--accent-cyan); border-color: rgba(45,212,191,0.15); }
        .execution-chain-step--active { background: rgba(45,212,191,0.06); border-left-color: var(--accent-cyan); }
        .execution-chain-step--tool { background: rgba(45,212,191,0.04); border-left-color: var(--accent-cyan); }
        .execution-chain-badge { min-width: 44px; padding: 2px 8px; border-radius: 999px; background: var(--glass-reflection); color: var(--text-secondary); font-size: 11px; font-weight: 600; text-align: center; flex-shrink: 0; }
        .execution-chain-main { min-width: 0; flex: 1; }
        .execution-chain-text { display: block; color: var(--text-primary); font-size: 13px; line-height: 1.6; word-break: break-word; }
        .execution-chain-output { width: 100%; }
        .execution-chain-output-summary { cursor: pointer; color: var(--text-primary); font-size: 13px; line-height: 1.6; word-break: break-word; }
        .execution-chain-output-body { margin-top: 10px; }
        .approval-card { display: grid; gap: 12px; padding: 20px; border-radius: var(--radius-lg); border: 1px solid var(--glass-border); background: var(--bg-card); margin-top: 8px; }
        .approval-card h3 { font-size: 15px; font-weight: 600; margin: 0; }
        .approval-card h3 code { font-size: 13px; color: var(--accent-cyan); background: rgba(45,212,191,0.1); border: 1px solid rgba(45,212,191,0.18); border-radius: 6px; padding: 2px 7px; }
        .approval-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .approval-meta span { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.04); color: var(--text-secondary); font-size: 12px; }
        .approval-meta b { color: var(--text-primary); font-weight: 600; }
        .approval-meta code { color: var(--accent-cyan); font-size: 12px; }
        .approval-summary { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 12px; margin: 0; padding: 10px 12px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); }
        .approval-summary dt { color: var(--text-secondary); font-size: 12px; font-weight: 600; }
        .approval-summary dd { min-width: 0; margin: 0; color: var(--text-primary); font-size: 13px; line-height: 1.5; }
        .approval-summary code { white-space: pre-wrap; word-break: break-word; }
        .approval-detail { border-radius: var(--radius-md); border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); overflow: hidden; }
        .approval-detail summary { cursor: pointer; padding: 9px 12px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
        .approval-detail pre { margin: 0; max-height: 180px; overflow: auto; padding: 10px 12px; border-top: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
        .approval-actions { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; margin-top: 4px; }
        .approval-actions__reject, .approval-actions__allow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .approval-actions__allow { justify-content: flex-end; margin-left: auto; }
        .approval-action--danger { color: #fca5a5; border-color: rgba(248, 113, 113, 0.28); }
        .approval-action--danger:hover:not(:disabled) { background: rgba(248, 113, 113, 0.09); color: #fecaca; }
        .approval-loading { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(255,255,255,0.05); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 13px; font-weight: 500; }
        .message-form { margin-top: 16px; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.15); transition: all 0.3s ease; }
        .message-form-header { padding: 16px 20px; border-bottom: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); display: flex; align-items: flex-start; gap: 12px; }
        .form-icon { color: var(--accent-cyan); margin-top: 2px; flex-shrink: 0; }
        .form-title-group { display: flex; flex-direction: column; gap: 4px; }
        .message-form-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--text-primary); }
        .message-form-description { color: var(--text-secondary); font-size: 13px; margin: 0; line-height: 1.5; }
        .message-form-fieldset { padding: 20px; border: none; margin: 0; transition: opacity 0.3s ease; }
        .message-form-fieldset:disabled { opacity: 0.6; }
        .message-form-fields { display: flex; flex-direction: column; gap: 16px; }
        .message-form-field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
        .message-form-field input, .message-form-field textarea, .message-form-field select { width: 100%; padding: 12px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--bg-base); color: var(--text-primary); font-size: 14px; transition: all 0.2s ease; }
        .message-form-field input:focus, .message-form-field textarea:focus, .message-form-field select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 2px rgba(45,212,191,0.15); outline: none; }
        .form-inline-error { margin-top: 16px; display: flex; align-items: center; gap: 8px; color: #ef4444; font-size: 13px; background: rgba(239,68,68,0.1); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid rgba(239,68,68,0.2); }
        .message-form-footer { margin-top: 24px; display: flex; justify-content: flex-end; }
        .form-submit-btn { width: 100%; display: flex; justify-content: center; align-items: center; padding: 12px 16px; }
        .form-success-badge { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 16px; background: rgba(16,185,129,0.1); color: #10b981; border-radius: var(--radius-md); border: 1px solid rgba(16,185,129,0.2); font-size: 14px; font-weight: 500; }
        .composer-panel { padding: 24px 48px; background: linear-gradient(transparent, var(--bg-base) 15%); position: sticky; bottom: 0; }
        .composer-container { position: relative; max-width: 1200px; margin: 0 auto; background: rgba(22, 22, 26, 0.4); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid var(--glass-border); border-top-color: rgba(255,255,255,0.12); border-radius: var(--radius-lg); box-shadow: 0 4px 24px rgba(0,0,0,0.6); display: flex; flex-direction: column; transition: border-color 0.2s; }
        .composer-container:focus-within { border-color: var(--text-muted); }
        .slash-menu { position: absolute; bottom: 100%; left: 0; right: 0; max-height: 280px; overflow-y: auto; background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); box-shadow: 0 -8px 32px rgba(0,0,0,0.3); margin-bottom: 8px; padding: 6px; z-index: 100; }
        .slash-menu-item { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: var(--radius-md, 8px); cursor: pointer; transition: background 0.15s; }
        .slash-menu-item:hover, .slash-menu-item.active { background: var(--glass-reflection); }
        .slash-cmd { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size: 13px; font-weight: 600; color: var(--accent-cyan); min-width: 80px; }
        .slash-desc { font-size: 13px; color: var(--text-secondary); flex: 1; }
        .slash-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-muted); flex-shrink: 0; }
        .slash-divider { height: 1px; background: var(--glass-border); margin: 4px 8px; }
        .composer-input { width: 100%; padding: 16px 16px 12px; background: transparent; border: none; color: var(--text-primary); font-size: 14px; line-height: 1.6; resize: none; outline: none; min-height: 60px; font-family: inherit; }
        .composer-input::placeholder { color: var(--text-muted); }
        .composer-input:disabled { cursor: not-allowed; opacity: 0.6; }
        .composer-warn { margin: 8px 12px 0; padding: 6px 10px; border-radius: var(--radius-md, 7px); background: rgba(255, 90, 90, 0.08); border: 1px solid rgba(255, 90, 90, 0.24); color: var(--status-red); font-size: 12px; }
        .composer-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 16px 16px; }
        .composer-toolbar-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
        .composer-hints { font-size: 12px; color: var(--text-muted); }
        .effort-selector { display: flex; gap: 2px; background: rgba(255,255,255,0.04); border-radius: 8px; padding: 2px; border: 1px solid var(--glass-border); }
        .effort-btn { font-size: 11px; font-weight: 500; padding: 3px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .effort-btn:hover { color: var(--text-secondary); background: rgba(255,255,255,0.04); }
        .effort-btn.active { color: var(--accent-cyan); background: rgba(16,163,127,0.15); }
        .effort-btn.active:hover { background: rgba(16,163,127,0.2); }
        .submit-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border-radius: 10px; background: transparent; color: var(--accent-cyan); border: 1px solid var(--accent-cyan); cursor: pointer; transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
        .submit-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16,163,127,0.15); background: rgba(16,163,127,0.1); }
        .submit-btn:active:not(:disabled) { transform: translateY(0); }
        .submit-btn:disabled { background: var(--bg-sidebar); color: var(--text-muted); box-shadow: none; border: 1px solid var(--glass-border); opacity: 1; cursor: not-allowed; transform: none; }
        .stop-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border-radius: 10px; background: var(--text-primary); color: var(--bg-base); border: none; cursor: pointer; animation: stop-pulse 1.2s cubic-bezier(0.4,0,0.2,1) infinite; transition: transform 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s cubic-bezier(0.4,0,0.2,1), background 0.2s cubic-bezier(0.4,0,0.2,1); }
        .stop-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(255,255,255,0.16); background: #f5f5f5; }
        .stop-btn:active:not(:disabled) { transform: translateY(0); }
        .stop-btn:disabled { cursor: not-allowed; opacity: 0.7; box-shadow: none; transform: none; }
        @keyframes stop-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .primary, .secondary { padding: 8px 16px; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--glass-border); transition: all 0.2s ease; }
        .primary { background: var(--text-primary); color: var(--bg-base); border-color: var(--text-primary); }
        .primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .secondary { background: transparent; color: var(--text-primary); }
        .secondary:hover:not(:disabled) { background: var(--glass-reflection); }
        .primary:disabled, .secondary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
        .pulse-dot.active { background: var(--accent-cyan); box-shadow: 0 0 8px var(--accent-cyan); }
        .typing-dots { display: inline-flex; gap: 6px; padding: 12px 0; }
        .typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: typing-bounce 1.4s infinite ease-in-out; }
        .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
        .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing-bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }
        .form-submission-summary { background: var(--bg-card); border: 1px solid rgba(16,185,129,0.2); border-radius: var(--radius-lg); overflow: hidden; max-width: 90%; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-top: 4px; }
        .role-user .form-submission-summary { border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg); border-color: rgba(16,185,129,0.3); }
        .summary-header { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: rgba(16,185,129,0.1); color: #10b981; font-size: 13px; font-weight: 600; border-bottom: 1px solid rgba(16,185,129,0.1); }
        .summary-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
        .summary-pair { display: flex; font-size: 13px; line-height: 1.5; }
        .pair-key { color: var(--text-secondary); width: 90px; flex-shrink: 0; }
        .pair-val { color: var(--text-primary); font-weight: 500; word-break: break-all; }
        .tool-log-text { word-break: break-all; }
        .tool-directory-tree { width: 100%; display: grid; gap: 10px; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.2); background: linear-gradient(135deg, rgba(14,116,144,0.12), rgba(15,23,42,0.08)), rgba(15,23,42,0.18); }
        .tool-directory-root { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
        .tool-directory-root strong { color: var(--text-primary); font-size: 13px; }
        .tool-directory-root span, .tool-directory-meta { color: var(--text-muted); font-size: 11px; }
        .tool-directory-entries { list-style: none; margin: 0; padding: 0 0 0 14px; display: grid; gap: 8px; border-left: 1px solid rgba(148,163,184,0.25); }
        .tool-directory-entry { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; position: relative; min-height: 22px; }
        .tool-directory-kind { min-width: 34px; padding: 1px 6px; border-radius: 999px; background: rgba(15,23,42,0.45); color: #cbd5e1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; text-align: center; }
        .tool-directory-name { color: var(--text-primary); font-weight: 500; word-break: break-word; }
        .required-mark { font-style: normal; color: #ef4444; }
        .token-usage-badge { display: inline-flex; align-items: center; padding: 1px 6px; margin-left: 8px; font-size: 11px; color: var(--text-muted, #71717a); background: rgba(255,255,255,0.04); border-radius: 4px; cursor: help; }
        .session-token-total { padding: 4px 12px; font-size: 11px; color: var(--text-muted, #71717a); text-align: right; }
        .confirm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.64); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(12px); animation: confirm-fadein 0.15s ease; padding: 24px; }
        @keyframes confirm-fadein { from { opacity: 0; } to { opacity: 1; } }
        .confirm-dialog { width: min(440px, calc(100vw - 48px)); background: linear-gradient(180deg, rgba(30,30,34,0.96), rgba(18,18,22,0.98)); border: 1px solid rgba(255,255,255,0.12); border-radius: var(--radius-xl); padding: 20px; box-shadow: var(--shadow-modal, 0 24px 80px rgba(0,0,0,0.55)); animation: confirm-slidein 0.2s cubic-bezier(0.16,1,0.3,1); }
        .confirm-dialog--danger { border-color: rgba(239,68,68,0.32); box-shadow: 0 24px 80px rgba(0,0,0,0.58), 0 0 0 1px rgba(239,68,68,0.08); }
        @keyframes confirm-slidein { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: none; } }
        .confirm-dialog__header { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 14px; align-items: flex-start; }
        .confirm-dialog__icon { width: 42px; height: 42px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-lg); color: var(--status-red); background: rgba(239,68,68,0.11); border: 1px solid rgba(239,68,68,0.28); }
        .confirm-dialog__copy { min-width: 0; display: grid; gap: 7px; }
        .confirm-title { margin: 0; color: var(--text-primary); font-size: 16px; font-weight: 700; line-height: 1.3; letter-spacing: 0; }
        .confirm-message { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); line-height: 1.5; overflow-wrap: anywhere; }
        .confirm-detail { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
        .confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .confirm-cancel, .confirm-ok { min-height: 34px; padding: 8px 16px; border-radius: var(--radius-md); font-size: 13px; font-weight: 700; cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s; border: 1px solid var(--glass-border); }
        .confirm-cancel { background: rgba(255,255,255,0.03); color: var(--text-secondary); }
        .confirm-cancel:hover { background: rgba(255,255,255,0.07); color: var(--text-primary); border-color: var(--glass-border-hover); }
        .confirm-ok { background: rgba(239,68,68,0.14); color: #fecaca; border-color: rgba(239,68,68,0.44); }
        .confirm-ok:hover { background: rgba(239,68,68,0.22); color: #fff; border-color: rgba(239,68,68,0.68); transform: translateY(-1px); }

        .mention-target-indicator { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--glass-border); font-size: 13px; }
        .mention-target-label { color: var(--text-muted); }
        .mention-target-name { color: var(--accent-cyan); font-weight: 600; }
        .mention-target-clear { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; transition: color 0.15s; }
        .mention-target-clear:hover { color: var(--status-red); }
        .mention-avatar { width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)); border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--text-primary); flex-shrink: 0; }
        .mention-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-muted); flex-shrink: 0; }
        .mention-status-running { color: var(--accent-cyan); border-color: rgba(16,163,127,0.3); }
        .mention-status-needs_approval { color: var(--status-yellow); border-color: rgba(245,158,11,0.3); }
        .mention-status-done { color: var(--status-green); border-color: rgba(34,197,94,0.3); }
        .mention-status-error { color: var(--status-red); border-color: rgba(239,68,68,0.3); }
        .agent-task-thread { display: grid; gap: 6px; max-width: 1200px; margin: 0 auto; padding: 6px 48px; }
        .agent-task-activity { width: min(780px, 100%); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 7px 8px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.16); background: rgba(255,255,255,0.025); }
        .agent-task-activity--waiting_user, .agent-task-activity--failed { border-color: rgba(245,158,11,0.28); }
        .agent-task-activity-main { min-width: 0; display: flex; align-items: flex-start; gap: 8px; }
        .agent-task-activity-copy { min-width: 0; display: grid; gap: 3px; }
        .agent-task-activity-title-row { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
        .agent-task-activity-dot { width: 7px; height: 7px; margin-top: 7px; border-radius: 999px; background: var(--text-muted); flex-shrink: 0; }
        .agent-task-activity-dot--queued, .agent-task-activity-dot--running { background: var(--accent-cyan); }
        .agent-task-activity-dot--waiting_user, .agent-task-activity-dot--failed { background: var(--status-yellow); }
        .agent-task-activity-dot--succeeded { background: var(--status-green); }
        .agent-task-kicker { flex-shrink: 0; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
        .agent-task-status { flex-shrink: 0; color: var(--accent-cyan); font-size: 11px; font-weight: 600; }
        .agent-task-dismiss { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 6px; background: transparent; color: var(--text-muted); font-family: inherit; font-size: 14px; line-height: 1; cursor: pointer; }
        .agent-task-dismiss:hover { background: rgba(148,163,184,0.14); color: var(--text-primary); }
        .agent-task-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 12px; font-weight: 650; line-height: 1.35; }
        .agent-task-meta { display: flex; flex-wrap: wrap; gap: 6px 10px; color: var(--text-muted); font-size: 11px; line-height: 1.35; }
        .agent-task-result, .agent-task-error { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: 11px; line-height: 1.35; }
        .agent-task-error { color: #fca5a5; }
        .agent-task-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
        .agent-task-action { min-height: 24px; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.22); background: rgba(148,163,184,0.06); color: var(--text-primary); font-size: 11px; font-family: inherit; cursor: pointer; }
        .agent-task-action:hover:not(:disabled) { border-color: rgba(16,163,127,0.38); background: rgba(16,163,127,0.1); }
        .agent-task-action:disabled { cursor: not-allowed; opacity: 0.45; }
        .agent-task-action--primary { border-color: rgba(16,163,127,0.35); color: var(--accent-cyan); }
        .agent-task-action-state { min-height: 24px; display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(34,197,94,0.22); background: rgba(34,197,94,0.08); color: var(--status-green); font-size: 11px; font-weight: 600; }
        .agent-task-follow-up { display: grid; gap: 8px; margin-top: 10px; }
        .agent-task-follow-input { width: 100%; min-height: 56px; resize: vertical; padding: 8px 9px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.22); background: rgba(0,0,0,0.14); color: var(--text-primary); font-family: inherit; font-size: 12px; line-height: 1.45; outline: none; }
        .agent-task-follow-input:focus { border-color: rgba(16,163,127,0.42); box-shadow: 0 0 0 2px rgba(16,163,127,0.08); }
        .agent-task-follow-actions { display: flex; justify-content: flex-end; gap: 6px; }
        .dispatch-traces { display: flex; flex-direction: column; gap: 4px; max-width: 1200px; margin: 0 auto; padding: 4px 48px; }
        .dispatch-trace-card { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: transparent; border: none; border-radius: 0; font-size: 12px; line-height: 1.4; color: var(--text-muted); opacity: 0.85; }
        .dispatch-trace-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-cyan); flex-shrink: 0; }
        .dispatch-trace-text { flex: 1; min-width: 0; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dispatch-trace-link { flex-shrink: 0; color: var(--accent-cyan); font-size: 11px; font-weight: 500; text-decoration: none; transition: opacity 0.15s; background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; }
        .dispatch-trace-link:hover { opacity: 0.8; text-decoration: underline; }

        /* ── 上下文压缩警告 ── */
        .context-limit-warning { padding: 0 48px 16px; max-width: 1200px; margin: 0 auto; }
        .context-limit-warning-content { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25); border-radius: var(--radius-md); font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
        .context-limit-warning-content > svg { flex-shrink: 0; color: #f59e0b; }
        .context-limit-warning-content > span { flex: 1; min-width: 200px; }
        .context-limit-warning-actions { display: flex; gap: 8px; flex-shrink: 0; }
        .btn-new-chat { padding: 5px 14px; border-radius: var(--radius-sm); border: none; background: var(--accent-cyan); color: #000; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
        .btn-new-chat:hover { opacity: 0.85; }
        .btn-dismiss { padding: 5px 14px; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: background 0.15s; }
        .btn-dismiss:hover { background: var(--glass-reflection); }
        .model-switch-notice { background: rgba(16,163,127,0.08); border-color: rgba(16,163,127,0.25); }
        .model-switch-notice > svg { color: var(--accent-cyan); }
        .model-switch-notice strong { color: var(--text-primary); font-weight: 600; }
      `}</style>
    </section>
  );
}
