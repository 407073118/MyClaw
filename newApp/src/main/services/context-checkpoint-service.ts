/**
 * 上下文检查点服务 — 在严重压缩时创建结构化快照，保留关键语义信息。
 */

import type { ChatSession, ChatMessage } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextCheckpoint = {
  /** 关联的会话 ID */
  sessionId: string;
  /** 创建时间 */
  createdAt: string;
  /** 对话摘要 */
  summary: string;
  /** 快照时保留的近期轮次数 */
  recentTurnCount: number;
  /** 已识别的任务目标 */
  goals: string[];
  /** 已确认的约束条件 */
  constraints: string[];
  /** 待处理事项 */
  openItems: string[];
};

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

/**
 * 从会话消息中创建检查点。
 * 通过分析消息内容提取目标、约束和待处理事项。
 */
export function createCheckpoint(session: ChatSession): ContextCheckpoint {
  const messages = session.messages;
  const now = new Date().toISOString();

  if (messages.length === 0) {
    return {
      sessionId: session.id,
      createdAt: now,
      summary: "空会话，无历史消息。",
      recentTurnCount: 0,
      goals: [],
      constraints: [],
      openItems: [],
    };
  }

  // 提取用户和助手消息用于摘要
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");

  // 构建基础摘要
  const summaryParts: string[] = [];
  summaryParts.push(`会话包含 ${messages.length} 条消息`);
  summaryParts.push(`（${userMessages.length} 条用户消息, ${assistantMessages.length} 条助手消息）`);

  // 提取最近的用户意图
  if (userMessages.length > 0) {
    const lastUserMsg = userMessages[userMessages.length - 1];
    const preview = lastUserMsg.content.slice(0, 200);
    summaryParts.push(`最近用户意图: ${preview}`);
  }

  // 简单的目标和约束提取（基于关键词匹配）
  const goals = extractGoals(userMessages);
  const constraints = extractConstraints(messages);
  const openItems = extractOpenItems(messages);

  return {
    sessionId: session.id,
    createdAt: now,
    summary: summaryParts.join("。"),
    recentTurnCount: Math.min(messages.length, 20),
    goals,
    constraints,
    openItems,
  };
}

// ---------------------------------------------------------------------------
// 信息提取辅助函数
// ---------------------------------------------------------------------------

/** 从用户消息中提取可能的任务目标 */
function extractGoals(userMessages: ChatMessage[]): string[] {
  const goals: string[] = [];
  const goalPatterns = [/(?:请|帮我|需要|要|想).{5,50}/g, /(?:implement|add|create|fix|build|make)\s.{5,50}/gi];

  for (const msg of userMessages.slice(-5)) {
    for (const pattern of goalPatterns) {
      const matches = msg.content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 2)) {
          goals.push(match.trim());
        }
      }
    }
  }

  return goals.slice(0, 5);
}

/** 从消息中提取约束条件 */
function extractConstraints(messages: ChatMessage[]): string[] {
  const constraints: string[] = [];
  const constraintPatterns = [/(?:不要|不能|禁止|避免|必须).{3,40}/g, /(?:don't|must not|never|always|should not)\s.{3,40}/gi];

  for (const msg of messages.slice(-10)) {
    for (const pattern of constraintPatterns) {
      const matches = msg.content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 1)) {
          constraints.push(match.trim());
        }
      }
    }
  }

  return constraints.slice(0, 5);
}

/** 从消息中提取待处理事项 */
function extractOpenItems(messages: ChatMessage[]): string[] {
  const items: string[] = [];
  const itemPatterns = [/(?:TODO|待处理|还需要|接下来).{3,50}/gi];

  for (const msg of messages.slice(-5)) {
    for (const pattern of itemPatterns) {
      const matches = msg.content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 1)) {
          items.push(match.trim());
        }
      }
    }
  }

  return items.slice(0, 5);
}
