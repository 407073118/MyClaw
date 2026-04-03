import { ipcMain, webContents } from "electron";
import { randomUUID } from "node:crypto";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

import type { ChatSession, ChatMessage as SessionChatMessage, ExecutionIntent, SkillDefinition, ApprovalRequest, ModelProfile, ApprovalDecision, ApprovalMode } from "@shared/contracts";
import { EventType, ToolRiskCategory, shouldRequestApproval, allowsExternalPaths } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { callModel } from "../services/model-client";
import type { ChatMessage as ModelChatMessage, ChatMessageContent, ResolvedToolCall } from "../services/model-client";
import { saveSession, deleteSessionFiles } from "../services/state-persistence";
import { buildToolSchemas, functionNameToToolId, buildToolLabel } from "../services/tool-schemas";
import { BuiltinToolExecutor } from "../services/builtin-tool-executor";
import { resolveModelCapability } from "../services/model-capability-resolver";
import { assembleContext } from "../services/context-assembler";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Absolute safety ceiling — prevents truly infinite loops from bugs.
 * NOT a task-completion limit. The model stops by not making tool calls.
 */
const SAFETY_CEILING = 200;

/** Consecutive identical round signatures before warning the model. */
const LOOP_WARN_THRESHOLD = 3;

/** Consecutive identical round signatures before forcing a stop. */
const LOOP_STOP_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Async git branch detection (replaces blocking execSync)
// ---------------------------------------------------------------------------

const execAsync = promisify(execCb);

/**
 * Asynchronously resolve the current git branch.
 * Returns null if not a git repo or git is unavailable.
 * Non-blocking — safe to call from Electron main process.
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

/** Maximum number of read-only tools to execute concurrently. */
const PARALLEL_LIMIT = 5;

/** Tools that only read state and can safely run in parallel. */
const READ_ONLY_TOOLS = new Set([
  "fs.read", "fs.list", "fs.search", "fs.find",
  "git.status", "git.diff", "git.log", "task.manage",
]);

/**
 * Determine whether a tool is read-only (safe for concurrent execution).
 * Skills are considered read-only by default since they run in a sandbox.
 */
export function isReadOnlyTool(toolId: string): boolean {
  if (READ_ONLY_TOOLS.has(toolId)) return true;
  if (toolId.startsWith("skill_invoke__")) return true;
  if (toolId === "skill.view") return true;
  return false;
}

/**
 * Build a signature for the current round's tool calls.
 * Used to detect loops (model calling the same tools with the same args).
 */
function buildRoundSignature(toolCalls: { name: string; argumentsJson: string }[]): string {
  return toolCalls
    .map((tc) => `${tc.name}:${tc.argumentsJson.slice(0, 200)}`)
    .sort()
    .join("|");
}

/** Count how many times the last element repeats consecutively from the end. */
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

/** Shared tool executor instance (holds in-memory task list state). */
const toolExecutor = new BuiltinToolExecutor();

/** Shutdown browser on app exit — call from index.ts before-quit. */
export async function shutdownToolExecutor(): Promise<void> {
  await toolExecutor.shutdown();
}

// ---------------------------------------------------------------------------
// Approval system
// ---------------------------------------------------------------------------

/** Map of approval request ID → { resolve, timeout } for pending approvals. */
const pendingApprovals = new Map<string, {
  resolve: (decision: "approve" | "deny") => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/** Risk mapping for builtin tools. */
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
  "task.manage": ToolRiskCategory.Read,
  // browser.*
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
};

function getToolRisk(toolId: string, toolName: string): ToolRiskCategory {
  // Check builtin tool risk map
  if (TOOL_RISK_MAP[toolId]) return TOOL_RISK_MAP[toolId];
  // Skills default to Read
  if (toolId.startsWith("skill_invoke__")) return ToolRiskCategory.Read;
  if (toolId === "skill.view") return ToolRiskCategory.Read;
  // MCP tools — infer from name
  if (toolName.startsWith("mcp__")) return ToolRiskCategory.Write;
  return ToolRiskCategory.Read;
}

function getApprovalSource(toolId: string): "builtin-tool" | "mcp-tool" | "skill" {
  if (toolId.startsWith("skill_invoke__")) return "skill";
  if (toolId.startsWith("mcp__")) return "mcp-tool";
  return "builtin-tool";
}

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Broadcast a streaming event to all renderer windows.
 * Uses the session channel so the renderer can filter by sessionId.
 * Wrapped in try-catch because webContents may be destroyed between
 * getAllWebContents() and send(), which would throw and crash the agentic loop.
 */
function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.isDestroyed()) {
        wc.send(channel, payload);
      }
    } catch {
      // WebContents destroyed between check and send — safe to ignore
    }
  }
}

/**
 * Build a rich system prompt for a session.
 * The optional `gitBranch` parameter avoids calling execSync on the main thread.
 * Callers should pre-compute the branch asynchronously via getGitBranchAsync().
 */
function buildSystemPrompt(session: ChatSession, workingDir: string, skills?: SkillDefinition[], gitBranch?: string | null): string {
  const now = new Date();
  const parts: string[] = [];

  parts.push(`You are MyClaw, an expert AI coding assistant with access to tools for reading, writing, and searching files, executing commands, and searching the web.`);

  parts.push(`\n# Environment`);
  parts.push(`- Working directory: ${workingDir}`);
  parts.push(`- Platform: ${process.platform} (${process.arch})`);
  parts.push(`- Current date: ${now.toISOString().split("T")[0]}`);
  parts.push(`- Current time: ${now.toTimeString().split(" ")[0]}`);

  if (gitBranch) {
    parts.push(`- Git branch: ${gitBranch}`);
  }

  parts.push(`\n# Tool Usage`);
  parts.push(`You have access to tools for filesystem operations, shell commands, git, web search, and more.`);
  parts.push(`- Use \`fs_read\` to read files before editing them.`);
  parts.push(`- Use \`fs_edit\` for partial edits (string replacement) — ALWAYS prefer this over \`fs_write\` when modifying existing files.`);
  parts.push(`- Use \`fs_write\` only for creating new files or complete rewrites.`);
  parts.push(`- Use \`exec_command\` for running shell commands. Dangerous commands are blocked.`);
  parts.push(`- Use \`fs_search\` to grep for text patterns across files.`);
  parts.push(`- Use \`fs_find\` to find files by glob patterns.`);
  parts.push(`- Use \`git_status\`, \`git_diff\`, \`git_log\` for repository state.`);
  parts.push(`- Use \`web_search\` for current information you don't have.`);
  parts.push(`- Use \`browser_open\` to open a URL in a real browser (Chrome/Edge). The browser launches automatically on first use.`);
  parts.push(`- Use \`browser_snapshot\` to get the page's accessibility tree — this is how you "see" the page. The output includes ref=N references you can use with click/type.`);
  parts.push(`- Use \`browser_click\`, \`browser_type\`, \`browser_select\` to interact with page elements. Pass ref references (e.g. "ref=42") from the snapshot, or CSS selectors, or text matches (e.g. "text=Login").`);
  parts.push(`- Use \`browser_screenshot\` for visual verification when the accessibility tree isn't enough.`);
  parts.push(`- Use \`browser_evaluate\` to run JavaScript in the page context for data extraction or state checks.`);
  parts.push(`- **Browser workflow**: open URL → snapshot to understand → click/type to interact → snapshot again to verify result.`);

  if (skills && skills.length > 0) {
    const skillsWithView = skills.filter((s) => s.hasViewFile);
    parts.push(`\n# Available Skills`);
    parts.push(`Use skill_invoke__<skill_id> to read a skill's instructions (SKILL.md). The skill content tells you what scripts to call and what data to produce.`);
    if (skillsWithView.length > 0) {
      parts.push(`\n## 可视化面板 (skill_view)`);
      parts.push(`Some skills have HTML panels. After completing work and generating result data, call the \`skill_view\` tool to open the panel:`);
      parts.push(`- \`skill_view({ skill_id: "...", page: "analysis.html", data: { ... } })\` — the data you pass is sent directly to the HTML page.`);
      parts.push(`**流程**: 1) skill_invoke 读取指令 → 2) 按指令完成工作、生成数据 → 3) skill_view 传入数据打开面板`);
      parts.push(`**重要**: skill_invoke 只读取指令，不会打开面板。必须在工作完成后单独调用 skill_view，并把生成的结构化数据传入 data 参数。`);
    }
    for (const skill of skills) {
      const viewNote = skill.hasViewFile
        ? ` [有HTML面板: ${skill.viewFiles?.join(", ")} — 完成后用 skill_view 传入数据打开]`
        : "";
      parts.push(`- **${skill.name}**: ${skill.description || "(无描述)"}${viewNote} → call \`skill_invoke__${skill.id.replace(/[^a-zA-Z0-9_-]/g, "_")}\``);
    }
  }

  parts.push(`\n# Guidelines`);
  parts.push(`- Respond in the same language the user uses.`);
  parts.push(`- When editing code, always read the file first to understand the context.`);
  parts.push(`- For multi-step tasks, plan first, then execute step by step.`);
  parts.push(`- If a tool call fails, analyze the error and try a different approach.`);
  parts.push(`- Be concise but thorough in explanations.`);

  return parts.join("\n");
}

/**
 * Calculate cumulative token usage for a session.
 */
export function calculateSessionTokens(session: ChatSession): number {
  return session.messages.reduce((sum: number, msg: SessionChatMessage) => {
    return sum + (msg.usage?.totalTokens ?? 0);
  }, 0);
}

/**
 * Build a fallback summary when model-generated summary is unavailable.
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

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

export function registerSessionHandlers(ctx: RuntimeContext): void {
  // Create a new chat session
  ipcMain.handle("session:create", async (_event, input: CreateSessionInput): Promise<SessionPayload> => {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      title: input?.title ?? "New Chat",
      modelProfileId: input?.modelProfileId ?? ctx.state.getDefaultModelProfileId() ?? "",
      attachedDirectory: input?.attachedDirectory ?? null,
      createdAt: now,
      messages: [],
    };

    ctx.state.sessions.push(session);

    await saveSession(ctx.runtime.paths, session);

    return { session };
  });

  // Delete a session by ID
  ipcMain.handle("session:delete", async (_event, sessionId: string): Promise<SessionsPayload> => {
    const index = ctx.state.sessions.findIndex((s) => s.id === sessionId);
    if (index !== -1) {
      ctx.state.sessions.splice(index, 1);
    }

    await deleteSessionFiles(ctx.runtime.paths, sessionId);

    return {
      sessions: [...ctx.state.sessions],
      approvalRequests: ctx.state.getApprovalRequests().filter((r) => r.sessionId !== sessionId),
    };
  });

  // -------------------------------------------------------------------------
  // Send a message — agentic tool loop
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "session:send-message",
    async (_event, sessionId: string, input: SendMessageInput): Promise<SessionPayload> => {
      const session = ctx.state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const messageId = randomUUID();
      const now = new Date().toISOString();

      // Append the user message
      session.messages.push({
        id: randomUUID(),
        role: "user",
        content: input.content,
        createdAt: now,
      });

      // Notify renderer that the run started
      broadcastToRenderers("session:stream", {
        type: EventType.RunStarted,
        sessionId,
        messageId,
      });

      // Resolve the model profile to use for this session
      const profileId = session.modelProfileId || ctx.state.getDefaultModelProfileId();
      const modelProfile = ctx.state.models.find((m) => m.id === profileId)
        ?? ctx.state.models[0];

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
        return { session };
      }

      // Build tool schemas for function calling
      const workingDir = session.attachedDirectory || ctx.runtime.myClawRootPath || process.cwd();
      const enabledSkills = ctx.state.skills.filter((s) => s.enabled && !s.disableModelInvocation);

      // Gather MCP tools from all connected servers
      const mcpTools = ctx.services.mcpManager?.getAllTools() ?? [];
      const tools = buildToolSchemas(workingDir, enabledSkills, mcpTools);

      // Update the tool executor with current skills and path permissions
      toolExecutor.setSkills(ctx.state.skills);
      toolExecutor.setAllowExternalPaths(allowsExternalPaths(ctx.state.getApprovals().mode));

      // ----- Pre-compute git branch asynchronously (non-blocking) -----
      const gitBranch = await getGitBranchAsync(workingDir);

      // Create a bound system prompt builder that uses the cached git branch
      // (avoids execSync on every agentic loop iteration)
      const boundBuildSystemPrompt = (s: ChatSession, wd: string, sk?: SkillDefinition[]) =>
        buildSystemPrompt(s, wd, sk, gitBranch);

      // ----- Agentic loop: call model → execute tools → feed results → repeat -----
      let round = 0;
      let currentMessageId = messageId;
      const roundSignatures: string[] = [];
      let loopWarningInjected = false;

      try {
        while (round < SAFETY_CEILING) {
          round++;
          // 使用上下文工程管线：能力解析 → 预算计算 → 压缩 → 组装
          const resolved = resolveModelCapability(modelProfile);
          const assembled = assembleContext({
            session,
            capability: resolved.effective,
            workingDir,
            skills: enabledSkills,
            systemPromptBuilder: boundBuildSystemPrompt,
          });
          if (assembled.wasCompacted) {
            console.info(
              `[session:context] Round ${round}: compacted ${assembled.removedCount} messages` +
              ` (${assembled.compactionReason}), budget used: ${assembled.budgetUsed}`,
            );
          }
          const modelMessages = assembled.messages as ModelChatMessage[];

          const result = await callModel({
            profile: modelProfile,
            messages: modelMessages,
            tools,
            onDelta: (delta) => {
              broadcastToRenderers("session:stream", {
                type: EventType.MessageDelta,
                sessionId,
                messageId: currentMessageId,
                delta,
              });
            },
          });

          // Check if the model made tool calls
          const hasToolCalls = result.toolCalls.length > 0;

          if (hasToolCalls) {
            // Append the assistant message WITH tool_calls (content may be empty)
            const assistantMsg = {
              id: currentMessageId,
              role: "assistant" as const,
              content: result.content || "",
              ...(result.reasoning ? { reasoning: result.reasoning } : {}),
              ...(result.usage ? { usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens } } : {}),
              tool_calls: result.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.argumentsJson },
              })),
              createdAt: new Date().toISOString(),
            };
            session.messages.push(assistantMsg);

            // Broadcast the assistant message with tool calls info
            broadcastToRenderers("session:stream", {
              type: EventType.MessageCompleted,
              sessionId,
              messageId: currentMessageId,
            });
            // Broadcast session update so renderer shows tool_calls in real-time
            broadcastToRenderers("session:stream", {
              type: EventType.SessionUpdated,
              sessionId,
              session,
            });

            // ---- Step 1: Check approvals for all tool calls (serial — awaits user) ----
            type ApprovedTool = { toolCall: ResolvedToolCall; denied: boolean };
            const approvedTools: ApprovedTool[] = [];

            for (const toolCall of result.toolCalls) {
              const toolCallId = toolCall.id;
              const toolId = functionNameToToolId(toolCall.name);
              const label = buildToolLabel(toolCall.name, toolCall.input);
              const risk = getToolRisk(toolId, toolCall.name);
              const source = getApprovalSource(toolId);

              const policy = ctx.state.getApprovals();
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

                const existingRequests = ctx.state.getApprovalRequests();
                ctx.state.setApprovalRequests([...existingRequests, approvalRequest]);

                broadcastToRenderers("session:stream", {
                  type: EventType.ApprovalRequested,
                  sessionId,
                  approvalRequest,
                });

                const decision = await new Promise<"approve" | "deny">((resolve) => {
                  // Auto-cleanup: deny after 5 minutes if renderer never responds
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
                ctx.state.setApprovalRequests(
                  ctx.state.getApprovalRequests().filter((r) => r.id !== approvalId),
                );

                if (decision === "deny") {
                  approvedTools.push({ toolCall, denied: true });
                  continue;
                }
              }

              approvedTools.push({ toolCall, denied: false });
            }

            // ---- Step 2: Execute a single tool call (shared helper) ----
            const executeSingleTool = async (toolCall: ResolvedToolCall): Promise<ChatMessageContent> => {
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
              try {
                if (toolCall.name.startsWith("mcp__")) {
                  const mcpTool = mcpTools.find((t) => {
                    const safeName = t.id.replace(/[^a-zA-Z0-9_-]/g, "_");
                    return safeName === toolCall.name;
                  });
                  if (!mcpTool || !ctx.services.mcpManager) {
                    throw new Error(`MCP tool not found: ${toolCall.name}`);
                  }
                  toolOutput = await ctx.services.mcpManager.callTool(
                    mcpTool.serverId,
                    mcpTool.name,
                    toolCall.input,
                  );
                } else {
                  const execResult = await toolExecutor.execute(toolId, label, workingDir);
                  toolOutput = execResult.success
                    ? execResult.output
                    : `[错误] ${execResult.error ?? "工具执行失败"}\n${execResult.output}`.trim();

                  // Capture screenshot image for multimodal response
                  if (execResult.imageBase64) {
                    imageBase64 = execResult.imageBase64;
                  }

                  // If skill has a view, tell the renderer to open the WebPanel
                  if (execResult.viewMeta) {
                    broadcastToRenderers("web-panel:open", execResult.viewMeta);
                  }
                }

                broadcastToRenderers("session:stream", {
                  type: EventType.ToolCompleted,
                  sessionId,
                  toolCallId,
                  toolId,
                  output: toolOutput.slice(0, 500),
                  success: true,
                });
              } catch (err) {
                toolOutput = `[工具执行异常] ${err instanceof Error ? err.message : String(err)}`;
                broadcastToRenderers("session:stream", {
                  type: EventType.ToolFailed,
                  sessionId,
                  toolCallId,
                  toolId,
                  error: toolOutput,
                });
              }

              // Cap tool output to prevent session bloat (compactor handles context window separately)
              const MAX_TOOL_OUTPUT_PERSIST = 8000; // ~2k tokens
              const cappedOutput = toolOutput.length > MAX_TOOL_OUTPUT_PERSIST
                ? toolOutput.slice(0, MAX_TOOL_OUTPUT_PERSIST) + `\n\n[... truncated ${toolOutput.length - MAX_TOOL_OUTPUT_PERSIST} chars for session storage]`
                : toolOutput;

              // Return multimodal content for screenshots (vision-capable models)
              if (imageBase64) {
                return [
                  { type: "text", text: cappedOutput },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "low" } },
                ];
              }

              return cappedOutput;
            };

            // ---- Step 3: Handle denied tools ----
            for (const { toolCall } of approvedTools.filter((t) => t.denied)) {
              const toolCallId = toolCall.id;
              const toolId = functionNameToToolId(toolCall.name);
              const deniedOutput = `[用户拒绝] 工具 ${toolCall.name} 被用户拒绝执行。`;
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
              // Broadcast session update so denied tool results appear in real-time
              broadcastToRenderers("session:stream", {
                type: EventType.SessionUpdated,
                sessionId,
                session,
              });
            }

            // ---- Step 4: Split approved tools into read-only vs write groups ----
            const approved = approvedTools.filter((t) => !t.denied);
            const readOnlyTasks = approved.filter((t) => isReadOnlyTool(functionNameToToolId(t.toolCall.name)));
            const writeTasks = approved.filter((t) => !isReadOnlyTool(functionNameToToolId(t.toolCall.name)));

            // Execute read-only tools concurrently (batched by PARALLEL_LIMIT)
            // Collect results first, then push messages serially for deterministic ordering
            for (let i = 0; i < readOnlyTasks.length; i += PARALLEL_LIMIT) {
              const batch = readOnlyTasks.slice(i, i + PARALLEL_LIMIT);
              const results = await Promise.all(
                batch.map(async ({ toolCall }) => {
                  const result = await executeSingleTool(toolCall);
                  return { toolCall, result };
                }),
              );
              // Push messages serially in deterministic order
              for (const { toolCall, result } of results) {
                session.messages.push({
                  id: randomUUID(),
                  role: "tool" as const,
                  content: result,
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

            // Execute write tools serially
            for (const { toolCall } of writeTasks) {
              const result = await executeSingleTool(toolCall);
              session.messages.push({
                id: randomUUID(),
                role: "tool" as const,
                content: result,
                tool_call_id: toolCall.id,
                createdAt: new Date().toISOString(),
              });
              broadcastToRenderers("session:stream", {
                type: EventType.SessionUpdated,
                sessionId,
                session,
              });
            }

            // ---- Loop detection ----
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

            // Prepare for next round
            currentMessageId = randomUUID();

            // Broadcast that we're starting a new model call
            broadcastToRenderers("session:stream", {
              type: EventType.RunStarted,
              sessionId,
              messageId: currentMessageId,
              round,
            });
          } else {
            // No tool calls — this is the final response
            session.messages.push({
              id: currentMessageId,
              role: "assistant",
              content: result.content,
              ...(result.reasoning ? { reasoning: result.reasoning } : {}),
              ...(result.usage ? { usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens } } : {}),
              createdAt: new Date().toISOString(),
            });

            // Auto-generate session title from first exchange
            if (session.title === "New Chat" && session.messages.length >= 2) {
              const userMsg = session.messages.find((m: SessionChatMessage) => m.role === "user");
              if (userMsg) {
                const raw = (typeof userMsg.content === "string" ? userMsg.content : "").trim().split("\n")[0] ?? "";
                session.title = raw.length > 50 ? raw.slice(0, 47) + "..." : raw || "New Chat";
              }
            }

            break;
          }
        }

        // Safety ceiling reached (should be extremely rare — 200 rounds)
        if (round >= SAFETY_CEILING) {
          console.warn(`[session:agentic] Hit safety ceiling of ${SAFETY_CEILING} rounds`);
          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: `[已执行 ${SAFETY_CEILING} 轮工具调用，达到安全上限，自动停止]`,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        const errorContent = `[模型调用失败] ${errorText}`;

        broadcastToRenderers("session:stream", {
          type: EventType.MessageDelta,
          sessionId,
          messageId: currentMessageId,
          delta: { content: errorContent },
        });

        session.messages.push({
          id: currentMessageId,
          role: "assistant",
          content: errorContent,
          createdAt: new Date().toISOString(),
        });
      }

      broadcastToRenderers("session:stream", {
        type: EventType.MessageCompleted,
        sessionId,
        messageId: currentMessageId,
      });

      broadcastToRenderers("session:stream", {
        type: EventType.SessionUpdated,
        sessionId,
        session,
      });

      // Persist updated messages to disk
      await saveSession(ctx.runtime.paths, session);

      return { session };
    },
  );

  // Get pending execution intents for a session
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

  // Resolve a pending approval request with full ApprovalDecision semantics
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

      // Clear the auto-deny timeout since the user responded
      clearTimeout(pending.timeout);

      // 映射到 agentic loop 的 approve/deny
      pending.resolve(decision === "deny" ? "deny" : "approve");
      return { success: true };
    },
  );

  // Update approval policy
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
}
