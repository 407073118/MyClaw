/**
 * 上下文组装器 — 将系统提示、近期轮次、工作记忆组装为模型请求消息。
 * 替代原来 sessions.ts 中的 buildModelMessagesWithCompact。
 */

import type {
  ChatSession,
  ChatMessage,
  ModelCapability,
  ContextBudgetPolicy,
  SkillDefinition,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";
import { buildBudgetSnapshot } from "./token-budget-manager";
import { estimateTokenCount } from "./token-estimator";
import { compactMessages } from "./context-compactor";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 组装后的上下文结果 */
export type AssembledContext = {
  /** 最终发送给模型的消息列表 */
  messages: Array<{ role: string; content: string; reasoning?: string | null; tool_call_id?: string; tool_calls?: unknown[] }>;
  /** 估算的总 token 数 */
  budgetUsed: number;
  /** 是否执行了压缩 */
  wasCompacted: boolean;
  /** 压缩原因 */
  compactionReason: string | null;
  /** 被移除的消息数 */
  removedCount: number;
};

export type AssembleInput = {
  session: ChatSession;
  capability: ModelCapability;
  policy?: ContextBudgetPolicy;
  workingDir: string;
  skills?: SkillDefinition[];
  /** 可选的系统提示构建器，不传则使用默认摘要 */
  systemPromptBuilder?: (session: ChatSession, workingDir: string, skills?: SkillDefinition[]) => string;
  /** 可选的工作记忆内容 */
  workingMemory?: string;
};

// ---------------------------------------------------------------------------
// 默认系统提示
// ---------------------------------------------------------------------------

const MESSAGE_OVERHEAD = 4;

/** 构建最小系统提示（用于测试和独立使用场景） */
function buildDefaultSystemPrompt(session: ChatSession, workingDir: string): string {
  return [
    "You are MyClaw, an expert AI coding assistant.",
    `Working directory: ${workingDir}`,
    `Current date: ${new Date().toISOString().split("T")[0]}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 核心组装逻辑
// ---------------------------------------------------------------------------

/**
 * 组装完整的模型请求上下文。
 *
 * 流程：
 * 1. 构建系统提示，估算固定开销
 * 2. 计算安全输入预算
 * 3. 将会话消息通过压缩器裁剪到预算内
 * 4. 拼接最终消息列表
 */
export function assembleContext(input: AssembleInput): AssembledContext {
  const {
    session,
    capability,
    workingDir,
    skills,
    systemPromptBuilder,
    workingMemory,
  } = input;
  const policy = { ...DEFAULT_CONTEXT_BUDGET_POLICY, ...(input.policy ?? {}) };
  const mode = capability.tokenCountingMode ?? "character-fallback";

  // 构建预算快照
  const budget = buildBudgetSnapshot(capability, policy);

  // 构建系统提示
  const buildPrompt = systemPromptBuilder ?? buildDefaultSystemPrompt;
  const systemPrompt = buildPrompt(session, workingDir, skills);

  // 如果有工作记忆，附加到系统提示中
  const finalSystemPrompt = workingMemory
    ? `${systemPrompt}\n\n# Working Memory\n${workingMemory}`
    : systemPrompt;

  // 估算系统提示的 token 开销
  const systemTokens = estimateTokenCount(finalSystemPrompt, mode) + MESSAGE_OVERHEAD;

  // 可用于会话消息的预算
  const messageBudget = Math.max(0, budget.safeInputBudget - systemTokens);

  // 通过压缩器处理会话消息
  const compactionResult = compactMessages({
    messages: session.messages,
    budgetTokens: messageBudget,
    capability,
    policy,
  });

  // 组装最终消息列表
  const finalMessages: AssembledContext["messages"] = [];

  // 系统提示
  finalMessages.push({
    role: "system",
    content: finalSystemPrompt,
  });

  // 会话消息
  for (const msg of compactionResult.compacted) {
    const entry: AssembledContext["messages"][0] = {
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map(c => c.text).join("\n"),
    };
    if (msg.reasoning) entry.reasoning = msg.reasoning;
    if (msg.tool_call_id) entry.tool_call_id = msg.tool_call_id;
    if (msg.tool_calls && msg.tool_calls.length > 0) entry.tool_calls = msg.tool_calls;
    finalMessages.push(entry);
  }

  return {
    messages: finalMessages,
    budgetUsed: systemTokens + compactionResult.estimatedTokens,
    wasCompacted: compactionResult.removedCount > 0,
    compactionReason: compactionResult.reason,
    removedCount: compactionResult.removedCount,
  };
}
