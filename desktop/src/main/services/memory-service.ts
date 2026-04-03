/**
 * 记忆服务 — 管理工作记忆、长期记忆的提取、存储和检索。
 * 整合 extractor、ranker、retriever 为统一接口。
 */

import type { ChatMessage } from "@shared/contracts";
import type { MemoryEntry, MemoryType } from "./memory-extractor";
import { extractMemoryCandidates } from "./memory-extractor";
import { retrieveRelevantMemories } from "./memory-retriever";

// ---------------------------------------------------------------------------
// 记忆服务类
// ---------------------------------------------------------------------------

export class MemoryService {
  private memories: MemoryEntry[] = [];

  /**
   * 获取所有记忆条目。
   */
  getAllMemories(): MemoryEntry[] {
    return [...this.memories];
  }

  /**
   * 添加一条记忆。
   */
  addMemory(entry: MemoryEntry): void {
    this.memories.push(entry);
  }

  /**
   * 批量添加记忆。
   */
  addMemories(entries: MemoryEntry[]): void {
    this.memories.push(...entries);
  }

  /**
   * 从对话消息中提取记忆候选项并存储。
   */
  extractAndStore(messages: ChatMessage[], sessionId: string): MemoryEntry[] {
    const candidates = extractMemoryCandidates(messages, sessionId);
    if (candidates.length > 0) {
      this.addMemories(candidates);
      console.info(`[memory-service] 提取并存储了 ${candidates.length} 条记忆候选项`);
    }
    return candidates;
  }

  /**
   * 检索与查询相关的记忆。
   */
  getRelevantMemories(query: string, limit: number = 5): MemoryEntry[] {
    return retrieveRelevantMemories(this.memories, query, limit);
  }

  /**
   * 构建记忆上下文字符串，用于注入系统提示。
   */
  buildMemoryContext(query: string, limit: number = 5): string {
    const relevant = this.getRelevantMemories(query, limit);
    if (relevant.length === 0) return "";

    const parts: string[] = [];
    for (const mem of relevant) {
      const typeLabel = getTypeLabel(mem.type);
      parts.push(`[${typeLabel}] ${mem.content}`);
    }
    return parts.join("\n");
  }

  /**
   * 按类型获取记忆。
   */
  getMemoriesByType(type: MemoryType): MemoryEntry[] {
    return this.memories.filter(m => m.type === type);
  }

  /**
   * 移除指定 ID 的记忆。
   */
  removeMemory(id: string): boolean {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) return false;
    this.memories.splice(index, 1);
    return true;
  }

  /**
   * 清空所有记忆。
   */
  clear(): void {
    this.memories = [];
  }

  /**
   * 从序列化数据加载记忆。
   */
  loadFromEntries(entries: MemoryEntry[]): void {
    this.memories = [...entries];
  }

  /**
   * 导出所有记忆供持久化。
   */
  exportEntries(): MemoryEntry[] {
    return [...this.memories];
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 记忆类型的中文标签 */
function getTypeLabel(type: MemoryType): string {
  const labels: Record<MemoryType, string> = {
    "rolling-summary": "滚动摘要",
    "working-memory": "工作记忆",
    "project-fact": "项目事实",
    "user-preference": "用户偏好",
    "tool-discovery": "工具发现",
    "checkpoint": "检查点",
    "pinned-context": "固定上下文",
  };
  return labels[type] ?? type;
}
