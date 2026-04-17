import { ipcMain, webContents } from "electron";
import { randomUUID } from "node:crypto";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

import type { ChatSession, ChatMessage as SessionChatMessage, ExecutionIntent, SkillDefinition, ApprovalRequest, ApprovalPolicy, ModelProfile, ApprovalDecision, ApprovalMode, PersonalPromptProfile, ResolvedExecutionPlan, ResolvedSessionRuntimeIntent, SessionRuntimeIntent, StructuredPlan, PlanModeState, PlanWorkstream, WorkflowRunSummary, ChatRunPhase, ChatRunStatus, ChatRunRuntimeStatusPayload, Task, ExperienceProfileId, PromptSection, ProviderFamily, TurnOutcome, McpTool } from "@shared/contracts";
import { EventType, SESSION_RUNTIME_VERSION, ToolRiskCategory, shouldRequestApproval, allowsExternalPaths } from "@shared/contracts";
import { buildTaskDisplayItems } from "@shared/task-logical";

import type { ActiveSessionRun, RuntimeContext } from "../services/runtime-context";
import type { ChatMessage as ModelChatMessage, ChatMessageContent, ResolvedToolCall } from "../services/model-client";
import { saveSession, saveSiliconPerson, saveWorkflowRun, deleteWorkflowRunFile, deleteSessionFiles } from "../services/state-persistence";
import { trackSave } from "../services/pending-saves";
import { buildToolSchemas, functionNameToToolId, buildToolLabel } from "../services/tool-schemas";
import { BuiltinToolExecutor } from "../services/builtin-tool-executor";
import { resolveModelCapability } from "../services/model-capability-resolver";
import { assembleContext } from "../services/context-assembler";
import { buildArtifactContextBlock } from "../services/artifact-context-builder";
import { buildPersonalPromptContext } from "../services/personal-prompt-profile";
import { extractEnrichedContext, buildEnrichedContextBlock } from "../services/context-enricher";
import { buildExecutionPlan, resolveSessionRuntimeIntent } from "../services/reasoning-runtime";
import { buildCanonicalTurnContent } from "../services/model-runtime/canonical-turn-content";
import { createBackgroundTaskManager } from "../services/model-runtime/background-task-manager";
import type { BackgroundTaskSnapshot } from "../services/model-runtime/background-task-manager";
import { createComputerActionHarness, getComputerActionToolId, buildComputerActionLabel, getComputerActionRisk } from "../services/model-runtime/computer-action-harness";
import { createExecutionGateway } from "../services/model-runtime/execution-gateway";
import { composePromptSections } from "../services/model-runtime/prompt-composer";
import { buildCanonicalToolRegistry } from "../services/model-runtime/tool-registry";
import { resolveTurnExecutionPlan } from "../services/model-runtime/turn-execution-plan-resolver";
import { loadTurnOutcome, updateTurnOutcome } from "../services/model-runtime/turn-outcome-store";
import { isTerminalBackgroundTaskStatus, syncSessionBackgroundTaskSnapshot } from "../services/session-background-task";
import { syncSiliconPersonExecutionResult } from "../services/silicon-person-session";
import { getOrCreateWorkspace } from "../services/silicon-person-workspace";
import { blockTask, completeTask, createPlanState, startTask } from "../services/planner-runtime";
import { createTask, listTasks, getTask, updateTask, clearCompletedTasks } from "../services/task-store";
import type { TaskCreateInput, TaskUpdateInput } from "../services/task-store";

type ComputerHarnessBrowser = Parameters<typeof createComputerActionHarness>[0]["browser"];

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 连续出现相同轮次签名前，先对模型发出警告的阈值。 */
const LOOP_WARN_THRESHOLD = 3;

/** 连续出现相同轮次签名后，强制停止的阈值。 */
const LOOP_STOP_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// 异步获取 Git 分支（替代阻塞式 execSync）
// ---------------------------------------------------------------------------

const execAsync = promisify(execCb);

/**
 * 异步解析当前 Git 分支名。
 * 如果当前目录不是 Git 仓库，或系统中不可用 Git，则返回 null。
 * 该实现是非阻塞的，可安全在 Electron 主进程中调用。
 */
async function getGitBranchAsync(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      timeout: 3000,
      windowsHide: true,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** 只读工具允许并发执行的最大数量。 */
const PARALLEL_LIMIT = 10;

/** 仅执行读取操作、可安全并行运行的工具集合。 */
const READ_ONLY_TOOLS = new Set([
  "fs.read", "fs.list", "fs.search", "fs.find",
  "git.status", "git.diff", "git.log", "task.list", "task.get",
  "web.search", "http.fetch",  // 网络只读操作，可安全并行
]);

/**
 * 判断某个工具是否属于只读工具（可安全并发执行）。
 * Skill 默认视为只读，因为它们运行在受控沙箱中。
 */
export function isReadOnlyTool(toolId: string): boolean {
  if (READ_ONLY_TOOLS.has(toolId)) return true;
  if (toolId.startsWith("skill_invoke__")) return true;
  if (toolId === "skill.view") return true;
  return false;
}

/**
 * 为当前轮次的工具调用构建签名。
 * 该签名用于检测循环调用，例如模型重复以相同参数调用相同工具。
 */
function buildRoundSignature(toolCalls: { name: string; argumentsJson: string }[]): string {
  return toolCalls
    .map((tc) => `${tc.name}:${tc.argumentsJson.slice(0, 200)}`)
    .sort()
    .join("|");
}

/** 统计最后一个元素从尾部开始连续重复了多少次。 */
function countConsecutiveRepeats(signatures: string[]): number {
  if (signatures.length === 0) return 0;
  const last = signatures[signatures.length - 1];
  let count = 0;
  for (let i = signatures.length - 1; i >= 0; i--) {
    if (signatures[i] === last) count++;
    else break;
  }
  return count;
}

/** 共享的工具执行器实例（维护内存中的任务列表状态）。 */
const toolExecutor = new BuiltinToolExecutor();

/** 应用退出时关闭浏览器，需在 index.ts 的 before-quit 中调用。 */
export async function shutdownToolExecutor(): Promise<void> {
  await toolExecutor.shutdown();
}

// ---------------------------------------------------------------------------
// 审批系统
// ---------------------------------------------------------------------------

/** 待处理审批映射：approval request ID → { resolve, timeout }。 */
const pendingApprovals = new Map<string, {
  resolve: (decision: "approve" | "deny" | "canceled") => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/** 内置工具的风险映射表。 */
const TOOL_RISK_MAP: Record<string, ToolRiskCategory> = {
  "fs.read": ToolRiskCategory.Read,
  "fs.list": ToolRiskCategory.Read,
  "fs.search": ToolRiskCategory.Read,
  "fs.find": ToolRiskCategory.Read,
  "fs.write": ToolRiskCategory.Write,
  "fs.edit": ToolRiskCategory.Write,
  "exec.command": ToolRiskCategory.Exec,
  "git.status": ToolRiskCategory.Read,
  "git.diff": ToolRiskCategory.Read,
  "git.log": ToolRiskCategory.Read,
  "git.commit": ToolRiskCategory.Write,
  "http.fetch": ToolRiskCategory.Network,
  "web.search": ToolRiskCategory.Network,
  "task.create": ToolRiskCategory.Read,
  "task.list": ToolRiskCategory.Read,
  "task.get": ToolRiskCategory.Read,
  "task.update": ToolRiskCategory.Read,
  // browser.* 工具
  "browser.open": ToolRiskCategory.Network,
  "browser.snapshot": ToolRiskCategory.Read,
  "browser.click": ToolRiskCategory.Write,
  "browser.type": ToolRiskCategory.Write,
  "browser.screenshot": ToolRiskCategory.Read,
  "browser.evaluate": ToolRiskCategory.Exec,
  "browser.select": ToolRiskCategory.Write,
  "browser.hover": ToolRiskCategory.Write,
  "browser.back": ToolRiskCategory.Write,
  "browser.forward": ToolRiskCategory.Write,
  "browser.wait": ToolRiskCategory.Read,
  // native computer.* 动作
  "computer.screenshot": ToolRiskCategory.Read,
  "computer.wait": ToolRiskCategory.Read,
  "computer.scroll": ToolRiskCategory.Read,
  "computer.move": ToolRiskCategory.Read,
  "computer.click": ToolRiskCategory.Write,
  "computer.double_click": ToolRiskCategory.Write,
  "computer.type": ToolRiskCategory.Write,
  "computer.keypress": ToolRiskCategory.Write,
  "computer.drag": ToolRiskCategory.Write,
};

function getToolRisk(toolId: string, toolName: string): ToolRiskCategory {
  // 先检查内置工具风险映射表
  if (TOOL_RISK_MAP[toolId]) return TOOL_RISK_MAP[toolId];
  // Skill 默认按 Read 风险处理
  if (toolId.startsWith("skill_invoke__")) return ToolRiskCategory.Read;
  if (toolId === "skill.view") return ToolRiskCategory.Read;
  // MCP 工具：根据名称推断风险
  if (toolName.startsWith("mcp__")) return ToolRiskCategory.Write;
  return ToolRiskCategory.Read;
}

function getApprovalSource(toolId: string): "builtin-tool" | "mcp-tool" | "skill" {
  if (toolId.startsWith("skill_invoke__")) return "skill";
  if (toolId.startsWith("mcp__")) return "mcp-tool";
  return "builtin-tool";
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type CreateSessionInput = {
  title?: string;
  modelProfileId?: string;
  attachedDirectory?: string | null;
};

type SendMessageInput = {
  content: string;
  attachedDirectory?: string | null;
};

type SessionPayload = {
  session: ChatSession;
  approvalRequests?: unknown[];
};

type SessionsPayload = {
  sessions: ChatSession[];
  approvalRequests?: unknown[];
};

let registeredSessionSendMessageBridge:
  | ((sessionId: string, input: SendMessageInput) => Promise<SessionPayload>)
  | null = null;

/** 复用已注册的 session:send-message 主链路，供其他 IPC 入口共享完整执行流程。 */
export async function invokeRegisteredSessionSendMessage(
  sessionId: string,
  input: SendMessageInput,
): Promise<SessionPayload> {
  if (!registeredSessionSendMessageBridge) {
    throw new Error("session:send-message bridge is not registered");
  }
  return registeredSessionSendMessageBridge(sessionId, input);
}

/** 按共享 session 运行态同步硅基员工摘要，非硅基员工会话时直接跳过。 */
async function syncSiliconPersonSummaryForSession(
  ctx: RuntimeContext,
  session: ChatSession,
): Promise<void> {
  if (!session.siliconPersonId) {
    return;
  }
  await syncSiliconPersonExecutionResult(ctx, {
    siliconPersonId: session.siliconPersonId,
    session,
  });
}

/** 解析某个会话实际生效的审批策略，允许硅基员工覆盖 workspace 默认审批口径。 */
function resolveApprovalPolicyForSession(
  ctx: RuntimeContext,
  session: ChatSession,
): ApprovalPolicy {
  const workspacePolicy = ctx.state.getApprovals();
  const clonedWorkspacePolicy: ApprovalPolicy = {
    ...workspacePolicy,
    alwaysAllowedTools: [...workspacePolicy.alwaysAllowedTools],
  };
  if (!session.siliconPersonId) {
    return clonedWorkspacePolicy;
  }

  const siliconPerson = ctx.state.siliconPersons.find((item) => item.id === session.siliconPersonId);
  if (!siliconPerson) {
    console.warn("[approval] 会话已绑定硅基员工，但未找到对应实体，回退 workspace 审批策略", {
      sessionId: session.id,
      siliconPersonId: session.siliconPersonId,
    });
    return clonedWorkspacePolicy;
  }

  if (siliconPerson.approvalMode === "auto_approve") {
    console.info("[approval] 命中硅基员工 auto_approve 审批模式", {
      sessionId: session.id,
      siliconPersonId: siliconPerson.id,
    });
    return {
      mode: "unrestricted",
      autoApproveReadOnly: true,
      autoApproveSkills: true,
      alwaysAllowedTools: [],
    };
  }

  if (siliconPerson.approvalMode === "always_ask") {
    console.info("[approval] 命中硅基员工 always_ask 审批模式", {
      sessionId: session.id,
      siliconPersonId: siliconPerson.id,
    });
    return {
      mode: "prompt",
      autoApproveReadOnly: false,
      autoApproveSkills: false,
      alwaysAllowedTools: [],
    };
  }

  return clonedWorkspacePolicy;
}

/**
 * 克隆会话上显式声明的 runtimeIntent，冻结当前轮次的执行配置，
 * 避免聊天进行中切换推理深度/模式时污染正在运行的这一轮。
 */
function cloneExplicitRuntimeIntent(
  runtimeIntent: SessionRuntimeIntent | null | undefined,
): SessionRuntimeIntent | null | undefined {
  if (runtimeIntent === null || runtimeIntent === undefined) {
    return runtimeIntent;
  }
  return { ...runtimeIntent };
}

/**
 * 将冻结后的 runtimeIntent 快照映射成 buildExecutionPlan 需要的 session 形状，
 * 只回填用户显式设置过的字段，保持默认值与降级来源判定不变。
 */
function buildExecutionPlanSessionFromRuntimeIntentSnapshot(
  explicitRuntimeIntent: SessionRuntimeIntent | null | undefined,
  resolvedRuntimeIntent: ResolvedSessionRuntimeIntent,
): { runtimeIntent?: SessionRuntimeIntent | null } | undefined {
  if (explicitRuntimeIntent === undefined) {
    return undefined;
  }
  if (explicitRuntimeIntent === null) {
    return { runtimeIntent: null };
  }
  return {
    runtimeIntent: {
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "reasoningMode")
        ? { reasoningMode: resolvedRuntimeIntent.reasoningMode }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "reasoningEnabled")
        ? { reasoningEnabled: resolvedRuntimeIntent.reasoningEnabled }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "reasoningEffort")
        ? { reasoningEffort: resolvedRuntimeIntent.reasoningEffort }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "adapterHint")
        ? { adapterHint: resolvedRuntimeIntent.adapterHint }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "replayPolicy")
        ? { replayPolicy: resolvedRuntimeIntent.replayPolicy }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "toolStrategy")
        ? { toolStrategy: resolvedRuntimeIntent.toolStrategy }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "workflowMode")
        ? { workflowMode: resolvedRuntimeIntent.workflowMode }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(explicitRuntimeIntent, "planModeEnabled")
        ? { planModeEnabled: resolvedRuntimeIntent.planModeEnabled }
        : {}),
    },
  };
}

type SessionWithExecutionPlan = ChatSession & {
  executionPlan?: ResolvedExecutionPlan;
};

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

/**
 * 向所有渲染进程窗口广播流式事件。
 * 使用 session 通道，便于渲染层按 sessionId 过滤。
 * 这里包裹 try-catch，因为 webContents 可能在
 * getAllWebContents() 与 send() 之间被销毁，否则会抛错并中断 agentic loop。
 */
function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.isDestroyed()) {
        wc.send(channel, payload);
      }
    } catch {
      // WebContents 可能在检查后到发送前被销毁，这里可安全忽略
    }
  }
}

/**
 * 广播聊天运行态，供渲染层驱动 stop/canceling/canceled 等显式状态。
 */
function broadcastChatRunStatus(payload: ChatRunRuntimeStatusPayload): void {
  broadcastToRenderers("session:stream", {
    type: EventType.RuntimeStatus,
    ...payload,
  });
}

/**
 * 广播 session tasklist 更新，让聊天页与硅基员工工作台复用同一条实时流。
 */
export function broadcastSessionTasksUpdated(sessionId: string, tasks: Task[]): void {
  console.info("[session:stream] 广播任务列表更新", {
    sessionId,
    taskCount: tasks.length,
  });
  broadcastToRenderers("session:stream", {
    type: EventType.TasksUpdated,
    sessionId,
    tasks,
  });
}

/**
 * 同步当前聊天运行态到 session，并可选广播 runtime.status。
 */
function syncChatRunState(
  session: ChatSession,
  sessionId: string,
  run: ActiveSessionRun | null,
  input: {
    runId: string;
    status: ChatRunStatus;
    phase: ChatRunPhase;
    messageId?: string;
    reason?: string | null;
    broadcast?: boolean;
  },
): void {
  if (run) {
    run.phase = input.phase;
    if (input.status === "running" || input.status === "canceling") {
      run.status = input.status;
    }
    if (input.messageId) {
      run.currentMessageId = input.messageId;
    }
  }
  session.chatRunState = {
    runId: input.runId,
    status: input.status,
    phase: input.phase,
    ...(input.messageId ? { activeMessageId: input.messageId } : {}),
    lastReason: input.reason ?? null,
  };
  if (input.broadcast ?? true) {
    broadcastChatRunStatus({
      sessionId,
      runId: input.runId,
      status: input.status,
      phase: input.phase,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }
}

/**
 * 释放指定 run 仍在等待的审批，避免 stop 后卡住 Promise。
 */
function releasePendingApprovalsForRun(
  ctx: RuntimeContext,
  run: ActiveSessionRun,
  decision: "canceled" = "canceled",
): void {
  if (run.pendingApprovalIds.length === 0) {
    return;
  }
  const pendingIds = [...new Set(run.pendingApprovalIds)];
  for (const approvalId of pendingIds) {
    const pending = pendingApprovals.get(approvalId);
    if (!pending) continue;
    clearTimeout(pending.timeout);
    pending.resolve(decision);
    pendingApprovals.delete(approvalId);
  }
  ctx.state.setApprovalRequests(
    ctx.state.getApprovalRequests().filter((request) => !pendingIds.includes(request.id)),
  );
  run.pendingApprovalIds = [];
}

/**
 * 累积流式 partial 文本，便于用户中断时保留已经生成的半截回答。
 */
function appendStreamDraft(
  drafts: Map<string, { content: string; reasoning?: string }>,
  messageId: string,
  delta: { content?: string; reasoning?: string },
): void {
  const existing = drafts.get(messageId) ?? { content: "" };
  drafts.set(messageId, {
    content: existing.content + (delta.content ?? ""),
    ...(existing.reasoning || delta.reasoning
      ? { reasoning: `${existing.reasoning ?? ""}${delta.reasoning ?? ""}` }
      : {}),
  });
}

/**
 * 将已经流出的 partial assistant 内容落入 session，避免 abort 后丢失。
 */
function persistPartialAssistantDraft(
  session: ChatSession,
  messageId: string,
  drafts: Map<string, { content: string; reasoning?: string }>,
  now: string,
): void {
  const draft = drafts.get(messageId);
  if (!draft || !draft.content.trim()) {
    return;
  }
  const existingMessage = session.messages.find((message) => message.id === messageId);
  if (existingMessage?.role === "assistant") {
    if (typeof existingMessage.content === "string" && !existingMessage.content) {
      existingMessage.content = draft.content;
    }
    if (draft.reasoning && !existingMessage.reasoning) {
      existingMessage.reasoning = draft.reasoning;
    }
    return;
  }
  session.messages.push({
    id: messageId,
    role: "assistant",
    content: draft.content,
    ...(draft.reasoning ? { reasoning: draft.reasoning } : {}),
    createdAt: now,
  });
}

/**
 * 修补会话中孤立的 tool_calls：为每个缺少 tool result 的 tool_call 补充占位消息。
 *
 * 场景：用户在工具审批/执行阶段终止运行，assistant 消息已含 tool_calls 但
 * 对应的 tool result 尚未写入。下次发消息时 API 会因消息序列不完整而拒绝。
 */
function patchOrphanedToolCalls(session: ChatSession, now: string): void {
  // 收集所有已存在的 tool result 的 tool_call_id
  const existingToolResultIds = new Set(
    session.messages
      .filter((m) => m.role === "tool" && m.tool_call_id)
      .map((m) => m.tool_call_id!),
  );

  // 先收集待补充的占位消息，避免在 for...of 遍历中修改被遍历的数组
  const patches: SessionChatMessage[] = [];
  for (const msg of session.messages) {
    if (msg.role !== "assistant" || !msg.tool_calls) continue;
    for (const tc of msg.tool_calls) {
      if (!existingToolResultIds.has(tc.id)) {
        patches.push({
          id: randomUUID(),
          role: "tool",
          content: "[已取消] 工具调用因用户终止而未执行。",
          tool_call_id: tc.id,
          createdAt: now,
        });
        existingToolResultIds.add(tc.id);
      }
    }
  }
  if (patches.length > 0) {
    session.messages.push(...patches);
  }
}

/**
 * 统一识别用户主动 stop 触发的中断错误。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 确保旧会话在进入新链路前拥有 runtime version，便于后续做版本化迁移。 */
/** 向后兼容旧的测试上下文，确保会话运行注册表始终可用。 */
function getActiveSessionRuns(ctx: RuntimeContext): Map<string, ActiveSessionRun> {
  if (!ctx.state.activeSessionRuns) {
    ctx.state.activeSessionRuns = new Map<string, ActiveSessionRun>();
  }
  return ctx.state.activeSessionRuns;
}

function ensureSessionRuntimeVersion(session: ChatSession): void {
  if (!session.runtimeVersion) {
    session.runtimeVersion = SESSION_RUNTIME_VERSION;
  }
}

/**
 * 从 legacy message 数组中移除 system 消息，避免 canonical prompt sections 与旧 system prompt 重复下发。
 */
function stripSystemMessages(messages: ModelChatMessage[]): ModelChatMessage[] {
  return messages.filter((message) => message.role !== "system");
}

/**
 * 为硅基员工会话追加身份 section，确保 canonical prompt 与 legacy prompt 维持相同角色约束。
 */
function buildSiliconPersonPromptSection(
  siliconPersonIdentity: { name: string; title: string; soul?: string | null } | null,
  workingDir: string,
): PromptSection[] {
  if (!siliconPersonIdentity) {
    return [];
  }

  return [{
    id: "silicon-person-identity",
    title: "Silicon Person Identity",
    layer: "identity",
    content: [
      "You are a Silicon Person (硅基员工), an autonomous AI worker with your own isolated workspace.",
      `- Name: ${siliconPersonIdentity.name}`,
      `- Title: ${siliconPersonIdentity.title}`,
      siliconPersonIdentity.soul ? `- Persona: ${siliconPersonIdentity.soul}` : null,
      `- Workspace: ${workingDir}`,
      "",
      "## Workspace Rules",
      `- All file operations (read, write, create, execute) happen within your workspace directory: ${workingDir}`,
      "- Your skills are stored in your own skills directory, separate from the main assistant.",
      "- You operate independently. When asked to create files, scripts, or skills, write them in YOUR workspace unless the user explicitly specifies a different path.",
      "- Do not modify files outside your workspace without explicit user instruction.",
    ].filter((line): line is string => !!line).join("\n"),
  }];
}

/**
 * 根据 session 关联的会议录音构建上下文块。
 *
 * 仅当 session.linkedMeetingId 有效且离线 ASR 已产出结构化转写时返回内容，
 * 否则返回 null，composePromptSections 会自动跳过该 section。
 */
function buildMeetingContextBlock(
  ctx: RuntimeContext,
  session: ChatSession,
): string | null {
  const meetingId = session.linkedMeetingId;
  const recorder = ctx.services.meetingRecorder;
  if (!meetingId || !recorder) return null;

  const meeting = recorder.get(meetingId);
  const transcript = recorder.getTranscript(meetingId);
  if (!meeting || !transcript || transcript.segments.length === 0) return null;

  const lines: string[] = [
    `会议：${meeting.title}`,
    `时间：${meeting.createdAt}`,
    `时长：${Math.round(meeting.durationMs / 1000)}s · 发言人：${transcript.speakerCount} 位`,
    "",
    "转写稿：",
  ];
  let currentSpeaker: number | null = null;
  for (const seg of transcript.segments) {
    if (!seg.text.trim()) continue;
    if (seg.speaker !== currentSpeaker) {
      currentSpeaker = seg.speaker;
      const label = meeting.speakerLabels?.[seg.speaker] || `发言人${seg.speaker}`;
      lines.push(`\n【${label}】`);
    }
    lines.push(seg.text);
  }
  return lines.join("\n");
}

/**
 * 统一构建会话的 canonical prompt sections，让 sessions 主链与 PromptComposer 使用同一套结构化 prompt 入口。
 */
function buildSessionPromptSections(input: {
  session: ChatSession;
  workingDir: string;
  skills: SkillDefinition[];
  gitBranch?: string | null;
  personalPromptProfile?: PersonalPromptProfile | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
  enrichedContextBlock?: string | null;
  artifactContextBlock?: string | null;
  meetingContextBlock?: string | null;
  mcpTools?: Array<McpTool & { serverId: string }>;
  providerFamily: ProviderFamily;
  experienceProfileId: ExperienceProfileId;
  promptPolicyId?: string | null;
  toolPolicyId?: string | null;
  reasoningProfileId?: string | null;
  siliconPersonIdentity?: { name: string; title: string; soul?: string | null } | null;
  extraGuidance?: string | null;
}): PromptSection[] {
  const sections = composePromptSections({
    session: input.session,
    workingDir: input.workingDir,
    providerFamily: input.providerFamily,
    experienceProfileId: input.experienceProfileId,
    promptPolicyId: input.promptPolicyId ?? null,
    toolPolicyId: input.toolPolicyId ?? null,
    reasoningProfileId: input.reasoningProfileId ?? null,
    skills: input.skills,
    gitBranch: input.gitBranch,
    personalPromptProfile: input.personalPromptProfile,
    reasoningEffort: input.reasoningEffort,
    enrichedContextBlock: input.enrichedContextBlock,
    artifactContextBlock: input.artifactContextBlock,
    meetingContextBlock: input.meetingContextBlock,
    mcpTools: input.mcpTools,
  });

  // 当会话中有 task 时，将当前状态摘要注入系统提示词，让模型每轮都能看到任务顺序和依赖
  const sessionTasks = input.session.tasks;
  if (sessionTasks && sessionTasks.length > 0) {
    const taskItems = buildTaskDisplayItems(sessionTasks);
    const sequenceById = new Map(taskItems.map((item) => [item.task.id, item.sequence]));
    const total = taskItems.length;
    const taskLines = taskItems.map(({ task, sequence }) => {
      let line = `[${sequence}/${total}] (${task.id}) ${task.status}: ${task.subject}`;
      if (task.blockedBy && task.blockedBy.length > 0 && task.status !== "completed") {
        const unfinished = task.blockedBy.filter(
          (bid) => taskItems.find((item) => item.task.id === bid)?.task.status !== "completed",
        );
        if (unfinished.length > 0) {
          line += ` [blocked by: ${unfinished.map((id) => `#${sequenceById.get(id) ?? id}`).join(", ")}]`;
        }
      }
      return line;
    });
    sections.push({
      id: "current-tasks",
      title: "Current Tasks",
      layer: "context",
      content: [
        "Execute tasks strictly in order. Complete each task before starting the next one.",
        ...taskLines,
      ].join("\n"),
    });
  }

  sections.push(...buildSiliconPersonPromptSection(input.siliconPersonIdentity ?? null, input.workingDir));
  if (input.extraGuidance?.trim()) {
    sections.push({
      id: "runtime-guidance",
      title: "Runtime Guidance",
      layer: "guidelines",
      content: input.extraGuidance.trim(),
    });
  }
  return sections;
}

/**
 * 将共享执行网关返回的 turn outcome 追加回会话运行时，补齐工具执行与上下文稳定性指标。
 */
async function persistSessionTurnOutcomeMetrics(
  ctx: RuntimeContext,
  outcome: TurnOutcome,
  metrics: {
    toolCallCount: number;
    toolSuccessCount: number;
    contextStability: boolean;
  },
): Promise<void> {
  try {
    const nextOutcome = {
      ...outcome,
      toolCallCount: metrics.toolCallCount,
      toolSuccessCount: metrics.toolSuccessCount,
      contextStability: (outcome.contextStability !== false) && metrics.contextStability,
    };
    if (ctx.services.artifactManager) {
      await updateTurnOutcome(ctx.runtime.paths, nextOutcome, ctx.services.artifactManager);
    } else {
      await updateTurnOutcome(ctx.runtime.paths, nextOutcome);
    }
  } catch (error) {
    console.warn("[session:runtime] 回写 turn outcome 指标失败", {
      outcomeId: outcome.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 解析 OpenAI Responses server-state 所需的 previous_response_id。 */
function resolvePreviousResponseIdForSessionTurn(
  ctx: RuntimeContext,
  session: ChatSession,
  profile: ModelProfile,
  protocolTarget: "openai-responses" | string,
): string | null {
  if (protocolTarget !== "openai-responses" || !profile.responsesApiConfig?.useServerState) {
    return null;
  }
  if (!session.lastTurnOutcomeId) {
    return null;
  }

  const lastOutcome = loadTurnOutcome(ctx.runtime.paths, session.lastTurnOutcomeId);
  if (!lastOutcome?.responseId) {
    return null;
  }

  console.info("[session:runtime] 已为 Responses 原生执行恢复 previous_response_id。", {
    sessionId: session.id,
    lastTurnOutcomeId: session.lastTurnOutcomeId,
    previousResponseId: lastOutcome.responseId,
  });
  return lastOutcome.responseId;
}

/** 解析会话关联的后台任务快照，供轮询与取消入口复用。 */
function resolveSessionBackgroundTaskContext(
  ctx: RuntimeContext,
  sessionId: string,
): {
  session: ChatSession;
  profile: ModelProfile;
  outcome: TurnOutcome;
} {
  const session = ctx.state.sessions.find((item) => item.id === sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const profile = ctx.state.models.find((item) => item.id === session.modelProfileId);
  if (!profile) {
    throw new Error(`Model profile not found for session: ${session.modelProfileId}`);
  }

  if (!session.lastTurnOutcomeId) {
    throw new Error("Session does not have a turn outcome to inspect");
  }

  const outcome = loadTurnOutcome(ctx.runtime.paths, session.lastTurnOutcomeId);
  if (!outcome?.backgroundTask) {
    throw new Error("Session does not have an active background task");
  }

  return { session, profile, outcome };
}

/** 合并 capability events，按稳定键去重，避免 background retrieve 重复写入相同 trace。 */
function mergeCapabilityEvents(
  existing: TurnOutcome["capabilityEvents"] | undefined,
  incoming: TurnOutcome["capabilityEvents"] | undefined,
): TurnOutcome["capabilityEvents"] {
  const merged = [...(existing ?? [])];
  const seen = new Set(
    merged.map((event) => [
      event.type,
      event.capabilityId,
      event.createdAt,
      JSON.stringify(event.payload ?? null),
    ].join("|")),
  );

  for (const event of incoming ?? []) {
    const key = [
      event.type,
      event.capabilityId,
      event.createdAt,
      JSON.stringify(event.payload ?? null),
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }

  return merged;
}

/** 合并 citations，优先使用 citation id 去重，保证后台补拉结果不会重复展示来源。 */
function mergeCitations(
  existing: TurnOutcome["citations"] | undefined,
  incoming: TurnOutcome["citations"] | undefined,
): TurnOutcome["citations"] {
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map((citation) => citation.id));

  for (const citation of incoming ?? []) {
    if (seen.has(citation.id)) {
      continue;
    }
    seen.add(citation.id);
    merged.push(citation);
  }

  return merged;
}

/** 将后台任务的终态结果回灌进会话消息流，保证 deep research 最终答复能像普通 assistant 消息一样落盘。 */
function appendBackgroundResultToSession(
  session: ChatSession,
  snapshot: {
    status: string;
    outputText: string;
    result?: {
      content?: string;
      reasoning?: string;
      usage?: TurnOutcome["usage"];
      finishReason?: string | null;
    } | null;
  },
): void {
  const content = snapshot.result?.content?.trim() || snapshot.outputText.trim();
  const reasoning = snapshot.result?.reasoning?.trim() || "";
  const now = new Date().toISOString();

  if (content) {
    session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content,
      ...(reasoning ? { reasoning } : {}),
      createdAt: now,
    });
    return;
  }

  if (snapshot.status === "failed") {
    session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: "[后台任务失败] 研究任务未能完成，请稍后重试。",
      createdAt: now,
    });
  }
}

/** 为缺少浏览器服务的测试桩提供安全降级，避免 computer harness 初始化阶段直接抛错。 */
function resolveComputerHarnessBrowser(toolExecutor: unknown): ComputerHarnessBrowser {
  if (
    toolExecutor &&
    typeof toolExecutor === "object" &&
    "getBrowserService" in toolExecutor &&
    typeof (toolExecutor as { getBrowserService?: unknown }).getBrowserService === "function"
  ) {
    return (toolExecutor as { getBrowserService: () => ComputerHarnessBrowser }).getBrowserService();
  }

  const unavailableResult = async () => ({
    success: false,
    output: "",
    error: "Browser service unavailable",
  });

  return {
    clickAt: async () => unavailableResult(),
    movePointer: async () => unavailableResult(),
    dragPath: async () => unavailableResult(),
    scrollAt: async () => unavailableResult(),
    typeText: async () => unavailableResult(),
    wait: async () => unavailableResult(),
    pressKey: async () => unavailableResult(),
    captureComputerState: async () => unavailableResult(),
  };
}

/** 持久化后台任务快照，并在任务完成时把最终结果重新并入会话。 */
async function persistSessionBackgroundTaskSnapshot(
  ctx: RuntimeContext,
  session: ChatSession,
  outcome: TurnOutcome,
  snapshot: BackgroundTaskSnapshot,
): Promise<TurnOutcome> {
  const nextTask = isTerminalBackgroundTaskStatus(snapshot.status) ? null : snapshot.task;
  const result = snapshot.result ?? {
    responseId: null,
    finishReason: null,
    citations: [],
    capabilityEvents: [],
  };
  const updatedOutcome: TurnOutcome = {
    ...outcome,
    backgroundTask: nextTask,
    responseId: result.responseId ?? outcome.responseId,
    finishReason: result.finishReason ?? outcome.finishReason,
    citations: mergeCitations(outcome.citations, result.citations),
    capabilityEvents: mergeCapabilityEvents(outcome.capabilityEvents, result.capabilityEvents),
  };

  if (ctx.services.artifactManager) {
    await updateTurnOutcome(ctx.runtime.paths, updatedOutcome, ctx.services.artifactManager);
  } else {
    await updateTurnOutcome(ctx.runtime.paths, updatedOutcome);
  }
  syncSessionBackgroundTaskSnapshot(ctx.runtime.paths, session, updatedOutcome);

  if (isTerminalBackgroundTaskStatus(snapshot.status)) {
    appendBackgroundResultToSession(session, snapshot);
  }

  return updatedOutcome;
}

/**
 * 为会话构建内容更完整的 system prompt。
 * 可选的 `gitBranch` 参数用于避免在主线程调用 execSync。
 * 调用方应先通过 getGitBranchAsync() 异步计算当前分支。
 */
function buildSystemPrompt(
  session: ChatSession,
  workingDir: string,
  skills?: SkillDefinition[],
  gitBranch?: string | null,
  personalPromptProfile?: PersonalPromptProfile | null,
  reasoningEffort?: "low" | "medium" | "high" | null,
  enrichedContextBlock?: string | null,
  mcpTools?: Array<{ id: string; name: string; description?: string; serverId: string }>,
): string {
  const now = new Date();
  const parts: string[] = [];
  const effort = reasoningEffort ?? "medium";

  // ── Identity & 核心行为准则 ──────────────────────────────
  parts.push(`You are MyClaw, an expert AI assistant that helps users accomplish real work tasks.`);
  parts.push(`Your goal is to **understand what the user actually needs**, choose the right approach, and execute it well.`);
  parts.push(`Always read the user's message carefully — a vague request deserves a clarifying question, not a guess.`);

  // ── Environment ──────────────────────────────────────────
  parts.push(`\n# Environment`);
  parts.push(`- Working directory: ${workingDir}`);
  parts.push(`- Platform: ${process.platform} (${process.arch})`);
  parts.push(`- Date: ${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`);
  if (gitBranch) {
    parts.push(`- Git branch: ${gitBranch}`);
  }

  // ── Session Context（动态注入，来自 context-enricher）──────
  if (enrichedContextBlock) {
    parts.push(`\n${enrichedContextBlock}`);
  }

  // ── Response Strategy（意图分类引导）──────────────────────
  if (effort !== "low") {
    parts.push(`\n# Response Strategy`);
    parts.push(`Before responding, identify the user's intent and adapt your approach:`);
    parts.push(`- **Ask/Explain** — user wants understanding → explain clearly with relevant code snippets, match the user's expertise level`);
    parts.push(`- **Fix/Debug** — user reports a problem → reproduce or locate the issue first, identify root cause, then fix`);
    parts.push(`- **Build/Create** — user wants new functionality → clarify scope if unclear, then plan and implement step by step`);
    parts.push(`- **Review/Improve** — user wants feedback → read the code thoroughly, prioritize critical issues, suggest concrete changes`);
    parts.push(`- **Quick/Direct** — user wants a simple answer → be concise, skip task tracking, give the answer directly`);
    parts.push(`\nMatch your depth to the user's signal: a one-line question gets a focused answer, not a tutorial. A complex request gets structured planning.`);
  }

  // ── Task Management（强化引导）──────────────────────────
  parts.push(`\n# Task Planning (IMPORTANT)`);
  if (effort === "low") {
    parts.push(`You have task tracking tools (task_create, task_update, etc.) — use them only when explicitly asked.`);
  } else {
    parts.push(`You have task tools for decomposing and tracking user requests. **This is your primary workflow — use it for every non-trivial request.**`);
    parts.push(`\n## Mandatory Workflow`);
    parts.push(`When you receive a user request (except simple Q&A like "what is X?"), you MUST follow this workflow:`);
    parts.push(`1. **Analyze** — Understand what the user really wants. Identify the logical steps needed.`);
    parts.push(`2. **Decompose** — Call \`task_create\` for EACH step to build a task list. This shows the user your execution plan BEFORE you start working.`);
    parts.push(`3. **Execute** — Work through tasks one by one: \`task_update(id, status: "in_progress")\` → do the work → \`task_update(id, status: "completed")\``);
    parts.push(`\n## Tools`);
    parts.push(`- \`task_create({ subject, description, activeForm })\` — subject: imperative (e.g. "修复登录Bug"), activeForm: present continuous (e.g. "正在修复登录Bug"). Always provide activeForm.`);
    parts.push(`- \`task_update({ id, status })\` — Mark "in_progress" before starting, "completed" immediately after finishing.`);
    parts.push(`- \`task_list()\` / \`task_get({ id })\` — Check current task state.`);
    parts.push(`- **Status flow**: pending → in_progress → completed. Only ONE task can be in_progress at a time.`);
    parts.push(`\n## Key Rules`);
    parts.push(`- **Plan first, execute second** — Create ALL tasks before starting the first one. Let the user see the full plan.`);
    parts.push(`- **Even single-step requests get a task** — Creating a task signals "I understood your request and here's what I'll do."`);
    parts.push(`- **Discover new steps? Add tasks** — If you find additional work during execution, create new tasks to track it.`);
    parts.push(`- **Skip tasks ONLY for**: direct factual Q&A, greetings, or clarification questions.`);
    if (effort === "high") {
      parts.push(`\n## Deep Reasoning Protocol (MANDATORY)`);
      parts.push(`- Before creating tasks, output your analysis: what is the core need? what are the constraints? what could go wrong?`);
      parts.push(`- Express task dependencies via \`blocks\`/\`blockedBy\` fields.`);
      parts.push(`- If a task fails or is blocked, update its description with the reason and create a follow-up task.`);
      parts.push(`- After completing each task, verify the result before marking completed.`);
      parts.push(`- Consider edge cases and failure modes for every task.`);
    }
  }

  // ── Tool Usage（按分类组织，减少 token 浪费）──────────────
  parts.push(`\n# Tools`);
  parts.push(`## Files`);
  parts.push(`- \`fs_read\` — Read file contents. **Always read before editing.**`);
  parts.push(`- \`fs_edit\` — Replace a specific string in a file (preferred for partial edits).`);
  parts.push(`- \`fs_write\` — Create new files or full rewrites only.`);
  parts.push(`- \`fs_list\` / \`fs_find\` / \`fs_search\` — List dirs, find files by glob, grep text.`);
  parts.push(`## Shell & Git`);
  parts.push(`- \`exec_command\` — Run shell commands (dangerous commands are blocked).`);
  parts.push(`- \`git_status\` / \`git_diff\` / \`git_log\` / \`git_commit\` — Git operations.`);
  parts.push(`## Web & Browser`);
  parts.push(`- \`web_search\` — Search the web for current information.`);
  parts.push(`- \`http_fetch\` — Fetch a URL via HTTP GET.`);
  parts.push(`- Browser workflow: \`browser_open\` → \`browser_snapshot\` (accessibility tree, use ref=N) → \`browser_click\`/\`browser_type\` → \`browser_snapshot\` to verify.`);
  parts.push(`- Also: \`browser_screenshot\`, \`browser_evaluate\`, \`browser_select\`, \`browser_hover\`, \`browser_scroll\`, \`browser_press_key\`, \`browser_back\`, \`browser_forward\`, \`browser_wait\`.`);
  parts.push(`## Presentation (PPT)`);
  parts.push(`- \`ppt_themes\` — List available presentation themes (call first to show user the options).`);
  parts.push(`- \`ppt_generate\` — Generate an editable .pptx file from structured slide data.`);
  parts.push(`- When the user asks to create a PPT, presentation, slide deck, 汇报, 演示, or 幻灯片: **always use ppt_generate**, not plain text.`);
  parts.push(`- Workflow: understand requirements → \`ppt_themes\` to pick a theme → structure slides as JSON → \`ppt_generate\` to create the file.`);
  parts.push(`- Available layouts: cover(封面), section(章节过渡), key_points(要点列表), metrics(数据大字报), comparison(左右对比), closing(结束页).`);
  parts.push(`- If a \`ppt-designer\` skill is available, invoke it first for design methodology guidance.`);

  // ── MCP 工具分组说明（企业内部系统连接）───────────────────
  if (mcpTools && mcpTools.length > 0) {
    parts.push(`\n## Connected Services (MCP)`);
    parts.push(`You have access to the following enterprise tools via MCP servers.`);
    parts.push(`These connect to internal company systems — use them when you need corporate data.`);
    parts.push(``);
    for (const tool of mcpTools) {
      const desc = tool.description ? ` — ${tool.description}` : "";
      parts.push(`- \`${tool.name}\`${desc}`);
    }
    parts.push(``);
    parts.push(`When the user asks about internal projects, tasks, or company data, prefer these MCP tools over web_search.`);
  }

  // ── Tool Strategy（按 effort 分级）────────────────────────
  if (effort === "low") {
    parts.push(`\n# Tool Strategy`);
    parts.push(`- You can call multiple independent tools in a single response — no need to call them one by one.`);
    parts.push(`- Keep tool usage minimal. One search or file read is usually sufficient.`);
    parts.push(`- Answer directly when you already know the answer.`);
  } else if (effort === "medium") {
    parts.push(`\n# Tool Strategy`);
    parts.push(``);
    parts.push(`## Parallel Calling`);
    parts.push(`You can call MULTIPLE tools in a single response. When operations are independent, issue them all at once.`);
    parts.push(``);
    parts.push(`Examples:`);
    parts.push(`- Need 3 files? → 3× fs_read in one response (parallel)`);
    parts.push(`- Need to search 2 topics? → 2× web_search in one response (parallel)`);
    parts.push(`- Need git status + file content? → Both in one response (parallel)`);
    parts.push(``);
    parts.push(`BAD: web_search → wait for result → another web_search → wait → ... (sequential, slow)`);
    parts.push(`GOOD: web_search + web_search + web_search in one response (parallel, fast)`);
    parts.push(``);
    parts.push(`## Iterative Gathering`);
    parts.push(`After receiving tool results, assess whether you have enough information:`);
    parts.push(`- If yes → proceed to answer or next task`);
    parts.push(`- If gaps remain → call more tools to fill them`);
    parts.push(``);
    parts.push(`For research questions, expect 1-2 rounds of tool calls before answering.`);
  } else if (effort === "high") {
    parts.push(`\n# Tool Strategy (Deep Research Mode)`);
    parts.push(``);
    parts.push(`## Aggressive Parallel Calling`);
    parts.push(`Call up to 10 tools in a single response. NEVER call independent tools one by one.`);
    parts.push(``);
    parts.push(`For information research, plan 3-5 different search queries and issue them ALL at once:`);
    parts.push(`- Vary keywords and angles to maximize coverage`);
    parts.push(`- Mix languages (Chinese + English) for broader sources`);
    parts.push(`- Use specific terms alongside general queries`);
    parts.push(``);
    parts.push(`For code investigation, batch-read all related files in one response:`);
    parts.push(`- Source files, type definitions, tests, configs — read them all at once`);
    parts.push(`- Then read upstream/downstream dependencies in the next round`);
    parts.push(``);
    parts.push(`## Iterative Research Loop (MANDATORY)`);
    parts.push(`One round of tool calls is NEVER enough for deep thinking. Follow this cycle:`);
    parts.push(``);
    parts.push(`  Round 1 — Broad gathering`);
    parts.push(`    Issue multiple parallel tool calls to cover different angles.`);
    parts.push(`    (e.g., 5 web_searches with different queries, or 8 fs_reads for all related files)`);
    parts.push(``);
    parts.push(`  Assess — Review what you received`);
    parts.push(`    What did you learn? What's still unclear? What needs deeper investigation?`);
    parts.push(``);
    parts.push(`  Round 2 — Targeted deep-dive`);
    parts.push(`    Based on gaps identified, issue focused tool calls:`);
    parts.push(`    - http_fetch to read full articles from promising search results`);
    parts.push(`    - fs_read for dependency files that turned out to be relevant`);
    parts.push(`    - Additional web_search with refined queries`);
    parts.push(``);
    parts.push(`  Assess — Is information sufficient?`);
    parts.push(`    Can you give a comprehensive, verified answer? Are there contradictions to resolve?`);
    parts.push(``);
    parts.push(`  Round 3+ — Fill remaining gaps`);
    parts.push(`    Continue gathering until you can answer with confidence.`);
    parts.push(`    There is no round limit — keep going until the information is sufficient.`);
    parts.push(``);
    parts.push(`## Web Research Escalation`);
    parts.push(`For information gathering, prefer this escalation order:`);
    parts.push(`1. web_search — Fast, returns summarized results`);
    parts.push(`2. http_fetch — Read full page content from promising URLs`);
    parts.push(`3. browser_open + browser_snapshot — For pages that http_fetch can't render (JS-heavy sites, SPAs, pages behind simple interactions)`);
    parts.push(``);
    parts.push(`## Verification`);
    parts.push(`- Cross-reference key facts across multiple sources`);
    parts.push(`- If search results contradict each other, investigate further`);
    parts.push(`- For code changes, read back modified files to verify correctness`);
    parts.push(``);
    parts.push(`## Skill Awareness`);
    parts.push(`Before starting complex tasks, review available skills — a skill may already encapsulate the workflow you need. Skills can be combined with other tools in the same task (e.g., invoke a code-review skill, then use its output to guide your fs_edit calls).`);
    parts.push(``);
    parts.push(`## What NOT to Over-Research`);
    parts.push(`Even in deep mode, skip deep research for:`);
    parts.push(`- Direct factual Q&A you already know ("what is a closure?")`);
    parts.push(`- Greetings and clarification questions`);
    parts.push(`- Requests where the user explicitly wants a quick answer`);
  }

  // ── Skills ────────────────────────────────────────────────
  if (skills && skills.length > 0) {
    const skillsWithView = skills.filter((s) => s.hasViewFile);
    parts.push(`\n# Available Skills`);
    parts.push(`**IMPORTANT — Skill-first principle:** Before doing any work manually, check if one of the skills below matches the user's request. If a skill's description matches the user's intent, you MUST call \`skill_invoke__<skill_id>\` first to read the skill's instructions, then follow those instructions to complete the work. Do NOT try to do the work yourself without reading the skill first.`);
    parts.push(`\nHow to use skills:`);
    parts.push(`1. **Match**: Compare the user's request against each skill's description below.`);
    parts.push(`2. **Invoke**: Call \`skill_invoke__<skill_id>\` to read the skill's instructions (SKILL.md).`);
    parts.push(`3. **Execute**: Follow the skill's instructions to complete the work — the skill tells you what tools to call, what scripts to run, and what data to produce.`);
    if (skillsWithView.length > 0) {
      parts.push(`4. **Visualize**: If the skill has an HTML panel, call \`skill_view({ skill_id, page, data })\` with the generated data to open the visual panel.`);
    }
    parts.push(`\n**Available skills:**`);
    const usedPromptSkillIds = new Set<string>();
    for (const skill of skills) {
      let sid = skill.id.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      const baseSid = sid;
      let sfx = 2;
      while (usedPromptSkillIds.has(sid)) { sid = `${baseSid}_${sfx}`; sfx++; }
      usedPromptSkillIds.add(sid);
      const viewNote = skill.hasViewFile
        ? ` [有HTML面板: ${skill.viewFiles?.join(", ")} — 完成后用 skill_view 传入数据打开]`
        : "";
      parts.push(`- **${skill.name}**: ${skill.description || "(无描述)"}${viewNote} → call \`skill_invoke__${sid}\``);
    }
  }

  // ── Guidelines（按 effort 分级）──────────────────────────
  parts.push(`\n# Guidelines`);
  parts.push(`- Respond in the same language the user uses.`);
  parts.push(`- Read existing code before modifying it. Understand context first.`);
  parts.push(`- If a tool call fails, analyze the error — don't retry blindly.`);
  if (effort === "high") {
    parts.push(`- **Deep reasoning mode is ON.** You must think deeply and thoroughly before acting.`);
    parts.push(`- Before responding, spend significant time analyzing the request: what is the user really asking? What are the constraints? What could go wrong?`);
    parts.push(`- Break complex problems into sub-problems. Consider multiple approaches and choose the best one with explicit reasoning.`);
    parts.push(`- Consider edge cases, error handling, and potential regressions before writing any code.`);
    parts.push(`- After completing work, verify results by reading back modified files or running tests.`);
    parts.push(`- If an available skill matches the user's request, invoke the skill FIRST — do not attempt manual workarounds.`);
    parts.push(`- Explain your reasoning process and trade-offs clearly.`);
  } else if (effort === "low") {
    parts.push(`- Be extremely concise. Direct answers, no filler.`);
    parts.push(`- Prefer the simplest solution that works.`);
  } else {
    parts.push(`- For multi-step tasks, plan first, then execute step by step.`);
    parts.push(`- Be concise but thorough.`);
  }

  // ── User Profile ─────────────────────────────────────────
  const personalPromptContext = buildPersonalPromptContext(personalPromptProfile);
  if (personalPromptContext) {
    parts.push(`\n${personalPromptContext}`);
  }

  return parts.join("\n");
}

/**
 * 计算一个会话累计使用的 token 数量。
 */
export function calculateSessionTokens(session: ChatSession): number {
  return session.messages.reduce((sum: number, msg: SessionChatMessage) => {
    return sum + (msg.usage?.totalTokens ?? 0);
  }, 0);
}

/**
 * 当模型摘要不可用时，构建一个兜底摘要。
 */
export function fallbackSummary(messages: SessionChatMessage[]): string {
  const userMsgCount = messages.filter((m) => m.role === "user").length;
  const assistantMsgCount = messages.filter((m) => m.role === "assistant").length;
  const toolMsgCount = messages.filter((m) => m.role === "tool").length;
  return [
    `[对话历史已压缩] 移除了 ${messages.length} 条早期消息`,
    `（${userMsgCount} 条用户消息, ${assistantMsgCount} 条助手消息, ${toolMsgCount} 条工具消息）`,
    `保留了最近消息以维持上下文。`,
  ].join("\n");
}

/**
 * 为当前用户请求生成最小可读的 planner 任务标题。
 * Phase 3 先复用用户输入首行，后续再由正式 planner runtime 替换成结构化拆解结果。
 */
function buildPlanTaskTitle(content: string): string {
  const firstNonEmptyLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) {
    return "Continue current request";
  }

  return firstNonEmptyLine.length > 80
    ? `${firstNonEmptyLine.slice(0, 77)}...`
    : firstNonEmptyLine;
}

// ---------------------------------------------------------------------------
// Task V2 工具执行器
// ---------------------------------------------------------------------------

type TaskToolResult = {
  success: boolean;
  output: string;
  error?: string;
  /** 是否修改了 session.tasks，需要持久化和广播 */
  mutated: boolean;
};

/** 给 task 工具构建稳定的序号视图，避免重复任务把执行顺序和进度弄乱。 */
function buildSerializedTaskList(tasks: Task[]): Array<Record<string, unknown>> {
  const items = buildTaskDisplayItems(tasks);
  const sequenceById = new Map(items.map((item) => [item.task.id, item.sequence]));
  return items.map(({ task, sequence, total }) => ({
    ...task,
    sequence,
    total,
    blockedBySequences: task.blockedBy
      .map((blockedId) => sequenceById.get(blockedId))
      .filter((value): value is number => typeof value === "number"),
    blocksSequences: task.blocks
      .map((blockedId) => sequenceById.get(blockedId))
      .filter((value): value is number => typeof value === "number"),
  }));
}

/** 给单条 task 输出补上 sequence/total，方便模型按顺序继续推进。 */
function buildSerializedTask(tasks: Task[], task: Task): Record<string, unknown> {
  return buildSerializedTaskList(tasks).find((item) => item.id === task.id) ?? task;
}

function executeTaskTool(
  session: ChatSession,
  toolId: string,
  args: Record<string, unknown>,
): TaskToolResult {
  const tasks = session.tasks ?? [];

  try {
    switch (toolId) {
      case "task.create": {
        const input: TaskCreateInput = {
          subject: String(args.subject ?? ""),
          description: String(args.description ?? ""),
          activeForm: args.activeForm != null ? String(args.activeForm) : undefined,
          owner: args.owner != null ? String(args.owner) : undefined,
          status: (args.status as TaskCreateInput["status"]) ?? undefined,
          blocks: Array.isArray(args.blocks) ? args.blocks.map(String) : undefined,
          blockedBy: Array.isArray(args.blockedBy) ? args.blockedBy.map(String) : undefined,
          metadata: args.metadata as Record<string, unknown> | undefined,
        };
        if (!input.subject) {
          return { success: false, output: "", error: "subject is required", mutated: false };
        }
        if (!input.description) {
          return { success: false, output: "", error: "description is required", mutated: false };
        }
        const result = createTask(tasks, input);
        session.tasks = result.tasks;
        return { success: true, output: JSON.stringify(buildSerializedTask(result.tasks, result.created)), mutated: true };
      }

      case "task.list": {
        const all = listTasks(tasks);
        return { success: true, output: JSON.stringify(buildSerializedTaskList(all)), mutated: false };
      }

      case "task.get": {
        const id = String(args.id ?? "");
        if (!id) {
          return { success: false, output: "", error: "id is required", mutated: false };
        }
        const found = getTask(tasks, id);
        if (!found) {
          return { success: false, output: "", error: `Task not found: ${id}`, mutated: false };
        }
        return { success: true, output: JSON.stringify(buildSerializedTask(tasks, found)), mutated: false };
      }

      case "task.update": {
        const id = String(args.id ?? "");
        if (!id) {
          return { success: false, output: "", error: "id is required", mutated: false };
        }
        const input: TaskUpdateInput = {};
        if (args.subject !== undefined) input.subject = String(args.subject);
        if (args.description !== undefined) input.description = String(args.description);
        if (args.activeForm !== undefined) input.activeForm = String(args.activeForm);
        if (args.owner !== undefined) input.owner = String(args.owner);
        if (args.status !== undefined) input.status = args.status as TaskUpdateInput["status"];
        if (args.blocks !== undefined) input.blocks = Array.isArray(args.blocks) ? args.blocks.map(String) : [];
        if (args.blockedBy !== undefined) input.blockedBy = Array.isArray(args.blockedBy) ? args.blockedBy.map(String) : [];
        if (args.metadata !== undefined) input.metadata = args.metadata as Record<string, unknown>;
        const result = updateTask(tasks, id, input);
        session.tasks = result.tasks;
        return { success: true, output: JSON.stringify(buildSerializedTask(result.tasks, result.updated)), mutated: true };
      }

      default:
        return { success: false, output: "", error: `Unknown task tool: ${toolId}`, mutated: false };
    }
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      mutated: false,
    };
  }
}

/** 判断当前计划任务是否属于可直接进入模型/tool loop 的执行步骤。 */
function isExecutablePlanTask(task: { kind?: string; status: string }): boolean {
  return task.kind !== "user_confirmation"
    && (task.status === "pending" || task.status === "in_progress");
}

/** 批准后自动消化确认类步骤，避免把 user_confirmation 当普通执行任务继续推进。 */
function completeApprovedConfirmationTasks(session: ChatSession, now: string): void {
  if (!session.planState) return;
  if (session.planModeState?.mode !== "executing" || session.planModeState.approvalStatus !== "approved") {
    return;
  }

  for (const task of session.planState.tasks) {
    if (task.status === "completed") continue;
    if (task.kind !== "user_confirmation") break;
    if (task.status !== "pending" && task.status !== "in_progress") break;
    if (task.status === "pending") {
      session.planState = startTask(session.planState, task.id, "Waiting for approval resolved", now);
    }
    session.planState = completeTask(session.planState, task.id, "User approved", now);
  }
  syncPlanModeState(session, now);
}

/** 判断当前计划模式下是否还存在待执行的非确认步骤。 */
function hasRemainingExecutablePlanTasks(session: ChatSession): boolean {
  return session.planState?.tasks.some((task) => isExecutablePlanTask(task)) ?? false;
}

/** 判断当前会话是否开启了可见 plan mode。 */
function isPlanModeEnabled(session: ChatSession): boolean {
  const runtimeIntent = resolveSessionRuntimeIntent(session);
  return runtimeIntent.workflowMode === "plan" || runtimeIntent.planModeEnabled === true;
}

/** 将模型返回的内容解析为结构化计划；解析失败时回退为最小单步计划。 */
function parseStructuredPlan(
  content: string,
  fallbackTitle: string,
): StructuredPlan {
  try {
    const parsed = JSON.parse(content) as Partial<StructuredPlan> & { steps?: Array<Partial<StructuredPlan["steps"][number]>> };
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps
        .filter((step): step is NonNullable<typeof step> => !!step && typeof step.title === "string")
        .map((step, index) => ({
          id: typeof step.id === "string" && step.id.trim().length > 0
            ? step.id
            : `plan-step-${index + 1}`,
          title: step.title ?? `Plan step ${index + 1}`,
          status: "pending" as const,
          ...(typeof step.kind === "string" ? { kind: step.kind } : {}),
          ...(typeof step.detail === "string" ? { detail: step.detail } : {}),
          ...(typeof step.lane === "string" ? { lane: step.lane } : {}),
        }))
      : [];

    if (steps.length > 0 && typeof parsed.goal === "string" && parsed.goal.trim().length > 0) {
      return {
        goal: parsed.goal,
        ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
        ...(Array.isArray(parsed.assumptions) ? { assumptions: parsed.assumptions.filter((item): item is string => typeof item === "string") } : {}),
        ...(Array.isArray(parsed.openQuestions) ? { openQuestions: parsed.openQuestions.filter((item): item is string => typeof item === "string") } : {}),
        ...(Array.isArray(parsed.acceptanceCriteria) ? { acceptanceCriteria: parsed.acceptanceCriteria.filter((item): item is string => typeof item === "string") } : {}),
        steps,
      };
    }
  } catch {
    // 计划草案允许模型返回自然语言，这里回退为最小结构化计划。
  }

  return {
    goal: fallbackTitle,
    summary: content.trim() || fallbackTitle,
    steps: [{
      id: "plan-step-1",
      title: fallbackTitle,
      status: "pending",
      kind: "analysis",
    }],
  };
}

/** 将结构化计划物化为会话级 planState 与 planModeState。 */
/** 根据步骤的 lane 或 kind 推导可见工作流分工，便于在复杂计划里展示多轨并行。 */
function derivePlanWorkstreams(tasks: StructuredPlan["steps"]): PlanWorkstream[] {
  const grouped = new Map<string, PlanWorkstream>();

  for (const task of tasks) {
    const workstreamId = task.lane?.trim() || task.kind || "general";
    const existing = grouped.get(workstreamId);
    if (existing) {
      existing.stepIds.push(task.id);
      continue;
    }
    grouped.set(workstreamId, {
      id: workstreamId,
      label: workstreamId,
      status: "pending",
      stepIds: [task.id],
    });
  }

  return [...grouped.values()];
}

/** 根据任务状态刷新分工状态，确保 UI 与执行链路读取到同一份真实进度。 */
function syncPlanWorkstreams(
  planState: ChatSession["planState"],
  workstreams: PlanWorkstream[] | undefined,
): PlanWorkstream[] | undefined {
  if (!planState || !workstreams?.length) return workstreams;

  return workstreams.map((workstream) => {
    const tasks = workstream.stepIds
      .map((stepId) => planState.tasks.find((task) => task.id === stepId))
      .filter((task): task is NonNullable<typeof task> => !!task);

    if (tasks.some((task) => task.status === "blocked")) {
      return { ...workstream, status: "blocked" };
    }
    if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) {
      return { ...workstream, status: "completed" };
    }
    if (tasks.some((task) => task.status === "in_progress")) {
      return { ...workstream, status: "in_progress" };
    }
    return { ...workstream, status: "pending" };
  });
}

/** 推导当前聚焦步骤，帮助深度模式显式告诉模型“这一轮只处理哪一步”。 */
function deriveCurrentPlanTask(session: ChatSession) {
  if (!session.planState) return null;

  return session.planState.tasks.find((task) => task.status === "in_progress")
    ?? session.planState.tasks.find((task) => isExecutablePlanTask(task))
    ?? session.planState.tasks.find((task) => task.status === "pending")
    ?? null;
}

/** 将计划模式映射成 workflow run 摘要，复用既有 workflow-run 契约展示复杂计划执行状态。 */
function buildPlanWorkflowRun(
  session: ChatSession,
  now: string,
  workstreams: PlanWorkstream[] | undefined,
): WorkflowRunSummary | null {
  const workflowModeState = session.planModeState;
  if (!workflowModeState || workflowModeState.workflowMode !== "plan") {
    return null;
  }

  const activeNodeIds = workstreams?.length
    ? workstreams
      .filter((workstream) => workstream.status === "pending" || workstream.status === "in_progress")
      .flatMap((workstream) => workstream.stepIds.slice(0, 1))
    : session.planState?.tasks
      .filter((task) => task.status === "pending" || task.status === "in_progress")
      .map((task) => task.id)
      ?? [];

  const status = workflowModeState.mode === "awaiting_approval"
    ? "queued"
    : workflowModeState.mode === "executing"
      ? "running"
      : workflowModeState.mode === "completed"
        ? "succeeded"
        : workflowModeState.mode === "blocked"
          ? "failed"
          : "queued";

  return {
    id: workflowModeState.workflowRun?.id ?? `plan-run-${session.id}`,
    workflowId: session.id,
    workflowVersion: workflowModeState.planVersion || 1,
    status,
    currentNodeIds: activeNodeIds,
    startedAt: workflowModeState.workflowRun?.startedAt ?? workflowModeState.approvedAt ?? session.createdAt,
    updatedAt: now,
    ...(status === "succeeded" || status === "failed" ? { finishedAt: now } : {}),
  };
}

/** 统一同步当前步骤、工作流分工和 workflow run，避免主流程与 UI 各自推导出不同状态。 */
function syncPlanModeState(session: ChatSession, now: string): void {
  if (!session.planModeState) return;

  const workstreams = syncPlanWorkstreams(session.planState, session.planModeState.workstreams);
  const currentTask = deriveCurrentPlanTask(session);
  const workflowMode = session.planModeState.workflowMode
    ?? (isPlanModeEnabled(session) ? "plan" : undefined);

  session.planModeState = {
    ...session.planModeState,
    ...(workflowMode ? { workflowMode } : {}),
    ...(currentTask
      ? {
          currentTaskId: currentTask.id,
          currentTaskTitle: currentTask.title,
          ...(currentTask.kind ? { currentTaskKind: currentTask.kind } : {}),
        }
      : {
          currentTaskId: undefined,
          currentTaskTitle: undefined,
          currentTaskKind: undefined,
        }),
    ...(workstreams ? { workstreams } : {}),
    workflowRun: buildPlanWorkflowRun(session, now, workstreams),
  };
}

/** 将会话里的 workflow-style run 同步到主进程 registry，供 bootstrap 与 workflow IPC 复用。 */
async function persistPlanWorkflowRun(
  ctx: RuntimeContext,
  session: ChatSession,
): Promise<{
  workflowRunId: string;
  previousRun: WorkflowRunSummary | null;
  previousIndex: number;
} | null> {
  const workflowRun = session.planModeState?.workflowRun;
  if (!workflowRun) return null;

  await saveWorkflowRun(ctx.runtime.paths, workflowRun);

  const existingIndex = ctx.state.workflowRuns.findIndex((item) => item.id === workflowRun.id);
  const previousRun = existingIndex >= 0 ? ctx.state.workflowRuns[existingIndex]! : null;
  if (existingIndex >= 0) {
    ctx.state.workflowRuns[existingIndex] = workflowRun;
  } else {
    ctx.state.workflowRuns.push(workflowRun);
  }

  return {
    workflowRunId: workflowRun.id,
    previousRun,
    previousIndex: existingIndex,
  };
}

/** 回滚 plan-mode workflow run 的持久化副作用，避免 session 保存失败后留下分叉状态。 */
async function rollbackPersistedPlanWorkflowRun(
  ctx: RuntimeContext,
  snapshot: {
    workflowRunId: string;
    previousRun: WorkflowRunSummary | null;
    previousIndex: number;
  } | null,
): Promise<void> {
  if (!snapshot) return;

  try {
    if (snapshot.previousRun) {
      await saveWorkflowRun(ctx.runtime.paths, snapshot.previousRun);
    } else {
      await deleteWorkflowRunFile(ctx.runtime.paths, snapshot.workflowRunId);
    }
  } finally {
    if (snapshot.previousIndex >= 0 && snapshot.previousRun) {
      ctx.state.workflowRuns[snapshot.previousIndex] = snapshot.previousRun;
      return;
    }
    ctx.state.workflowRuns = ctx.state.workflowRuns.filter((item) => item.id !== snapshot.workflowRunId);
  }
}

/** 先同步 workflow run，再保存 session；若 session 保存失败则回滚 run 持久化。 */
async function saveSessionWithPlanWorkflowSync(
  ctx: RuntimeContext,
  session: ChatSession,
): Promise<void> {
  const snapshot = await persistPlanWorkflowRun(ctx, session);
  try {
    await saveSession(ctx.runtime.paths, session);
  } catch (error) {
    try {
      await rollbackPersistedPlanWorkflowRun(ctx, snapshot);
      console.warn("[plan-mode] 会话保存失败，已回滚 workflow run 持久化。");
    } catch (rollbackError) {
      console.warn("[plan-mode] 会话保存失败，且 workflow run 回滚失败。", rollbackError);
    }
    throw error;
  }
}

/** 为规划轮次补充显式 planner 指令，让深度模式先分析需求再返回结构化计划。 */
function buildPlanAnalysisGuidance(content: string): string {
  return [
    "Plan mode is enabled. Do not execute tools yet.",
    "First analyze the user's request, constraints, risks, and likely verification path.",
    "Return strict JSON only.",
    "Schema:",
    "{\"goal\":\"string\",\"summary\":\"string\",\"assumptions\":[\"string\"],\"openQuestions\":[\"string\"],\"acceptanceCriteria\":[\"string\"],\"steps\":[{\"id\":\"string\",\"title\":\"string\",\"kind\":\"analysis|tool|verification|user_confirmation\",\"detail\":\"string\",\"lane\":\"string\"}]}",
    "Use lane to group parallel workstreams when the task is complex.",
    `User request: ${content}`,
  ].join("\n");
}

/** 为执行轮次补充当前步骤指令，确保模型显式围绕当前 step 推进，而不是泛化地继续闲聊。 */
function buildPlanExecutionGuidance(session: ChatSession): string | null {
  const currentTask = deriveCurrentPlanTask(session);
  if (!currentTask) return null;

  const workstreamSummary = session.planModeState?.workstreams?.length
    ? session.planModeState.workstreams
      .map((workstream) => `${workstream.label}:${workstream.status}`)
      .join(", ")
    : "single-track";

  return [
    "Current plan step",
    `- id: ${currentTask.id}`,
    `- title: ${currentTask.title}`,
    `- kind: ${currentTask.kind ?? "analysis"}`,
    `- lane: ${currentTask.lane ?? "general"}`,
    `- parallel workstreams: ${workstreamSummary}`,
    "Only perform work needed for this step. If the step is complete, summarize the outcome and prepare for the next step.",
  ].join("\n");
}

function applyStructuredPlanDraft(
  session: ChatSession,
  structuredPlan: StructuredPlan,
  messageId: string,
  now: string,
): void {
  session.planState = createPlanState(
    structuredPlan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: "pending",
      ...(step.kind ? { kind: step.kind } : {}),
      ...(step.detail ? { detail: step.detail } : {}),
      ...(step.lane ? { lane: step.lane } : {}),
    })),
    now,
  );
  const workstreams = derivePlanWorkstreams(structuredPlan.steps);

  const currentVersion = session.planModeState?.planVersion ?? 0;
  session.planModeState = {
    mode: "awaiting_approval",
    workflowMode: "plan",
    approvalStatus: "pending",
    planVersion: currentVersion + 1,
    lastPlanMessageId: messageId,
    ...(structuredPlan.summary ? { summary: structuredPlan.summary } : {}),
    goal: structuredPlan.goal,
    structuredPlan,
    ...(workstreams.length > 1 ? { workstreams } : {}),
  };
  syncPlanModeState(session, now);
}

/** 生成显式计划草案后，写入 assistant 消息并广播当前会话状态。 */
async function finalizePlanDraftRound(
  ctx: RuntimeContext,
  session: ChatSession,
  sessionId: string,
  messageId: string,
  content: string,
  now: string,
): Promise<SessionPayload> {
  session.messages.push({
    id: messageId,
    role: "assistant",
    content,
    createdAt: now,
  });

  await saveSessionWithPlanWorkflowSync(ctx, session);
  broadcastToRenderers("session:stream", {
    type: EventType.MessageCompleted,
    sessionId,
    messageId,
  });
  broadcastToRenderers("session:stream", {
    type: EventType.SessionUpdated,
    sessionId,
    session,
  });
  return { session };
}

/**
 * 为当前 round 选择一个活跃 planner 任务。
 * 默认只延续 pending / in_progress 任务；blocked 任务必须等待后续显式恢复策略，不参与下一轮的默认控制流。
 * 如果会话还没有计划状态，或现有任务都不可直接延续，则追加一个新的最小任务。
 */
function ensurePlanTaskForRound(
  session: ChatSession,
  content: string,
  taskId: string,
  now: string,
): string {
  completeApprovedConfirmationTasks(session, now);

  if (session.planModeState?.mode === "executing" && session.planState?.tasks.length) {
    const executableTask = session.planState.tasks.find((task) => isExecutablePlanTask(task));
    if (executableTask) {
      return executableTask.id;
    }
  }

  if (!session.planState || session.planState.tasks.length === 0) {
    session.planState = createPlanState([{
      id: taskId,
      title: buildPlanTaskTitle(content),
    }], now);
    return taskId;
  }

  const activeTask = session.planState.tasks.find((task) => {
    return task.status === "pending" || task.status === "in_progress";
  });
  if (activeTask) {
    return activeTask.id;
  }

  session.planState = {
    ...session.planState,
    tasks: [
      ...session.planState.tasks,
      {
        id: taskId,
        title: buildPlanTaskTitle(content),
        status: "pending",
      },
    ],
    updatedAt: now,
  };
  return taskId;
}

/** 在计划模式执行中，先自动消化确认步骤，再挑选下一个真正可执行的步骤。 */
function selectPlanModeTaskForRound(
  session: ChatSession,
  content: string,
  taskId: string,
  now: string,
): string | null {
  completeApprovedConfirmationTasks(session, now);

  if (!session.planState || session.planState.tasks.length === 0) {
    session.planState = createPlanState([{
      id: taskId,
      title: buildPlanTaskTitle(content),
    }], now);
    return taskId;
  }

  const executableTask = session.planState.tasks.find((task) => isExecutablePlanTask(task));
  return executableTask?.id ?? null;
}

/** 在进入模型/tool loop 前，把本轮任务标记为执行中，便于上下文装配与 UI 读取最新 planner 进度。 */
function markPlanTaskInProgress(
  session: ChatSession,
  taskId: string,
  round: number,
  now: string,
): void {
  if (!session.planState) return;
  if (isPlanTaskBlocked(session, taskId)) return;
  session.planState = startTask(
    session.planState,
    taskId,
    `Round ${round} executing`,
    now,
  );
  syncPlanModeState(session, now);
}

/** 当本轮正常完成时，把 planner 任务标记为完成并更新时间戳。 */
function markPlanTaskCompleted(
  session: ChatSession,
  taskId: string,
  now: string,
): void {
  if (!session.planState) return;
  if (isPlanTaskBlocked(session, taskId)) return;
  session.planState = completeTask(session.planState, taskId, "Round completed", now);
  syncPlanModeState(session, now);
}

/** 当本轮异常中断时，把 planner 任务显式标记为阻塞，避免持久化为不透明的悬空 in_progress。 */
function markPlanTaskBlocked(
  session: ChatSession,
  taskId: string,
  blocker: string,
  now: string,
): void {
  if (!session.planState) return;
  session.planState = blockTask(
    session.planState,
    taskId,
    blocker,
    now,
    "Round interrupted",
  );
  syncPlanModeState(session, now);
}

type ToolPlanProgressInput = {
  toolName: string;
  succeeded: boolean;
  failureReason?: string;
  now: string;
};

function getPlanTask(session: ChatSession, taskId: string) {
  return session.planState?.tasks.find((task) => task.id === taskId) ?? null;
}

function isPlanTaskBlocked(session: ChatSession, taskId: string): boolean {
  return getPlanTask(session, taskId)?.status === "blocked";
}

/** 把工具循环中的单步结果折叠到当前任务，便于 UI/上下文读取“刚刚发生了什么”。 */
function markPlanTaskToolProgress(
  session: ChatSession,
  taskId: string,
  input: ToolPlanProgressInput,
): void {
  if (!session.planState) return;

  const activeTask = session.planState.tasks.find((task) => task.id === taskId);
  if (!activeTask) return;

  if (!input.succeeded) {
    session.planState = blockTask(
      session.planState,
      taskId,
      input.failureReason ?? `Tool failed: ${input.toolName}`,
      input.now,
      `Tool failed: ${input.toolName}`,
    );
    syncPlanModeState(session, input.now);
    return;
  }

  if (activeTask.status === "blocked") {
    session.planState = blockTask(
      session.planState,
      taskId,
      activeTask.blocker ?? `Tool failed: ${input.toolName}`,
      input.now,
      `Waiting after failed tool: ${input.toolName}`,
    );
    syncPlanModeState(session, input.now);
    return;
  }

  session.planState = startTask(
    session.planState,
    taskId,
    `Tool completed: ${input.toolName}`,
    input.now,
  );
  syncPlanModeState(session, input.now);
}

// ---------------------------------------------------------------------------
// IPC 处理器
// ---------------------------------------------------------------------------

export function registerSessionHandlers(ctx: RuntimeContext): void {
  const backgroundTaskManager = createBackgroundTaskManager();
  // 创建新的聊天会话
  ipcMain.handle("session:create", async (_event, input: CreateSessionInput): Promise<SessionPayload> => {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      title: input?.title ?? "New Chat",
      modelProfileId: input?.modelProfileId ?? ctx.state.getDefaultModelProfileId() ?? "",
      attachedDirectory: input?.attachedDirectory ?? null,
      createdAt: now,
      runtimeVersion: SESSION_RUNTIME_VERSION,
      messages: [],
    };

    ctx.state.sessions.push(session);

    await saveSession(ctx.runtime.paths, session);

    return { session };
  });

  // 按 ID 删除会话
  ipcMain.handle("session:delete", async (_event, sessionId: string): Promise<SessionsPayload> => {
    const session = ctx.state.sessions.find((s) => s.id === sessionId);
    const index = ctx.state.sessions.findIndex((s) => s.id === sessionId);
    if (index !== -1) {
      ctx.state.sessions.splice(index, 1);
    }

    await deleteSessionFiles(ctx.runtime.paths, sessionId, session?.siliconPersonId);

    // 如果被删的 session 归属硅基员工，同步清理该员工的 sessions 摘要
    if (session?.siliconPersonId) {
      const siliconPerson = ctx.state.siliconPersons.find((sp) => sp.id === session.siliconPersonId);
      if (siliconPerson) {
        siliconPerson.sessions = siliconPerson.sessions.filter((s) => s.id !== sessionId);
        siliconPerson.unreadCount = siliconPerson.sessions.reduce((total, s) => total + s.unreadCount, 0);
        siliconPerson.hasUnread = siliconPerson.sessions.some((s) => s.hasUnread);
        siliconPerson.needsApproval = siliconPerson.sessions.some((s) => s.needsApproval);
        if (siliconPerson.currentSessionId === sessionId) {
          siliconPerson.currentSessionId = siliconPerson.sessions[0]?.id ?? null;
        }
        siliconPerson.updatedAt = new Date().toISOString();
        trackSave(
          saveSiliconPerson(ctx.runtime.paths, siliconPerson).catch((error) => {
            console.error("[session:delete] 同步硅基员工摘要持久化失败", {
              siliconPersonId: siliconPerson.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        );
      }
    }

    return {
      sessions: [...ctx.state.sessions],
      approvalRequests: ctx.state.getApprovalRequests().filter((r) => r.sessionId !== sessionId),
    };
  });

  // -------------------------------------------------------------------------
  // 发送消息：进入 agentic 工具循环
  // -------------------------------------------------------------------------

  const handleSessionSendMessage = async (
    _event: unknown,
    sessionId: string,
    input: SendMessageInput,
  ): Promise<SessionPayload> => {
      const session = ctx.state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      ensureSessionRuntimeVersion(session);

      const runId = randomUUID();
      const messageId = randomUUID();
      const now = new Date().toISOString();
      const initialPlanModeEnabled = session.runtimeIntent != null
        && (
          ((session.runtimeIntent as { workflowMode?: string }).workflowMode === "plan")
          || ((session.runtimeIntent as { planModeEnabled?: boolean }).planModeEnabled === true)
        );
      const initialPhase: ChatRunPhase = (
        initialPlanModeEnabled
        && session.planModeState?.mode !== "executing"
      )
        ? "planning"
        : "model";
      const abortController = new AbortController();
      const activeRun: ActiveSessionRun = {
        runId,
        abortController,
        status: "running",
        phase: initialPhase,
        currentMessageId: messageId,
        pendingApprovalIds: [],
        cancelRequested: false,
      };
      const streamedDrafts = new Map<string, { content: string; reasoning?: string }>();
      let currentMessageId = messageId;
      let terminalStatus: ChatRunStatus = "failed";
      let terminalReason: string | null = null;
      let activePlanTaskId: string | null = null;

      getActiveSessionRuns(ctx).set(sessionId, activeRun);
      syncChatRunState(session, sessionId, activeRun, {
        runId,
        status: "running",
        phase: initialPhase,
        messageId: currentMessageId,
        reason: null,
      });

      // 新轮次开始：清理上一轮已完成的 task，保持面板干净
      if (session.tasks && session.tasks.length > 0) {
        const clearResult = clearCompletedTasks(session.tasks);
        if (clearResult.cleared > 0) {
          session.tasks = clearResult.tasks;
          broadcastToRenderers("session:stream", {
            type: EventType.TasksUpdated,
            sessionId,
            tasks: session.tasks,
          });
        }
      }

      // 追加用户消息
      session.messages.push({
        id: randomUUID(),
        role: "user",
        content: input.content,
        createdAt: now,
      });
      await syncSiliconPersonSummaryForSession(ctx, session);

      // 通知渲染层本轮运行已开始
      broadcastToRenderers("session:stream", {
        type: EventType.RunStarted,
        sessionId,
        messageId: currentMessageId,
      });

      // 解析当前会话应使用的模型配置
      const profileId = session.modelProfileId || ctx.state.getDefaultModelProfileId();
      let modelProfile = ctx.state.models.find((m) => m.id === profileId);
      if (!modelProfile && profileId) {
        console.warn("[sessions] 会话绑定的模型已被删除，回落到默认模型", {
          sessionId,
          missingProfileId: profileId,
          siliconPersonId: session.siliconPersonId ?? null,
        });
      }
      modelProfile = modelProfile ?? ctx.state.models[0];

      if (!modelProfile) {
        const errorContent = "错误：未配置任何模型。请在设置中添加一个模型配置。";
        broadcastToRenderers("session:stream", {
          type: EventType.MessageDelta,
          sessionId,
          messageId,
          delta: { content: errorContent },
        });
        session.messages.push({
          id: messageId,
          role: "assistant",
          content: errorContent,
          createdAt: new Date().toISOString(),
        });
        broadcastToRenderers("session:stream", {
          type: EventType.MessageCompleted,
          sessionId,
          messageId,
        });
        broadcastToRenderers("session:stream", {
          type: EventType.SessionUpdated,
          sessionId,
          session,
        });
        syncChatRunState(session, sessionId, null, {
          runId,
          status: "failed",
          phase: initialPhase,
          messageId,
          reason: "model_profile_missing",
        });
        await syncSiliconPersonSummaryForSession(ctx, session);
        getActiveSessionRuns(ctx).delete(sessionId);
        return { session };
      }

      // 硅基员工使用自己工作空间的 skills、MCP 和独立工作目录；主助手使用全局资源
      const personWorkspace = session.siliconPersonId
        ? await getOrCreateWorkspace(ctx.runtime.paths, session.siliconPersonId)
        : null;

      // 为函数调用构建工具 schema；硅基员工在自己的 workspace/ 目录工作
      const workingDir = personWorkspace
        ? personWorkspace.paths.workspaceDir
        : (session.attachedDirectory || ctx.runtime.myClawRootPath || process.cwd());

      const allSkills = personWorkspace ? personWorkspace.skills : ctx.state.skills;
      const enabledSkills = allSkills.filter((s) => s.enabled && !s.disableModelInvocation);
      const activeMcpManager = personWorkspace ? personWorkspace.mcpManager : ctx.services.mcpManager;

      // 汇总已连接 MCP 服务提供的工具
      const mcpTools = activeMcpManager?.getAllTools() ?? [];
      // 用当前技能与路径权限刷新工具执行器（硅基员工使用自己的技能）
      toolExecutor.setSkills(allSkills);
      toolExecutor.setAllowExternalPaths(allowsExternalPaths(ctx.state.getApprovals().mode));

      // ----- 预先异步计算 Git 分支（非阻塞） -----
      const gitBranch = await getGitBranchAsync(workingDir);

      // 创建一个绑定版 system prompt 构造器，复用已缓存的 Git 分支
      // 避免在每次 agentic 循环中都执行一次 execSync
      // 冻结本轮 runtimeIntent 快照：运行中允许用户修改配置，但只能影响下一次发送
      // enrichedContext 在每轮动态提取，因为 session messages 和 tasks 会随循环变化
      const runRuntimeIntentSnapshot = cloneExplicitRuntimeIntent(session.runtimeIntent);
      const resolvedRunRuntimeIntent = resolveSessionRuntimeIntent(
        runRuntimeIntentSnapshot === undefined ? session : { runtimeIntent: runRuntimeIntentSnapshot },
      );
      const runReasoningEffort = resolvedRunRuntimeIntent.reasoningEffort as "low" | "medium" | "high" | undefined;
      const frozenExecutionPlanSession = buildExecutionPlanSessionFromRuntimeIntentSnapshot(
        runRuntimeIntentSnapshot,
        resolvedRunRuntimeIntent,
      );
      const initialResolvedCapability = resolveModelCapability(modelProfile);
      const initialExecutionPlan = buildExecutionPlan({
        session: frozenExecutionPlanSession,
        profile: modelProfile,
        capability: initialResolvedCapability.effective,
      }) as ResolvedExecutionPlan;
      const initialTurnExecutionPlan = resolveTurnExecutionPlan({
        profile: modelProfile,
        legacyExecutionPlan: initialExecutionPlan,
        capability: initialResolvedCapability.effective,
        selectedModelProfileId: modelProfile.id,
      });

      const tools = buildToolSchemas(
        workingDir,
        enabledSkills,
        mcpTools,
        initialTurnExecutionPlan.toolPolicyId,
      );

      console.info("[session:send-message] tools summary", {
        siliconPersonId: session.siliconPersonId ?? null,
        totalSkills: allSkills.length,
        enabledSkills: enabledSkills.length,
        enabledSkillNames: enabledSkills.map(s => s.name),
        mcpTools: mcpTools.length,
        toolPolicyId: initialTurnExecutionPlan.toolPolicyId,
        totalTools: tools.length,
        toolNames: tools.map(t => t.function.name),
      });

      // 硅基员工身份信息，注入系统提示
      const siliconPersonIdentity = session.siliconPersonId
        ? ctx.state.siliconPersons.find((sp) => sp.id === session.siliconPersonId) ?? null
        : null;

      const boundBuildSystemPrompt = (s: ChatSession, wd: string, sk?: SkillDefinition[]) => {
        const enriched = extractEnrichedContext(s);
        const enrichedBlock = buildEnrichedContextBlock(enriched);
        let prompt = buildSystemPrompt(s, wd, sk, gitBranch, ctx.state.getPersonalPromptProfile(), runReasoningEffort, enrichedBlock || null, mcpTools);

        // 硅基员工身份注入：告诉模型自己是谁、在哪工作
        if (siliconPersonIdentity) {
          const spBlock = [
            `\n# Silicon Person Identity`,
            `You are a Silicon Person (硅基员工), an autonomous AI worker with your own isolated workspace.`,
            `- Name: ${siliconPersonIdentity.name}`,
            `- Title: ${siliconPersonIdentity.title}`,
            siliconPersonIdentity.soul ? `- Persona: ${siliconPersonIdentity.soul}` : null,
            `- Workspace: ${wd}`,
            `\n## Workspace Rules`,
            `- All file operations (read, write, create, execute) happen within your workspace directory: ${wd}`,
            `- Your skills are stored in your own skills directory, separate from the main assistant.`,
            `- You operate independently. When asked to create files, scripts, or skills, write them in YOUR workspace unless the user explicitly specifies a different path.`,
            `- Do not modify files outside your workspace without explicit user instruction.`,
          ].filter(Boolean).join("\n");
          prompt = `${prompt}\n${spBlock}`;
        }

        return prompt;
      };
      const executionGateway = createExecutionGateway({
        paths: ctx.runtime.paths,
        artifactManager: ctx.services.artifactManager,
        computerHarness: createComputerActionHarness({
          browser: resolveComputerHarnessBrowser(toolExecutor),
          requestApproval: async (approvalInput) => {
            const toolId = approvalInput.toolId || getComputerActionToolId(approvalInput.action);
            const label = approvalInput.label || buildComputerActionLabel(approvalInput.action);
            const risk = approvalInput.risk || getComputerActionRisk(approvalInput.action);
            const source = getApprovalSource(toolId);
            const policy = resolveApprovalPolicyForSession(ctx, session);
            const needsApproval = shouldRequestApproval({ policy, source, toolId, risk });

            if (!needsApproval) {
              return { approved: true, reason: null };
            }

            const approvalId = randomUUID();
            const approvalRequest: ApprovalRequest = {
              id: approvalId,
              sessionId,
              source,
              toolId,
              label,
              risk,
              detail: approvalInput.detail,
            };

            syncChatRunState(session, sessionId, activeRun, {
              runId,
              status: activeRun.cancelRequested ? "canceling" : "running",
              phase: "approval",
              messageId: currentMessageId,
              reason: activeRun.cancelRequested ? "user_requested" : null,
            });
            ctx.state.setApprovalRequests([...ctx.state.getApprovalRequests(), approvalRequest]);
            await syncSiliconPersonSummaryForSession(ctx, session);

            broadcastToRenderers("session:stream", {
              type: EventType.ApprovalRequested,
              sessionId,
              approvalRequest,
            });

            activeRun.pendingApprovalIds.push(approvalId);
            const decision = await new Promise<"approve" | "deny" | "canceled">((resolve) => {
              const timeout = setTimeout(() => {
                if (pendingApprovals.has(approvalId)) {
                  pendingApprovals.get(approvalId)?.resolve("deny");
                  pendingApprovals.delete(approvalId);
                  console.warn(`[approval] Timed out approval ${approvalId} after 5 minutes`);
                }
              }, 5 * 60 * 1000);
              pendingApprovals.set(approvalId, { resolve, timeout });
            });

            const pending = pendingApprovals.get(approvalId);
            if (pending) clearTimeout(pending.timeout);
            pendingApprovals.delete(approvalId);
            activeRun.pendingApprovalIds = activeRun.pendingApprovalIds.filter((id) => id !== approvalId);
            ctx.state.setApprovalRequests(
              ctx.state.getApprovalRequests().filter((request) => request.id !== approvalId),
            );
            await syncSiliconPersonSummaryForSession(ctx, session);

            if (decision === "canceled") {
              const abortError = new Error("User requested cancellation");
              abortError.name = "AbortError";
              throw abortError;
            }

            return {
              approved: decision !== "deny",
              reason: decision === "deny" ? "user_denied" : null,
            };
          },
        }),
      });

      if ((resolvedRunRuntimeIntent.workflowMode === "plan" || resolvedRunRuntimeIntent.planModeEnabled === true) && session.planModeState?.mode !== "executing") {
        const resolved = resolveModelCapability(modelProfile);
        const executionPlan = {
          ...(buildExecutionPlan({
            session: frozenExecutionPlanSession,
            profile: modelProfile,
            capability: resolved.effective,
          }) as ResolvedExecutionPlan),
          workflowMode: "plan" as const,
          phase: "analysis" as const,
        };
        const sessionWithExecutionPlan = session as SessionWithExecutionPlan;
        session.runtimeVersion = executionPlan.runtimeVersion;
        sessionWithExecutionPlan.executionPlan = executionPlan;
        session.planModeState = {
          ...(session.planModeState ?? {
            mode: "planning",
            approvalStatus: "pending",
            planVersion: 0,
          } as PlanModeState),
          mode: "planning",
          workflowMode: "plan",
          approvalStatus: "pending",
        };
        const assembled = assembleContext({
          session,
          capability: resolved.effective,
          policy: modelProfile.budgetPolicy,
          workingDir,
          skills: enabledSkills,
          systemPromptBuilder: boundBuildSystemPrompt,
          executionPlan,
        });
        const turnExecutionPlan = resolveTurnExecutionPlan({
          profile: modelProfile,
          legacyExecutionPlan: executionPlan,
          capability: resolved.effective,
          selectedModelProfileId: modelProfile.id,
        });
        const plannerSections = buildSessionPromptSections({
          session,
          workingDir,
          skills: enabledSkills,
          gitBranch,
          personalPromptProfile: ctx.state.getPersonalPromptProfile(),
          reasoningEffort: runReasoningEffort,
          enrichedContextBlock: buildEnrichedContextBlock(extractEnrichedContext(session)) || null,
          artifactContextBlock: buildArtifactContextBlock({
            artifactRegistry: ctx.services.artifactRegistry,
            sessionId: session.id,
            siliconPersonId: session.siliconPersonId ?? null,
          }),
          meetingContextBlock: buildMeetingContextBlock(ctx, session),
          mcpTools,
          providerFamily: turnExecutionPlan.providerFamily,
          experienceProfileId: turnExecutionPlan.experienceProfileId,
          promptPolicyId: turnExecutionPlan.promptPolicyId,
          toolPolicyId: turnExecutionPlan.toolPolicyId,
          reasoningProfileId: turnExecutionPlan.reasoningProfileId,
          siliconPersonIdentity,
          extraGuidance: buildPlanAnalysisGuidance(input.content),
        });
        const plannerContent = buildCanonicalTurnContent({
          systemSections: plannerSections,
          legacyMessages: stripSystemMessages(assembled.messages as ModelChatMessage[]),
          tasks: session.tasks,
          replayPolicy: turnExecutionPlan.legacyExecutionPlan.replayPolicy,
        });
        console.info("[session:runtime] 已切换 canonical 计划执行入口", {
          sessionId,
          providerFamily: turnExecutionPlan.providerFamily,
          protocolTarget: turnExecutionPlan.protocolTarget,
          sectionCount: plannerSections.length,
        });
        const result = await executionGateway.executeTurn({
          mode: "canonical",
          profile: modelProfile,
          content: plannerContent,
          toolSpecs: [],
          plan: turnExecutionPlan,
          previousResponseId: resolvePreviousResponseIdForSessionTurn(
            ctx,
            session,
            modelProfile,
            turnExecutionPlan.protocolTarget,
          ),
          sessionId,
          onDelta: (delta: { content?: string; reasoning?: string }) => {
            appendStreamDraft(streamedDrafts, currentMessageId, delta);
            broadcastToRenderers("session:stream", {
              type: EventType.MessageDelta,
              sessionId,
              messageId: currentMessageId,
              delta,
            });
          },
          signal: abortController.signal,
        });
        session.turnExecutionPlan = result.plan;
        session.lastTurnOutcomeId = result.outcome.id;
        syncSessionBackgroundTaskSnapshot(ctx.runtime.paths, session, result.outcome);
        await persistSessionTurnOutcomeMetrics(ctx, result.outcome, {
          toolCallCount: result.toolCalls.length,
          toolSuccessCount: 0,
          contextStability: !assembled.wasCompacted,
        });
        const structuredPlan = parseStructuredPlan(result.content, buildPlanTaskTitle(input.content));
        applyStructuredPlanDraft(session, structuredPlan, messageId, new Date().toISOString());
        terminalStatus = "completed";
        const payload = await finalizePlanDraftRound(
          ctx,
          session,
          sessionId,
          messageId,
          result.content,
          new Date().toISOString(),
        );
        syncChatRunState(session, sessionId, null, {
          runId,
          status: "completed",
          phase: "planning",
          messageId,
          reason: null,
        });
        getActiveSessionRuns(ctx).delete(sessionId);
        return payload;
      }

      activePlanTaskId = session.planModeState?.mode === "executing"
        ? selectPlanModeTaskForRound(session, input.content, messageId, now)
        : ensurePlanTaskForRound(session, input.content, messageId, now);

      if (!activePlanTaskId) {
        session.planModeState = session.planModeState
          ? {
              ...session.planModeState,
              mode: "completed",
              approvalStatus: "approved",
            }
          : session.planModeState;
        syncPlanModeState(session, new Date().toISOString());
        await saveSessionWithPlanWorkflowSync(ctx, session);
        broadcastToRenderers("session:stream", {
          type: EventType.SessionUpdated,
          sessionId,
          session,
        });
        syncChatRunState(session, sessionId, null, {
          runId,
          status: "completed",
          phase: initialPhase,
          messageId: currentMessageId,
          reason: null,
        });
        getActiveSessionRuns(ctx).delete(sessionId);
        return { session };
      }

      // ----- Agentic 循环：调用模型 → 执行工具 → 回填结果 → 重复 -----
      let round = 0;
      const roundSignatures: string[] = [];
      let loopWarningInjected = false;
      let completedNormally = false;
      let compactionCount = 0;
      let suggestNewChatSent = false;
      /** Task V2 续行计数：模型在 task 未完成时停止响应，系统最多自动续行几次。 */
      let taskContinuationCount = 0;
      const MAX_TASK_CONTINUATIONS = 3;

      try {
        while (true) {
          round++;
          markPlanTaskInProgress(session, activePlanTaskId, round, new Date().toISOString());
          broadcastToRenderers("session:stream", {
            type: EventType.SessionUpdated,
            sessionId,
            session,
          });
          // 使用显式编排链路：intent → capability → plan → context → execute
          const resolved = resolveModelCapability(modelProfile);
          const executionPlan = buildExecutionPlan({
            session: frozenExecutionPlanSession,
            profile: modelProfile,
            capability: resolved.effective,
          }) as ResolvedExecutionPlan;
          const turnExecutionPlan = resolveTurnExecutionPlan({
            profile: modelProfile,
            legacyExecutionPlan: executionPlan,
            capability: resolved.effective,
            selectedModelProfileId: modelProfile.id,
          });
          const sessionWithExecutionPlan = session as SessionWithExecutionPlan;
          session.runtimeVersion = executionPlan.runtimeVersion;
          sessionWithExecutionPlan.executionPlan = executionPlan;
          session.turnExecutionPlan = turnExecutionPlan;
          console.info("[session:runtime] 已生成执行计划", {
            sessionId,
            round,
            runtimeIntent: resolvedRunRuntimeIntent,
            adapterId: executionPlan.adapterId,
            replayPolicy: executionPlan.replayPolicy,
            degradationReason: executionPlan.degradationReason,
            planSource: executionPlan.planSource,
            fallbackAdapterIds: executionPlan.fallbackAdapterIds,
          });
          const assembled = assembleContext({
            session,
            capability: resolved.effective,
            policy: modelProfile.budgetPolicy,
            workingDir,
            skills: enabledSkills,
            systemPromptBuilder: boundBuildSystemPrompt,
            executionPlan,
            priorCompactionCount: compactionCount,
          });
          if (assembled.wasCompacted) {
            compactionCount++;
            console.info(
              `[session:context] Round ${round}: compacted ${assembled.removedCount} messages` +
              ` (${assembled.compactionReason}), masked ${assembled.maskedToolOutputCount} tool outputs` +
              `, budget used: ${assembled.budgetUsed}`,
            );
          }
          if (assembled.shouldSuggestNewChat && !suggestNewChatSent) {
            suggestNewChatSent = true;
            broadcastToRenderers("session:stream", {
              type: EventType.ContextLimitWarning,
              sessionId,
              compactionCount,
              removedCount: assembled.removedCount,
              maskedToolOutputCount: assembled.maskedToolOutputCount,
            });
          }
          const executionGuidance = buildPlanExecutionGuidance(session);
          const canonicalSections = buildSessionPromptSections({
            session,
            workingDir,
            skills: enabledSkills,
            gitBranch,
          personalPromptProfile: ctx.state.getPersonalPromptProfile(),
          reasoningEffort: runReasoningEffort,
          enrichedContextBlock: buildEnrichedContextBlock(extractEnrichedContext(session)) || null,
          artifactContextBlock: buildArtifactContextBlock({
            artifactRegistry: ctx.services.artifactRegistry,
            sessionId: session.id,
            siliconPersonId: session.siliconPersonId ?? null,
          }),
          meetingContextBlock: buildMeetingContextBlock(ctx, session),
          mcpTools,
          providerFamily: turnExecutionPlan.providerFamily,
            experienceProfileId: turnExecutionPlan.experienceProfileId,
            promptPolicyId: turnExecutionPlan.promptPolicyId,
            toolPolicyId: turnExecutionPlan.toolPolicyId,
            reasoningProfileId: turnExecutionPlan.reasoningProfileId,
            siliconPersonIdentity,
            extraGuidance: executionGuidance,
          });
          const canonicalToolSpecs = buildCanonicalToolRegistry(
            workingDir,
            enabledSkills,
            mcpTools,
            turnExecutionPlan.toolPolicyId,
          );
          const canonicalContent = buildCanonicalTurnContent({
            systemSections: canonicalSections,
            legacyMessages: stripSystemMessages(assembled.messages as ModelChatMessage[]),
            tasks: session.tasks,
            replayPolicy: turnExecutionPlan.legacyExecutionPlan.replayPolicy,
          });
          console.info("[session:runtime] 已切换 canonical 执行入口", {
            sessionId,
            round,
            providerFamily: turnExecutionPlan.providerFamily,
            protocolTarget: turnExecutionPlan.protocolTarget,
            toolSpecCount: canonicalToolSpecs.length,
          });

          syncChatRunState(session, sessionId, activeRun, {
            runId,
            status: activeRun.cancelRequested ? "canceling" : "running",
            phase: "model",
            messageId: currentMessageId,
            reason: activeRun.cancelRequested ? "user_requested" : null,
          });

          const result = await executionGateway.executeTurn({
            mode: "canonical",
            profile: modelProfile,
            content: canonicalContent,
            toolSpecs: canonicalToolSpecs,
            plan: turnExecutionPlan,
            previousResponseId: resolvePreviousResponseIdForSessionTurn(
              ctx,
              session,
              modelProfile,
              turnExecutionPlan.protocolTarget,
            ),
            sessionId,
            onDelta: (delta: { content?: string; reasoning?: string }) => {
              appendStreamDraft(streamedDrafts, currentMessageId, delta);
              broadcastToRenderers("session:stream", {
                type: EventType.MessageDelta,
                sessionId,
                messageId: currentMessageId,
                delta,
              });
            },
            signal: abortController.signal,
          });
          session.turnExecutionPlan = result.plan;
          session.lastTurnOutcomeId = result.outcome.id;
          syncSessionBackgroundTaskSnapshot(ctx.runtime.paths, session, result.outcome);
          await persistSessionTurnOutcomeMetrics(ctx, result.outcome, {
            toolCallCount: result.toolCalls.length,
            toolSuccessCount: 0,
            contextStability: !assembled.wasCompacted,
          });

          // 检查模型是否发起了工具调用
          const hasToolCalls = result.toolCalls.length > 0;

          if (hasToolCalls) {
            // 追加带 tool_calls 的 assistant 消息（content 可能为空）
            const assistantMsg = {
              id: currentMessageId,
              role: "assistant" as const,
              content: result.content || "",
              ...(result.reasoning ? { reasoning: result.reasoning } : {}),
              ...(result.usage ? { usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens } } : {}),
              tool_calls: result.toolCalls.map((tc: ResolvedToolCall) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.argumentsJson },
              })),
              createdAt: new Date().toISOString(),
            };
            session.messages.push(assistantMsg);

            // 广播带工具调用信息的 assistant 消息
            broadcastToRenderers("session:stream", {
              type: EventType.MessageCompleted,
              sessionId,
              messageId: currentMessageId,
            });
            // 广播会话更新，让渲染层实时展示 tool_calls
            broadcastToRenderers("session:stream", {
              type: EventType.SessionUpdated,
              sessionId,
              session,
            });

            // ---- Phase Gate：阻止规划与执行在同一轮混合 ----
            // 如果模型在同一轮 response 中同时调用了 task_create 和非 task 类工具，
            // 拒绝非 task 类工具，强制模型先完成规划再执行。
            const phaseRejectedToolCallIds = new Set<string>();
            const isTaskFamilyToolCall = (name: string): boolean => {
              const tid = functionNameToToolId(name);
              return tid.startsWith("task.");
            };
            const hasTaskCreateInThisRound = result.toolCalls.some(
              (tc: ResolvedToolCall) => functionNameToToolId(tc.name) === "task.create",
            );
            if (hasTaskCreateInThisRound) {
              for (const tc of result.toolCalls) {
                if (!isTaskFamilyToolCall(tc.name)) {
                  phaseRejectedToolCallIds.add(tc.id);
                }
              }
              if (phaseRejectedToolCallIds.size > 0) {
                console.info("[session:phase-gate] 阻止规划阶段执行工作工具", {
                  sessionId,
                  round,
                  rejectedCount: phaseRejectedToolCallIds.size,
                  rejectedTools: result.toolCalls
                    .filter((tc: ResolvedToolCall) => phaseRejectedToolCallIds.has(tc.id))
                    .map((tc: ResolvedToolCall) => tc.name),
                });
                for (const tc of result.toolCalls) {
                  if (!phaseRejectedToolCallIds.has(tc.id)) continue;
                  session.messages.push({
                    id: randomUUID(),
                    role: "tool" as const,
                    content: "[阶段冲突] 你正在创建任务（规划阶段），不能同时执行工作工具。请先用 task_create 完成所有任务的创建，然后在下一轮开始按顺序执行任务（task_update → 工作工具 → task_update）。",
                    tool_call_id: tc.id,
                    createdAt: new Date().toISOString(),
                  });
                  broadcastToRenderers("session:stream", {
                    type: EventType.ToolFailed,
                    sessionId,
                    toolCallId: tc.id,
                    toolId: functionNameToToolId(tc.name),
                    error: "[阶段冲突] 规划阶段不可执行工作工具",
                  });
                }
                broadcastToRenderers("session:stream", {
                  type: EventType.SessionUpdated,
                  sessionId,
                  session,
                });
              }
            }

            // ---- 第 1 步：检查所有工具调用的审批（串行执行，需要等待用户） ----
            type ApprovedTool = { toolCall: ResolvedToolCall; denied: boolean };
            type PendingToolApproval = { toolCall: ResolvedToolCall; approvalId: string; approvalRequest: ApprovalRequest };
            const approvedTools: ApprovedTool[] = [];
            const queuedReadOnlyApprovals: PendingToolApproval[] = [];

            const awaitApprovalDecision = async (approvalId: string): Promise<"approve" | "deny" | "canceled"> => {
              return new Promise<"approve" | "deny" | "canceled">((resolve) => {
                const timeout = setTimeout(() => {
                  if (pendingApprovals.has(approvalId)) {
                    pendingApprovals.get(approvalId)?.resolve("deny");
                    pendingApprovals.delete(approvalId);
                    console.warn(`[approval] Timed out approval ${approvalId} after 5 minutes`);
                  }
                }, 5 * 60 * 1000);
                pendingApprovals.set(approvalId, { resolve, timeout });
              });
            };

            const requestToolApprovalBatch = async (batch: PendingToolApproval[]): Promise<void> => {
              if (batch.length === 0) {
                return;
              }

              syncChatRunState(session, sessionId, activeRun, {
                runId,
                status: activeRun.cancelRequested ? "canceling" : "running",
                phase: "approval",
                messageId: currentMessageId,
                reason: activeRun.cancelRequested ? "user_requested" : null,
              });
              ctx.state.setApprovalRequests([
                ...ctx.state.getApprovalRequests(),
                ...batch.map((item) => item.approvalRequest),
              ]);
              await syncSiliconPersonSummaryForSession(ctx, session);

              for (const item of batch) {
                broadcastToRenderers("session:stream", {
                  type: EventType.ApprovalRequested,
                  sessionId,
                  approvalRequest: item.approvalRequest,
                });
              }

              activeRun.pendingApprovalIds.push(...batch.map((item) => item.approvalId));
              const decisions = await Promise.all(batch.map(async (item) => ({
                item,
                decision: await awaitApprovalDecision(item.approvalId),
              })));

              const pendingIds = new Set(batch.map((item) => item.approvalId));
              for (const { item } of decisions) {
                const pending = pendingApprovals.get(item.approvalId);
                if (pending) clearTimeout(pending.timeout);
                pendingApprovals.delete(item.approvalId);
              }
              activeRun.pendingApprovalIds = activeRun.pendingApprovalIds.filter((id) => !pendingIds.has(id));
              ctx.state.setApprovalRequests(
                ctx.state.getApprovalRequests().filter((request) => !pendingIds.has(request.id)),
              );
              await syncSiliconPersonSummaryForSession(ctx, session);

              for (const { item, decision } of decisions) {
                if (decision === "canceled") {
                  const abortError = new Error("User requested cancellation");
                  abortError.name = "AbortError";
                  throw abortError;
                }
                approvedTools.push({ toolCall: item.toolCall, denied: decision === "deny" });
              }
            };

            for (const toolCall of result.toolCalls) {
              // 跳过被 Phase Gate 拒绝的工具调用（已在上方推送拒绝结果）
              if (phaseRejectedToolCallIds.has(toolCall.id)) continue;

              const toolId = functionNameToToolId(toolCall.name);
              const label = buildToolLabel(toolCall.name, toolCall.input);
              const risk = getToolRisk(toolId, toolCall.name);
              const source = getApprovalSource(toolId);

              const policy = resolveApprovalPolicyForSession(ctx, session);
              const isOutsideWorkspace = toolId.startsWith("fs.") && toolExecutor.isOutsideWorkspace(workingDir, label.split("\n")[0].trim());
              const needsApproval = shouldRequestApproval({ policy, source, toolId, risk, isOutsideWorkspace });

              if (needsApproval) {
                const approvalId = randomUUID();
                const approvalRequest: ApprovalRequest = {
                  id: approvalId,
                  sessionId,
                  source,
                  toolId,
                  label,
                  risk,
                  detail: JSON.stringify(toolCall.input).slice(0, 500),
                  ...(source === "mcp-tool" ? {
                    serverId: mcpTools.find((t) => t.id.replace(/[^a-zA-Z0-9_-]/g, "_") === toolCall.name)?.serverId,
                    toolName: toolCall.name,
                    arguments: toolCall.input,
                  } : {}),
                };
                if (isReadOnlyTool(toolId)) {
                  queuedReadOnlyApprovals.push({ toolCall, approvalId, approvalRequest });
                  continue;
                }

                syncChatRunState(session, sessionId, activeRun, {
                  runId,
                  status: activeRun.cancelRequested ? "canceling" : "running",
                  phase: "approval",
                  messageId: currentMessageId,
                  reason: activeRun.cancelRequested ? "user_requested" : null,
                });
                const existingRequests = ctx.state.getApprovalRequests();
                ctx.state.setApprovalRequests([...existingRequests, approvalRequest]);
                await syncSiliconPersonSummaryForSession(ctx, session);

                broadcastToRenderers("session:stream", {
                  type: EventType.ApprovalRequested,
                  sessionId,
                  approvalRequest,
                });

                activeRun.pendingApprovalIds.push(approvalId);
                const decision = await new Promise<"approve" | "deny" | "canceled">((resolve) => {
                  // 自动清理：如果渲染层 5 分钟内未响应，则自动拒绝
                  const timeout = setTimeout(() => {
                    if (pendingApprovals.has(approvalId)) {
                      pendingApprovals.get(approvalId)?.resolve("deny");
                      pendingApprovals.delete(approvalId);
                      console.warn(`[approval] Timed out approval ${approvalId} after 5 minutes`);
                    }
                  }, 5 * 60 * 1000);
                  pendingApprovals.set(approvalId, { resolve, timeout });
                });

                const pending = pendingApprovals.get(approvalId);
                if (pending) clearTimeout(pending.timeout);
                pendingApprovals.delete(approvalId);
                activeRun.pendingApprovalIds = activeRun.pendingApprovalIds.filter((id) => id !== approvalId);
                ctx.state.setApprovalRequests(
                  ctx.state.getApprovalRequests().filter((r) => r.id !== approvalId),
                );
                await syncSiliconPersonSummaryForSession(ctx, session);

                if (decision === "canceled") {
                  const abortError = new Error("User requested cancellation");
                  abortError.name = "AbortError";
                  throw abortError;
                }
                if (decision === "deny") {
                  approvedTools.push({ toolCall, denied: true });
                  continue;
                }
              }

              await requestToolApprovalBatch(queuedReadOnlyApprovals.splice(0, queuedReadOnlyApprovals.length));
              approvedTools.push({ toolCall, denied: false });
            }

            // 循环结束后，如果仍有未刷新的只读审批（全部工具都是只读时会出现），统一刷新
            await requestToolApprovalBatch(queuedReadOnlyApprovals.splice(0, queuedReadOnlyApprovals.length));

            // ---- 第 2 步：执行单个工具调用（复用共享 helper） ----
            if (activeRun.cancelRequested) {
              const abortError = new Error("User requested cancellation");
              abortError.name = "AbortError";
              throw abortError;
            }
            syncChatRunState(session, sessionId, activeRun, {
              runId,
              status: activeRun.cancelRequested ? "canceling" : "running",
              phase: "tools",
              messageId: currentMessageId,
              reason: activeRun.cancelRequested ? "user_requested" : null,
            });
            const executeSingleTool = async (
              toolCall: ResolvedToolCall,
            ): Promise<{ content: ChatMessageContent; succeeded: boolean; failureReason?: string }> => {
              const toolCallId = toolCall.id;
              const toolId = functionNameToToolId(toolCall.name);
              const label = buildToolLabel(toolCall.name, toolCall.input);

              broadcastToRenderers("session:stream", {
                type: EventType.ToolStarted,
                sessionId,
                toolCallId,
                toolId,
                toolName: toolCall.name,
                arguments: toolCall.input,
              });

              let toolOutput: string;
              let imageBase64: string | undefined;
              let toolSucceeded = true;
              let failureReason: string | undefined;
              try {
                if (toolId.startsWith("task.")) {
                  // Task V2 工具直接操作 session 状态，不走 toolExecutor
                  const taskResult = executeTaskTool(session, toolId, toolCall.input);
                  toolOutput = taskResult.output;
                  toolSucceeded = taskResult.success;
                  if (!taskResult.success) failureReason = taskResult.error;
                  if (taskResult.mutated) {
                    await saveSession(ctx.runtime.paths, session);
                    broadcastToRenderers("session:stream", {
                      type: EventType.TasksUpdated,
                      sessionId,
                      tasks: session.tasks ?? [],
                    });
                  }
                } else if (toolCall.name.startsWith("mcp__")) {
                  const mcpTool = mcpTools.find((t) => {
                    const safeName = t.id.replace(/[^a-zA-Z0-9_-]/g, "_");
                    return safeName === toolCall.name;
                  });
                  if (!mcpTool || !activeMcpManager) {
                    throw new Error(`MCP tool not found: ${toolCall.name}`);
                  }
                  toolOutput = await activeMcpManager.callTool(
                    mcpTool.serverId,
                    mcpTool.name,
                    toolCall.input,
                  );
                } else {
                  const execResult = await toolExecutor.execute(toolId, label, workingDir, {
                    signal: abortController.signal,
                  });
                  toolSucceeded = execResult.success;
                  toolOutput = execResult.success
                    ? execResult.output
                    : `[错误] ${execResult.error ?? "工具执行失败"}\n${execResult.output}`.trim();
                  if (!execResult.success) {
                    failureReason = execResult.error ?? "工具执行失败";
                  }

                  // 捕获截图，供多模态响应使用
                  if (execResult.imageBase64) {
                    imageBase64 = execResult.imageBase64;
                  }

                  // 如果技能带有视图文件，则通知渲染层打开 WebPanel
                  if (execResult.viewMeta) {
                    broadcastToRenderers("web-panel:open", execResult.viewMeta);
                  }
                }

                if (toolSucceeded) {
                  broadcastToRenderers("session:stream", {
                    type: EventType.ToolCompleted,
                    sessionId,
                    toolCallId,
                    toolId,
                    output: toolOutput.slice(0, 500),
                    success: true,
                  });
                } else {
                  broadcastToRenderers("session:stream", {
                    type: EventType.ToolFailed,
                    sessionId,
                    toolCallId,
                    toolId,
                    error: toolOutput,
                  });
                }
              } catch (err) {
                toolSucceeded = false;
                failureReason = err instanceof Error ? err.message : String(err);
                toolOutput = `[工具执行异常] ${err instanceof Error ? err.message : String(err)}`;
                broadcastToRenderers("session:stream", {
                  type: EventType.ToolFailed,
                  sessionId,
                  toolCallId,
                  toolId,
                  error: toolOutput,
                });
              }

              // 限制工具输出长度，避免会话体积膨胀（上下文窗口由 compactor 另行处理）
              const MAX_TOOL_OUTPUT_PERSIST = 8000; // ~2k tokens
              const cappedOutput = toolOutput.length > MAX_TOOL_OUTPUT_PERSIST
                ? toolOutput.slice(0, MAX_TOOL_OUTPUT_PERSIST) + `\n\n[... truncated ${toolOutput.length - MAX_TOOL_OUTPUT_PERSIST} chars for session storage]`
                : toolOutput;

              // 对截图返回多模态内容（供支持视觉的模型使用）
              if (imageBase64) {
                return {
                  content: [
                    { type: "text", text: cappedOutput },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "low" } },
                  ],
                  succeeded: toolSucceeded,
                  ...(failureReason ? { failureReason } : {}),
                };
              }

              return {
                content: cappedOutput,
                succeeded: toolSucceeded,
                ...(failureReason ? { failureReason } : {}),
              };
            };

            // ---- 第 3 步：处理被拒绝的工具 ----
            let successfulToolExecutions = 0;
            for (const { toolCall } of approvedTools.filter((t) => t.denied)) {
              const toolCallId = toolCall.id;
              const toolId = functionNameToToolId(toolCall.name);
              const deniedOutput = `[用户拒绝] 工具 ${toolCall.name} 被用户拒绝执行。`;
              markPlanTaskToolProgress(session, activePlanTaskId, {
                toolName: toolCall.name,
                succeeded: false,
                failureReason: deniedOutput,
                now: new Date().toISOString(),
              });
              session.messages.push({
                id: randomUUID(),
                role: "tool",
                content: deniedOutput,
                tool_call_id: toolCallId,
                createdAt: new Date().toISOString(),
              });
              broadcastToRenderers("session:stream", {
                type: EventType.ToolFailed,
                sessionId,
                toolCallId,
                toolId,
                error: deniedOutput,
              });
              // 广播会话更新，让被拒绝的工具结果也能实时显示
              broadcastToRenderers("session:stream", {
                type: EventType.SessionUpdated,
                sessionId,
                session,
              });
            }

            // ---- 第 4 步：把已批准工具拆分成只读组与写入组 ----
            const approved = approvedTools.filter((t) => !t.denied);
            const readOnlyTasks = approved.filter((t) => isReadOnlyTool(functionNameToToolId(t.toolCall.name)));
            const writeTasks = approved.filter((t) => !isReadOnlyTool(functionNameToToolId(t.toolCall.name)));

            // 并发执行只读工具（按 PARALLEL_LIMIT 分批）
            // 先收集结果，再按确定顺序串行写入消息
            for (let i = 0; i < readOnlyTasks.length; i += PARALLEL_LIMIT) {
              const batch = readOnlyTasks.slice(i, i + PARALLEL_LIMIT);
              const results = await Promise.all(
                batch.map(async ({ toolCall }) => {
                  const result = await executeSingleTool(toolCall);
                  return { toolCall, result };
                }),
              );
              // 以固定顺序串行写入消息
              for (const { toolCall, result } of results) {
                if (result.succeeded) {
                  successfulToolExecutions++;
                }
                markPlanTaskToolProgress(session, activePlanTaskId, {
                  toolName: toolCall.name,
                  succeeded: result.succeeded,
                  failureReason: result.failureReason,
                  now: new Date().toISOString(),
                });
                session.messages.push({
                  id: randomUUID(),
                  role: "tool" as const,
                  content: result.content,
                  tool_call_id: toolCall.id,
                  createdAt: new Date().toISOString(),
                });
                broadcastToRenderers("session:stream", {
                  type: EventType.SessionUpdated,
                  sessionId,
                  session,
                });
              }
            }

            // 写入类工具串行执行
            for (const { toolCall } of writeTasks) {
              const result = await executeSingleTool(toolCall);
              if (result.succeeded) {
                successfulToolExecutions++;
              }
              markPlanTaskToolProgress(session, activePlanTaskId, {
                toolName: toolCall.name,
                succeeded: result.succeeded,
                failureReason: result.failureReason,
                now: new Date().toISOString(),
              });
              session.messages.push({
                id: randomUUID(),
                role: "tool" as const,
                content: result.content,
                tool_call_id: toolCall.id,
                createdAt: new Date().toISOString(),
              });
              broadcastToRenderers("session:stream", {
                type: EventType.SessionUpdated,
                sessionId,
                session,
              });
            }

            await persistSessionTurnOutcomeMetrics(ctx, result.outcome, {
              toolCallCount: result.toolCalls.length,
              toolSuccessCount: successfulToolExecutions,
              contextStability: !assembled.wasCompacted,
            });

            // ---- 循环检测 ----
            const roundSig = buildRoundSignature(result.toolCalls);
            roundSignatures.push(roundSig);
            const repeats = countConsecutiveRepeats(roundSignatures);

            if (repeats >= LOOP_STOP_THRESHOLD) {
              console.warn(`[session:loop-detect] Forced stop after ${repeats} identical rounds`);
              session.messages.push({
                id: randomUUID(),
                role: "assistant",
                content: `[检测到工具调用循环（连续 ${repeats} 轮相同调用），已自动停止。请尝试换一种方式完成任务。]`,
                createdAt: new Date().toISOString(),
              });
              markPlanTaskBlocked(
                session,
                activePlanTaskId,
                `Detected tool loop after ${repeats} identical rounds`,
                new Date().toISOString(),
              );
              broadcastToRenderers("session:stream", {
                type: EventType.SessionUpdated,
                sessionId,
                session,
              });
              break;
            }

            if (repeats >= LOOP_WARN_THRESHOLD && !loopWarningInjected) {
              session.messages.push({
                id: randomUUID(),
                role: "system",
                content: "[注意] 检测到你连续多次调用相同的工具组合。如果陷入了循环，请尝试不同的方法来完成任务。",
                createdAt: new Date().toISOString(),
              });
              loopWarningInjected = true;
              console.info(`[session:loop-detect] Warning injected at round ${round} (${repeats} repeats)`);
            }

            // 为下一轮做准备
            currentMessageId = randomUUID();

            // 广播即将开始新一轮模型调用
            broadcastToRenderers("session:stream", {
              type: EventType.RunStarted,
              sessionId,
              messageId: currentMessageId,
              round,
            });
          } else {
            // 没有工具调用——检查是否是异常截断而非真正的最终回复
            const isStreamIncomplete = result.streamCompleted === false;
            const hasNoContent = !result.content?.trim() && !result.reasoning?.trim();
            const isAbnormalFinish = !result.finishReason || result.finishReason === "length";

            if (isStreamIncomplete && hasNoContent) {
              // 流异常截断且没有任何有效内容——记录错误并作为失败处理
              console.error("[session:stream-integrity] 模型响应流异常截断，无有效内容", {
                sessionId,
                round,
                finishReason: result.finishReason,
                streamCompleted: result.streamCompleted,
                contentLength: result.content?.length ?? 0,
              });
              session.messages.push({
                id: currentMessageId,
                role: "assistant",
                content: "[模型响应中断] 与模型的连接意外断开，未收到有效回复。请重新发送消息重试。",
                createdAt: new Date().toISOString(),
              });
              terminalStatus = "failed";
              terminalReason = "stream_interrupted";
              break;
            }

            if (isAbnormalFinish && hasNoContent && round > 1) {
              // finishReason 异常（null 或 length）且无内容——可能是上下文超限
              console.warn("[session:stream-integrity] 模型返回空内容，可能上下文超限", {
                sessionId,
                round,
                finishReason: result.finishReason,
                streamCompleted: result.streamCompleted,
              });
              session.messages.push({
                id: currentMessageId,
                role: "assistant",
                content: result.finishReason === "length"
                  ? "[上下文超限] 对话上下文已超出模型处理能力，请开启新对话继续。"
                  : "[模型响应异常] 模型返回了空内容，可能是网络波动或上下文过长。请重试或开启新对话。",
                createdAt: new Date().toISOString(),
              });
              terminalStatus = "failed";
              terminalReason = result.finishReason === "length" ? "context_length_exceeded" : "empty_response";
              break;
            }

            // 正常最终回复
            const isBackgroundHandoff = result.finishReason === "background" && !!result.backgroundTask;
            if (isBackgroundHandoff) {
              syncSessionBackgroundTaskSnapshot(ctx.runtime.paths, session, result.outcome);
              console.info("[session:runtime] 已切换到后台任务执行", {
                sessionId,
                outcomeId: result.outcome.id,
                responseId: result.backgroundTask?.providerResponseId ?? null,
                status: result.backgroundTask?.status ?? null,
              });
            } else {
              session.messages.push({
                id: currentMessageId,
                role: "assistant",
                content: result.content,
                ...(result.reasoning ? { reasoning: result.reasoning } : {}),
                ...(result.usage ? { usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens } } : {}),
                createdAt: new Date().toISOString(),
              });
            }

            // 根据首次对话自动生成会话标题
            if (session.title === "New Chat" && session.messages.length >= 2) {
              const userMsg = session.messages.find((m: SessionChatMessage) => m.role === "user");
              if (userMsg) {
                const raw = (typeof userMsg.content === "string" ? userMsg.content : "").trim().split("\n")[0] ?? "";
                session.title = raw.length > 50 ? raw.slice(0, 47) + "..." : raw || "New Chat";
              }
            }

            if (!isPlanTaskBlocked(session, activePlanTaskId)) {
              markPlanTaskCompleted(session, activePlanTaskId, new Date().toISOString());
              if (session.planModeState?.mode === "executing") {
                session.planModeState = {
                  ...session.planModeState,
                  mode: hasRemainingExecutablePlanTasks(session) ? "executing" : "completed",
                  approvalStatus: "approved",
                };
                if (session.planModeState.mode === "executing") {
                  const nextTaskId = selectPlanModeTaskForRound(
                    session,
                    input.content,
                    randomUUID(),
                    new Date().toISOString(),
                  );
                  if (nextTaskId) {
                    activePlanTaskId = nextTaskId;
                    session.messages.push({
                      id: randomUUID(),
                      role: "system",
                      content: "[计划模式] 当前步骤已完成，请继续执行下一步。",
                      createdAt: new Date().toISOString(),
                    });
                    currentMessageId = randomUUID();
                    broadcastToRenderers("session:stream", {
                      type: EventType.RunStarted,
                      sessionId,
                      messageId: currentMessageId,
                      round,
                    });
                    continue;
                  }
                }
              }
              terminalStatus = "completed";
              terminalReason = null;
              completedNormally = true;
            }

            // ---- Task V2 续行：模型停止但仍有未完成任务时自动推进 ----
            // 仅在 Plan Mode 未接管执行时生效，避免与 Plan Mode 的续行逻辑冲突
            const unfinishedV2Tasks = (session.tasks ?? []).filter(
              (t) => t.status !== "completed",
            );
            const isPlanModeManagingExecution = session.planModeState?.mode === "executing";
            if (
              unfinishedV2Tasks.length > 0 &&
              !isPlanModeManagingExecution &&
              taskContinuationCount < MAX_TASK_CONTINUATIONS &&
              !isBackgroundHandoff
            ) {
              taskContinuationCount++;
              completedNormally = false;
              const pendingCount = unfinishedV2Tasks.filter((t) => t.status === "pending").length;
              const inProgressCount = unfinishedV2Tasks.filter((t) => t.status === "in_progress").length;
              console.info("[session:task-continuation] 模型停止但仍有未完成任务，注入续行提示", {
                sessionId,
                round,
                taskContinuationCount,
                maxContinuations: MAX_TASK_CONTINUATIONS,
                pendingCount,
                inProgressCount,
              });
              session.messages.push({
                id: randomUUID(),
                role: "system",
                content: `[任务未完成] 你还有 ${unfinishedV2Tasks.length} 个任务未完成（${pendingCount} 个待执行，${inProgressCount} 个执行中）。请继续按计划推进任务，完成所有任务后再停止。`,
                createdAt: new Date().toISOString(),
              });
              currentMessageId = randomUUID();
              broadcastToRenderers("session:stream", {
                type: EventType.RunStarted,
                sessionId,
                messageId: currentMessageId,
                round,
              });
              continue;
            }

            break;
          }
        }
      } catch (err) {
        const now = new Date().toISOString();
        if (isAbortError(err)) {
          terminalStatus = "canceled";
          terminalReason = activeRun.cancelRequested ? "user_requested" : "aborted";
          persistPartialAssistantDraft(session, currentMessageId, streamedDrafts, now);
          // 修复：为所有孤立的 tool_calls 补充占位 tool result，
          // 避免下次发消息时 API 报 "No tool output found for function call" 400 错误。
          patchOrphanedToolCalls(session, now);
          if (session.planModeState) {
            session.planModeState = {
              ...session.planModeState,
              mode: "canceled",
              blockedReason: undefined,
            };
            syncPlanModeState(session, now);
          }
        } else {
          const errorText = err instanceof Error ? err.message : String(err);
        const errorContent = `[模型调用失败] ${errorText}`;

        // 保存已流式传输的部分内容，避免用户已看到的文本在重启后丢失
        persistPartialAssistantDraft(session, currentMessageId, streamedDrafts, now);

        // 检查部分内容是否已落盘：如果有，则将错误信息追加到已有内容后面；
        // 否则作为独立 assistant 消息写入。
        const existingDraft = session.messages.find((m) => m.id === currentMessageId);
        if (existingDraft && existingDraft.role === "assistant") {
          existingDraft.content = typeof existingDraft.content === "string"
            ? `${existingDraft.content}\n\n${errorContent}`
            : errorContent;
        } else {
          session.messages.push({
            id: currentMessageId,
            role: "assistant",
            content: errorContent,
            createdAt: now,
          });
        }

        broadcastToRenderers("session:stream", {
          type: EventType.MessageDelta,
          sessionId,
          messageId: currentMessageId,
          delta: { content: errorContent },
        });
        markPlanTaskBlocked(session, activePlanTaskId, errorText, now);
        if (session.planModeState?.mode === "executing") {
          session.planModeState = {
            ...session.planModeState,
            mode: "blocked",
            blockedReason: errorText,
          };
        }
        terminalStatus = "failed";
        terminalReason = errorText;
      }

      }

      releasePendingApprovalsForRun(ctx, activeRun);
      syncChatRunState(session, sessionId, null, {
        runId,
        status: terminalStatus,
        phase: activeRun.phase,
        messageId: currentMessageId,
        reason: terminalReason,
      });
      await syncSiliconPersonSummaryForSession(ctx, session);
      getActiveSessionRuns(ctx).delete(sessionId);

      broadcastToRenderers("session:stream", {
        type: EventType.MessageCompleted,
        sessionId,
        messageId: currentMessageId,
      });

      await saveSessionWithPlanWorkflowSync(ctx, session);
      broadcastToRenderers("session:stream", {
        type: EventType.SessionUpdated,
        sessionId,
        session,
      });

      // 将更新后的消息持久化到磁盘
      return { session };
  };

  registeredSessionSendMessageBridge = (sessionId, input) =>
    handleSessionSendMessage(undefined, sessionId, input);

  ipcMain.handle("session:send-message", handleSessionSendMessage);

  ipcMain.handle(
    "session:poll-background-task",
    async (_event, sessionId: string): Promise<{
      outcomeId: string;
      task: TurnOutcome["backgroundTask"];
      status: string;
      outputText: string;
      session: ChatSession;
    }> => {
      const { session, profile, outcome } = resolveSessionBackgroundTaskContext(ctx, sessionId);
      const snapshot = await backgroundTaskManager.retrieve({
        profile,
        task: outcome.backgroundTask!,
      });

      const updatedOutcome = await persistSessionBackgroundTaskSnapshot(ctx, session, outcome, snapshot);
      await saveSessionWithPlanWorkflowSync(ctx, session);
      broadcastToRenderers("session:stream", {
        type: EventType.SessionUpdated,
        sessionId,
        session,
      });
      console.info("[session:runtime] 已刷新后台任务状态", {
        sessionId,
        outcomeId: updatedOutcome.id,
        responseId: snapshot.task?.providerResponseId ?? outcome.backgroundTask?.providerResponseId ?? null,
        status: snapshot.status,
        terminal: isTerminalBackgroundTaskStatus(snapshot.status),
      });

      return {
        outcomeId: outcome.id,
        task: updatedOutcome.backgroundTask,
        status: snapshot.status,
        outputText: snapshot.outputText,
        session,
      };
    },
  );

  ipcMain.handle(
    "session:cancel-background-task",
    async (_event, sessionId: string): Promise<{
      outcomeId: string;
      task: TurnOutcome["backgroundTask"];
      status: string;
      outputText: string;
      session: ChatSession;
    }> => {
      const { session, profile, outcome } = resolveSessionBackgroundTaskContext(ctx, sessionId);
      const snapshot = await backgroundTaskManager.cancel({
        profile,
        task: outcome.backgroundTask!,
      });

      const updatedOutcome = await persistSessionBackgroundTaskSnapshot(ctx, session, outcome, snapshot);
      await saveSessionWithPlanWorkflowSync(ctx, session);
      broadcastToRenderers("session:stream", {
        type: EventType.SessionUpdated,
        sessionId,
        session,
      });
      console.info("[session:runtime] 已取消后台任务", {
        sessionId,
        outcomeId: outcome.id,
        responseId: snapshot.task?.providerResponseId ?? outcome.backgroundTask?.providerResponseId ?? null,
        status: snapshot.status,
      });

      return {
        outcomeId: updatedOutcome.id,
        task: updatedOutcome.backgroundTask,
        status: snapshot.status,
        outputText: snapshot.outputText,
        session,
      };
    },
  );

  // 获取某个会话当前待处理的 execution intents
  ipcMain.handle(
    "session:cancel-run",
    async (
      _event,
      sessionId: string,
      input?: { runId?: string; messageId?: string; reason?: string },
    ): Promise<{ success: boolean; state: "idle" | "stale" | "canceling" }> => {
      const session = ctx.state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const activeRun = getActiveSessionRuns(ctx).get(sessionId);
      if (!activeRun) {
        // 无活跃进程但 session 仍显示运行态（异常退出后的残留），强制重置
        if (session.chatRunState
          && (session.chatRunState.status === "running" || session.chatRunState.status === "canceling")) {
          session.chatRunState = {
            ...session.chatRunState,
            status: "failed",
            lastReason: "stale_run_cleanup",
          };
          await saveSession(ctx.runtime.paths, session);
          broadcastToRenderers("session:stream", {
            type: EventType.SessionUpdated,
            sessionId,
            session,
          });
        }
        return { success: false, state: "idle" };
      }
      if (input?.runId && input.runId !== activeRun.runId) {
        return { success: false, state: "stale" };
      }

      activeRun.cancelRequested = true;
      activeRun.status = "canceling";
      const reason = input?.reason ?? "user_requested";
      syncChatRunState(session, sessionId, activeRun, {
        runId: activeRun.runId,
        status: "canceling",
        phase: activeRun.phase,
        messageId: input?.messageId ?? activeRun.currentMessageId,
        reason,
      });
      releasePendingApprovalsForRun(ctx, activeRun);
      if (!activeRun.abortController.signal.aborted) {
        activeRun.abortController.abort();
      }
      await saveSession(ctx.runtime.paths, session);
      await syncSiliconPersonSummaryForSession(ctx, session);
      broadcastToRenderers("session:stream", {
        type: EventType.SessionUpdated,
        sessionId,
        session,
      });
      return { success: true, state: "canceling" };
    },
  );

  ipcMain.handle(
    "session:get-execution-intents",
    async (_event, sessionId: string): Promise<ExecutionIntent[]> => {
      const _session = ctx.state.sessions.find((s) => s.id === sessionId);
      if (!_session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const requests = ctx.state.getApprovalRequests().filter((r) => r.sessionId === sessionId);
      return requests.map((r) => ({
        source: r.source,
        toolId: r.toolId,
        label: r.label,
        risk: r.risk,
        detail: r.detail,
        serverId: r.serverId,
        toolName: r.toolName,
        arguments: r.arguments,
      }));
    },
  );

  // 按完整 ApprovalDecision 语义处理待审批请求
  ipcMain.handle(
    "session:resolve-approval",
    async (_event, approvalId: string, decision: ApprovalDecision): Promise<{ success: boolean }> => {
      const pending = pendingApprovals.get(approvalId);
      if (!pending) {
        return { success: false };
      }

      // "always-allow-tool" / "allow-session": 将 toolId 加入 alwaysAllowedTools 以跳过后续审批
      if (decision === "always-allow-tool" || decision === "allow-session") {
        const request = ctx.state.getApprovalRequests().find((r) => r.id === approvalId);
        if (request) {
          const policy = ctx.state.getApprovals();
          if (!policy.alwaysAllowedTools.includes(request.toolId)) {
            policy.alwaysAllowedTools.push(request.toolId);
            console.info(`[approval] Added ${request.toolId} to alwaysAllowedTools (${decision})`);
          }
        }
      }

      // 用户已响应，清理自动拒绝超时定时器
      clearTimeout(pending.timeout);

      // 映射为 agentic loop 使用的 approve/deny
      pending.resolve(decision === "deny" ? "deny" : "approve");
      return { success: true };
    },
  );

  // 更新审批策略
  ipcMain.handle(
    "session:approve-plan",
    async (_event, sessionId: string): Promise<{ session: ChatSession }> => {
      const index = ctx.state.sessions.findIndex((s) => s.id === sessionId);
      if (index < 0) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const session = ctx.state.sessions[index]!;
      const now = new Date().toISOString();
      session.planModeState = {
        ...(session.planModeState ?? {
          mode: "executing",
          approvalStatus: "approved",
          planVersion: 1,
        }),
        mode: "executing",
        workflowMode: "plan",
        approvalStatus: "approved",
        approvedAt: now,
      };
      syncPlanModeState(session, now);
      await saveSessionWithPlanWorkflowSync(ctx, session);
      return { session };
    },
  );

  ipcMain.handle(
    "session:revise-plan",
    async (_event, sessionId: string): Promise<{ session: ChatSession }> => {
      const index = ctx.state.sessions.findIndex((s) => s.id === sessionId);
      if (index < 0) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const session = ctx.state.sessions[index]!;
      if (session.planModeState) {
        session.planModeState = {
          ...session.planModeState,
          mode: "planning",
          approvalStatus: "rejected",
          approvedAt: undefined,
        };
        syncPlanModeState(session, new Date().toISOString());
      }
      await saveSessionWithPlanWorkflowSync(ctx, session);
      return { session };
    },
  );

  ipcMain.handle(
    "session:cancel-plan-mode",
    async (_event, sessionId: string): Promise<{ session: ChatSession }> => {
      const index = ctx.state.sessions.findIndex((s) => s.id === sessionId);
      if (index < 0) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const session = ctx.state.sessions[index]!;
      const workflowRun = session.planModeState?.workflowRun
        ? {
            ...session.planModeState.workflowRun,
            status: "canceled" as const,
            updatedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          }
        : null;
      const previousWorkflowRunIndex = workflowRun
        ? ctx.state.workflowRuns.findIndex((item) => item.id === workflowRun.id)
        : -1;
      const previousWorkflowRun = previousWorkflowRunIndex >= 0
        ? ctx.state.workflowRuns[previousWorkflowRunIndex]!
        : null;
      if (workflowRun) {
        const workflowRunIndex = ctx.state.workflowRuns.findIndex((item) => item.id === workflowRun.id);
        if (workflowRunIndex >= 0) {
          ctx.state.workflowRuns[workflowRunIndex] = workflowRun;
        } else {
          ctx.state.workflowRuns.push(workflowRun);
        }
        await saveWorkflowRun(ctx.runtime.paths, workflowRun);
      }
      session.planModeState = null;
      session.planState = null;
      session.runtimeIntent = {
        ...(session.runtimeIntent ?? {}),
        workflowMode: "default",
        planModeEnabled: false,
      };
      try {
        await saveSession(ctx.runtime.paths, session);
      } catch (error) {
        if (workflowRun) {
          try {
            if (previousWorkflowRun) {
              await saveWorkflowRun(ctx.runtime.paths, previousWorkflowRun);
            } else {
              await deleteWorkflowRunFile(ctx.runtime.paths, workflowRun.id);
            }
          } finally {
            if (previousWorkflowRunIndex >= 0 && previousWorkflowRun) {
              ctx.state.workflowRuns[previousWorkflowRunIndex] = previousWorkflowRun;
            } else {
              ctx.state.workflowRuns = ctx.state.workflowRuns.filter((item) => item.id !== workflowRun.id);
            }
          }
        }
        console.warn("[plan-mode] 取消计划模式时保存会话失败，已回滚 workflow run 持久化。");
        throw error;
      }
      return { session };
    },
  );

  ipcMain.handle(
    "session:update-approval-policy",
    async (_event, policy: { mode?: ApprovalMode; autoApproveReadOnly?: boolean; autoApproveSkills?: boolean }): Promise<{ success: boolean }> => {
      const current = ctx.state.getApprovals();
      if (policy.mode !== undefined) {
        current.mode = policy.mode;
      }
      if (policy.autoApproveReadOnly !== undefined) {
        current.autoApproveReadOnly = policy.autoApproveReadOnly;
      }
      if (policy.autoApproveSkills !== undefined) {
        current.autoApproveSkills = policy.autoApproveSkills;
      }
      return { success: true };
    },
  );

  // 更新会话的 runtimeIntent（用于切换 reasoningEffort 等参数）
  ipcMain.handle(
    "session:update-runtime-intent",
    async (_event, sessionId: string, intent: Partial<SessionRuntimeIntent>): Promise<{ session: ChatSession }> => {
      const index = ctx.state.sessions.findIndex((s) => s.id === sessionId);
      if (index < 0) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const session = ctx.state.sessions[index]!;
      const activeRun = getActiveSessionRuns(ctx).get(sessionId);
      const merged = {
        ...(session.runtimeIntent ?? {}),
        ...intent,
      } as SessionRuntimeIntent & {
        workflowMode?: string;
        planModeEnabled?: boolean;
      };
      const disablePlanMode = merged.workflowMode === "default" && merged.planModeEnabled === false;
      session.runtimeIntent = merged;

      if (activeRun) {
        console.info("[session:update-runtime-intent] 运行中更新 runtimeIntent，新配置将在下次发送生效", {
          sessionId,
          runId: activeRun.runId,
          intent,
        });
      }

      if (disablePlanMode && !activeRun) {
        session.planModeState = null;
        session.planState = null;
      }

      await saveSession(ctx.runtime.paths, session);
      return { session };
    },
  );
}
