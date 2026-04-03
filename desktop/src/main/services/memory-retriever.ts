/**
 * 记忆检索器 — 从记忆库中检索与查询最相关的 Top-N 条记忆。
 */

import type { MemoryEntry } from "./memory-extractor";
import { rankMemories } from "./memory-ranker";

/**
 * 检索与查询最相关的记忆，返回排序后的 Top-N 条。
 */
export function retrieveRelevantMemories(
  memories: MemoryEntry[],
  query: string,
  limit: number = 5,
): MemoryEntry[] {
  if (memories.length === 0) return [];

  const ranked = rankMemories(memories, query);
  return ranked.slice(0, limit);
}
