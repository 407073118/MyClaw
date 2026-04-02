/**
 * 记忆提取器 — 从对话消息中提取记忆候选项。
 */

import type { ChatMessage } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType =
  | "rolling-summary"
  | "working-memory"
  | "project-fact"
  | "user-preference"
  | "tool-discovery"
  | "checkpoint"
  | "pinned-context";

export type MemoryEntry = {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  createdAt: string;
  sessionId: string;
  pinned?: boolean;
  tags?: string[];
};

// ---------------------------------------------------------------------------
// 提取逻辑
// ---------------------------------------------------------------------------

/**
 * 从消息列表中提取记忆候选项。
 * 分析助手和用户消息，识别可能有长期价值的信息。
 */
export function extractMemoryCandidates(
  messages: ChatMessage[],
  sessionId: string,
): MemoryEntry[] {
  if (messages.length === 0) return [];

  const candidates: MemoryEntry[] = [];
  const now = new Date().toISOString();

  for (const msg of messages) {
    if (msg.role === "assistant") {
      // 从助手消息中提取项目事实
      const facts = extractProjectFacts(msg.content);
      for (const fact of facts) {
        candidates.push({
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: "project-fact",
          content: fact,
          importance: 0.6,
          createdAt: now,
          sessionId,
        });
      }
    }

    if (msg.role === "user") {
      // 从用户消息中提取偏好
      const prefs = extractUserPreferences(msg.content);
      for (const pref of prefs) {
        candidates.push({
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: "user-preference",
          content: pref,
          importance: 0.7,
          createdAt: now,
          sessionId,
        });
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// 内部提取函数
// ---------------------------------------------------------------------------

/** 从助手回复中提取项目事实（技术栈、架构、关键文件等） */
function extractProjectFacts(content: string): string[] {
  const facts: string[] = [];
  if (!content || content.length < 20) return facts;

  // 匹配技术栈描述
  const techPatterns = [
    /(?:使用|uses?|built with|based on)\s+(.{10,80})/gi,
    /(?:框架|framework|library|工具)\s*[:：]\s*(.{5,60})/gi,
    /(?:主要|main|entry|入口)\s*(?:文件|file|module)\s*[:：]?\s*(.{5,60})/gi,
  ];

  for (const pattern of techPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches.slice(0, 2)) {
        facts.push(match.trim());
      }
    }
  }

  // 如果没有匹配到特定模式但内容足够有信息量，提取摘要
  if (facts.length === 0 && content.length > 50) {
    const firstSentence = content.split(/[.。!！\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 15 && firstSentence.length < 200) {
      facts.push(firstSentence);
    }
  }

  return facts;
}

/** 从用户消息中提取偏好（请求的约束或习惯） */
function extractUserPreferences(content: string): string[] {
  const prefs: string[] = [];
  if (!content || content.length < 10) return prefs;

  const prefPatterns = [
    /(?:请|please|always|总是|每次)\s+(.{5,80})/gi,
    /(?:不要|don't|never|禁止|避免)\s+(.{5,80})/gi,
    /(?:prefer|偏好|习惯|喜欢)\s+(.{5,60})/gi,
  ];

  for (const pattern of prefPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches.slice(0, 1)) {
        prefs.push(match.trim());
      }
    }
  }

  return prefs;
}
