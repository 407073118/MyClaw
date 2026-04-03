/**
 * 记忆排序器 — 根据相关性、重要性、时效性对记忆进行排序。
 */

import type { MemoryEntry } from "./memory-extractor";

// ---------------------------------------------------------------------------
// 排序因子权重
// ---------------------------------------------------------------------------

const WEIGHTS = {
  relevance: 0.4,
  importance: 0.3,
  recency: 0.2,
  pinBonus: 0.1,
};

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

/**
 * 对记忆列表按查询相关性排序，返回排序后的新数组。
 */
export function rankMemories(
  memories: MemoryEntry[],
  query: string,
): MemoryEntry[] {
  if (memories.length === 0) return [];

  const now = Date.now();

  const scored = memories.map(memory => ({
    memory,
    score: computeScore(memory, query, now),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.map(s => s.memory);
}

// ---------------------------------------------------------------------------
// 评分计算
// ---------------------------------------------------------------------------

function computeScore(memory: MemoryEntry, query: string, now: number): number {
  const relevance = computeRelevance(memory.content, query);
  const importance = memory.importance ?? 0.5;
  const recency = computeRecency(memory.createdAt, now);
  const pinBonus = memory.pinned ? 1.0 : 0.0;

  return (
    WEIGHTS.relevance * relevance +
    WEIGHTS.importance * importance +
    WEIGHTS.recency * recency +
    WEIGHTS.pinBonus * pinBonus
  );
}

/**
 * 计算文本相关性分数（0-1），基于关键词匹配。
 */
function computeRelevance(content: string, query: string): number {
  if (!query || !content) return 0;

  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();

  // 分词
  const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 1);
  if (queryTokens.length === 0) return 0;

  // 计算匹配的词数占比
  let matchCount = 0;
  for (const token of queryTokens) {
    if (contentLower.includes(token)) {
      matchCount++;
    }
  }

  return matchCount / queryTokens.length;
}

/**
 * 计算时效性分数（0-1），越近越高。
 * 使用指数衰减，半衰期为 7 天。
 */
function computeRecency(createdAt: string, now: number): number {
  const created = new Date(createdAt).getTime();
  if (isNaN(created)) return 0.5;

  const ageMs = now - created;
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000; // 7 天
  return Math.exp(-0.693 * ageMs / halfLifeMs);
}
