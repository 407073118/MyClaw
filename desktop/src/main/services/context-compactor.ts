/**
 * 上下文压缩器 — 按固定顺序执行多阶段压缩。
 *
 * 压缩顺序：
 * 1. 截断超大工具输出
 * 2. 移除陈旧的历史消息（保留近期轮次）
 * 3. 未来阶段：生成摘要、更新工作记忆
 */

import type {
  ChatMessage,
  ContextBudgetPolicy,
  ExecutionPlan,
  ModelCapability,
  SessionReplayPolicy,
  TokenCountingMode,
} from "@shared/contracts";
import { textOfContent } from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";
import { estimateTokenCount } from "./token-estimator";
import { sanitizeToolOutput } from "./tool-output-sanitizer";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type CompactionInput = {
  messages: ChatMessage[];
  budgetTokens: number;
  capability: ModelCapability;
  policy?: ContextBudgetPolicy;
  replayPolicy?: SessionReplayPolicy;
  executionPlan?: Pick<ExecutionPlan, "replayPolicy"> | null;
};

export type CompactionResult = {
  /** 压缩后的消息列表 */
  compacted: ChatMessage[];
  /** 被移除的消息数 */
  removedCount: number;
  /** 被 Observation Masking 替换的工具输出数 */
  maskedToolOutputCount: number;
  /** 压缩原因（null 表示未触发压缩） */
  reason: string | null;
  /** 压缩后的估算 token 数 */
  estimatedTokens: number;
};

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

const MESSAGE_OVERHEAD = 4;

function resolveReplayPolicy(input: Pick<CompactionInput, "executionPlan" | "replayPolicy">): SessionReplayPolicy | null {
  return input.executionPlan?.replayPolicy ?? input.replayPolicy ?? null;
}

function sanitizeReplayMessage(
  message: ChatMessage,
  replayPolicy: SessionReplayPolicy | null,
): ChatMessage {
  if (message.role !== "assistant" || replayPolicy === null || replayPolicy === "assistant-turn-with-reasoning") {
    return { ...message };
  }

  const { reasoning: _reasoning, ...rest } = message;
  return rest;
}

/** 估算单条消息的 token 数 */
function estimateMessageTokens(msg: ChatMessage, mode: TokenCountingMode = "character-fallback"): number {
  return estimateTokenCount(textOfContent(msg.content), mode) + MESSAGE_OVERHEAD;
}

// ---------------------------------------------------------------------------
// Observation Masking 辅助
// ---------------------------------------------------------------------------

/**
 * 为被遮盖的工具输出生成结构化占位符。
 * 提取工具名（从前置的 assistant tool_call）和输出摘要前 80 字符。
 */
function buildToolOutputPlaceholder(
  toolContent: string,
  toolCallId: string | undefined,
  messages: ChatMessage[],
  msgIndex: number,
): string {
  // 尝试从前面的 assistant 消息中找到对应的 tool_call 名称
  let toolName = "unknown";
  if (toolCallId) {
    for (let j = msgIndex - 1; j >= 0; j--) {
      const prev = messages[j];
      if (prev.role === "assistant" && prev.tool_calls) {
        const call = prev.tool_calls.find((tc) => tc.id === toolCallId);
        if (call) {
          toolName = call.function.name;
          break;
        }
      }
    }
  }
  const preview = toolContent.slice(0, 80).replace(/\n/g, " ");
  const lines = toolContent.split("\n").length;
  return `[工具输出已省略] 工具: ${toolName}, 原始行数: ${lines}, 摘要: ${preview}…`;
}

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

/**
 * 对消息列表执行多阶段压缩。
 * 输入的消息数组不会被修改，返回新数组。
 *
 * 压缩阶段：
 *   1.   截断超大工具输出（单条 > 2000 token）
 *   1.5  Observation Masking — 旧工具输出替换为占位符（保留最近 N 条）
 *   2.   移除陈旧的历史消息（保留近期轮次）
 *
 * 性能：O(n) — 预计算每条消息 token 数，增量更新总量。
 */
export function compactMessages(input: CompactionInput): CompactionResult {
  const { budgetTokens, capability } = input;
  const policy = { ...DEFAULT_CONTEXT_BUDGET_POLICY, ...(input.policy ?? {}) };
  const mode = capability.tokenCountingMode ?? "character-fallback";
  const replayPolicy = resolveReplayPolicy(input);

  // 复制消息列表
  let messages = input.messages.map((message) => sanitizeReplayMessage(message, replayPolicy));

  // 预计算每条消息的 token 数 (O(n)，只算一次)
  const tokenCounts = messages.map(m => estimateMessageTokens(m, mode));
  let totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0) + 3; // +3 conversation overhead

  // 如果已经在预算内，不需要压缩
  if (totalTokens <= budgetTokens) {
    return {
      compacted: messages,
      removedCount: 0,
      maskedToolOutputCount: 0,
      reason: null,
      estimatedTokens: totalTokens,
    };
  }

  // --- 阶段 1：截断超大工具输出 ---
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") {
      const beforeText = textOfContent(messages[i].content);
      const sanitized = sanitizeToolOutput(beforeText, 2000);
      if (sanitized !== beforeText) {
        messages[i].content = sanitized;
        console.info(`[context-compactor] 截断工具输出: ${beforeText.length} → ${sanitized.length} 字符`);
        const newCount = estimateMessageTokens(messages[i], mode);
        totalTokens += newCount - tokenCounts[i];
        tokenCounts[i] = newCount;
      }
    }
  }
  if (totalTokens <= budgetTokens) {
    return {
      compacted: messages,
      removedCount: 0,
      maskedToolOutputCount: 0,
      reason: "tool-output-trimmed",
      estimatedTokens: totalTokens,
    };
  }

  // --- 阶段 1.5：Observation Masking — 将旧工具输出替换为占位符 ---
  const recentToolKeep = policy.recentToolOutputTurnsToKeep ?? 10;

  // 倒序收集所有 tool 消息的索引
  const toolIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool") {
      toolIndices.push(i);
    }
  }
  // toolIndices 现在是倒序的（最新的在前），跳过最近 recentToolKeep 条
  let maskedCount = 0;
  for (let k = recentToolKeep; k < toolIndices.length; k++) {
    const idx = toolIndices[k];
    const content = textOfContent(messages[idx].content);
    // 已经很短的工具输出（≤ 100 字符）没必要替换
    if (content.length <= 100) continue;

    const placeholder = buildToolOutputPlaceholder(
      content,
      messages[idx].tool_call_id,
      messages,
      idx,
    );
    messages[idx].content = placeholder;
    maskedCount++;

    const newCount = estimateMessageTokens(messages[idx], mode);
    totalTokens += newCount - tokenCounts[idx];
    tokenCounts[idx] = newCount;
  }

  if (maskedCount > 0) {
    console.info(`[context-compactor] Observation Masking: 替换了 ${maskedCount} 条旧工具输出为占位符`);
  }

  if (totalTokens <= budgetTokens) {
    return {
      compacted: messages,
      removedCount: 0,
      maskedToolOutputCount: maskedCount,
      reason: "observation-masked",
      estimatedTokens: totalTokens,
    };
  }

  // --- 阶段 2：移除陈旧消息，保留近期轮次 ---
  const minKeep = policy.minRecentTurnsToKeep ?? 12;

  let removeCount = 0;
  while (removeCount < messages.length - minKeep && totalTokens > budgetTokens) {
    const count = tokenCounts[removeCount];
    if (count === undefined || count <= 0) break;
    totalTokens -= count;
    removeCount++;
  }

  if (removeCount > 0) {
    messages = messages.slice(removeCount);
  }

  const reasons: string[] = [];
  if (maskedCount > 0) reasons.push(`Observation Masking ${maskedCount} 条工具输出`);
  if (removeCount > 0) reasons.push(`移除 ${removeCount} 条陈旧消息`);

  return {
    compacted: messages,
    removedCount: removeCount,
    maskedToolOutputCount: maskedCount,
    reason: reasons.length > 0 ? reasons.join("；") : "tool-output-trimmed",
    estimatedTokens: totalTokens,
  };
}
