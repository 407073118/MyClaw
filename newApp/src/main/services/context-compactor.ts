/**
 * 上下文压缩器 — 按固定顺序执行多阶段压缩。
 *
 * 压缩顺序：
 * 1. 截断超大工具输出
 * 2. 移除陈旧的历史消息（保留近期轮次）
 * 3. 未来阶段：生成摘要、更新工作记忆
 */

import type { ChatMessage, ModelCapability, ContextBudgetPolicy, TokenCountingMode } from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";
import { estimateTokenCount } from "./token-estimator";
import { sanitizeToolOutput } from "./tool-output-sanitizer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactionInput = {
  messages: ChatMessage[];
  budgetTokens: number;
  capability: ModelCapability;
  policy?: ContextBudgetPolicy;
};

export type CompactionResult = {
  /** 压缩后的消息列表 */
  compacted: ChatMessage[];
  /** 被移除的消息数 */
  removedCount: number;
  /** 压缩原因（null 表示未触发压缩） */
  reason: string | null;
  /** 压缩后的估算 token 数 */
  estimatedTokens: number;
};

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

const MESSAGE_OVERHEAD = 4;

/** 估算单条消息的 token 数 */
function estimateMessageTokens(msg: ChatMessage, mode: TokenCountingMode = "character-fallback"): number {
  return estimateTokenCount(msg.content, mode) + MESSAGE_OVERHEAD;
}

/** 估算消息列表的总 token 数 */
function estimateTotalTokens(messages: ChatMessage[], mode: TokenCountingMode = "character-fallback"): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m, mode), 0) + 3;
}

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

/**
 * 对消息列表执行多阶段压缩。
 * 输入的消息数组不会被修改，返回新数组。
 *
 * 性能：O(n) — 预计算每条消息 token 数，增量更新总量，
 * 避免原来 O(n²) 的 shift + 全量重算。
 */
export function compactMessages(input: CompactionInput): CompactionResult {
  const { budgetTokens, capability } = input;
  const policy = { ...DEFAULT_CONTEXT_BUDGET_POLICY, ...(input.policy ?? {}) };
  const mode = capability.tokenCountingMode ?? "character-fallback";

  // 复制消息列表
  let messages = input.messages.map(m => ({ ...m }));

  // 预计算每条消息的 token 数 (O(n)，只算一次)
  const tokenCounts = messages.map(m => estimateMessageTokens(m, mode));
  let totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0) + 3; // +3 conversation overhead

  // 如果已经在预算内，不需要压缩
  if (totalTokens <= budgetTokens) {
    return {
      compacted: messages,
      removedCount: 0,
      reason: null,
      estimatedTokens: totalTokens,
    };
  }

  // --- 阶段 1：截断超大工具输出 ---
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") {
      const before = messages[i].content;
      messages[i].content = sanitizeToolOutput(messages[i].content, 2000);
      if (messages[i].content !== before) {
        console.info(`[context-compactor] 截断工具输出: ${before.length} → ${messages[i].content.length} 字符`);
        // 增量更新：只重算这一条消息的 token 差值
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
      reason: "tool-output-trimmed",
      estimatedTokens: totalTokens,
    };
  }

  // --- 阶段 2：移除陈旧消息，保留近期轮次 ---
  const minKeep = policy.minRecentTurnsToKeep ?? 12;

  // O(n) 移除：从头部减去 token 数，直到在预算内或只剩 minKeep 条
  let removeCount = 0;
  while (removeCount < messages.length - minKeep && totalTokens > budgetTokens) {
    const count = tokenCounts[removeCount];
    if (count === undefined || count <= 0) break; // 安全守卫：防止无限循环
    totalTokens -= count;
    removeCount++;
  }

  if (removeCount > 0) {
    messages = messages.slice(removeCount);
  }

  return {
    compacted: messages,
    removedCount: removeCount,
    reason: removeCount > 0 ? `移除了 ${removeCount} 条陈旧消息以适应上下文窗口` : "tool-output-trimmed",
    estimatedTokens: totalTokens,
  };
}
