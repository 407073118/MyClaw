/**
 * 上下文检查点服务 — 在严重压缩时创建结构化快照，保留关键语义信息。
 */

import { createHash, randomUUID } from "node:crypto";

import type { ChatSession, ChatMessage, ContextCheckpoint } from "@shared/contracts";
import { textOfContent } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type CreateCheckpointOptions = {
  /** 当前轮次 ID，未传入时生成稳定随机 ID。 */
  turnId?: string;
  /** 限定进入 checkpoint 的消息 ID，未传入时使用全量会话消息。 */
  sourceMessageIds?: string[];
};

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

/**
 * 从会话消息中创建结构化检查点。
 * 通过分析消息内容提取目标、约束、文件、工具结果和下一步目标。
 */
export function createCheckpoint(session: ChatSession, options: CreateCheckpointOptions = {}): ContextCheckpoint {
  const messages = session.messages;
  const now = new Date().toISOString();
  const sourceMessageIds = options.sourceMessageIds ?? messages.map((message) => message.id);

  if (messages.length === 0) {
    const emptyCheckpoint: ContextCheckpoint = {
      id: randomUUID(),
      sessionId: session.id,
      turnId: options.turnId ?? randomUUID(),
      createdAt: now,
      taskGoal: "",
      currentPhase: "empty",
      completedActions: [],
      activeAssumptions: [],
      decisions: [],
      touchedFiles: [],
      toolOutcomes: [],
      openItems: [],
      blockers: [],
      nextGoal: "",
      sourceMessageIds,
      checksum: buildCheckpointChecksum(session.id, sourceMessageIds, []),
      summary: "空会话，无历史消息。",
      recentTurnCount: 0,
      goals: [],
      constraints: [],
    };
    console.info("[context-checkpoint] 已创建空会话检查点", {
      sessionId: session.id,
      checkpointId: emptyCheckpoint.id,
    });
    return {
      ...emptyCheckpoint,
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
    const preview = textOfContent(lastUserMsg.content).slice(0, 200);
    summaryParts.push(`最近用户意图: ${preview}`);
  }

  // 简单的目标和约束提取（基于关键词匹配）
  const goals = extractGoals(userMessages);
  const constraints = extractConstraints(messages);
  const openItems = extractOpenItems(messages);
  const touchedFiles = extractTouchedFiles(messages);
  const toolOutcomes = extractToolOutcomes(messages);
  const decisions = extractDecisions(messages);
  const completedActions = extractCompletedActions(assistantMessages);
  const blockers = extractBlockers(messages);
  const taskGoal = goals[0] ?? textOfContent(userMessages[userMessages.length - 1]?.content ?? "").slice(0, 160);
  const nextGoal = openItems[0] ?? textOfContent(userMessages[userMessages.length - 1]?.content ?? "").slice(0, 160);
  const currentPhase = inferCurrentPhase(messages);
  const summary = summaryParts.join("。");
  const checkpoint: ContextCheckpoint = {
    id: randomUUID(),
    sessionId: session.id,
    turnId: options.turnId ?? randomUUID(),
    createdAt: now,
    taskGoal,
    currentPhase,
    completedActions,
    activeAssumptions: constraints,
    decisions,
    touchedFiles,
    toolOutcomes,
    openItems,
    blockers,
    nextGoal,
    sourceMessageIds,
    checksum: buildCheckpointChecksum(session.id, sourceMessageIds, messages),
    summary,
    recentTurnCount: Math.min(messages.length, 20),
    goals,
    constraints,
  };

  console.info("[context-checkpoint] 已创建结构化上下文检查点", {
    sessionId: session.id,
    checkpointId: checkpoint.id,
    turnId: checkpoint.turnId,
    sourceMessageCount: sourceMessageIds.length,
    touchedFileCount: touchedFiles.length,
    toolOutcomeCount: toolOutcomes.length,
  });
  return checkpoint;
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
      const matches = textOfContent(msg.content).match(pattern);
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
      const matches = textOfContent(msg.content).match(pattern);
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
      const matches = textOfContent(msg.content).match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 1)) {
          items.push(match.trim());
        }
      }
    }
  }

  return items.slice(0, 5);
}

/** 从消息中提取可能被触达的文件路径。 */
function extractTouchedFiles(messages: ChatMessage[]): string[] {
  const files = new Set<string>();
  const filePattern = /(?:[A-Za-z]:[\\/][^\s"'`<>]+|(?:desktop|src|tests|shared|docs)[\\/][^\s"'`<>]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|sql)\b)/g;
  for (const msg of messages.slice(-30)) {
    const matches = textOfContent(msg.content).match(filePattern);
    if (!matches) continue;
    for (const match of matches) {
      files.add(match.replace(/[),.;:]+$/g, ""));
    }
  }
  return [...files].slice(0, 20);
}

/** 从工具消息中提取工具结果摘要，并尽量关联前置 tool_call 名称。 */
function extractToolOutcomes(messages: ChatMessage[]): ContextCheckpoint["toolOutcomes"] {
  const outcomes: ContextCheckpoint["toolOutcomes"] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool") continue;
    let tool = "unknown";
    if (message.tool_call_id) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        const call = prev.tool_calls?.find((item) => item.id === message.tool_call_id);
        if (call) {
          tool = call.function.name;
          break;
        }
      }
    }
    const summary = textOfContent(message.content).replace(/\s+/g, " ").slice(0, 180);
    outcomes.push({
      tool,
      summary,
      sourceMessageIds: [message.id],
    });
  }
  return outcomes.slice(-12);
}

/** 从消息中提取明确决策，保留给后续轮次恢复上下文。 */
function extractDecisions(messages: ChatMessage[]): string[] {
  const decisions: string[] = [];
  const patterns = [/(?:决定|采用|选择|路线|方案).{3,80}/g, /(?:decide|choose|adopt|route|plan)\s.{3,80}/gi];
  for (const msg of messages.slice(-20)) {
    for (const pattern of patterns) {
      const matches = textOfContent(msg.content).match(pattern);
      if (matches) decisions.push(...matches.map((item) => item.trim()).slice(0, 2));
    }
  }
  return [...new Set(decisions)].slice(0, 8);
}

/** 从助手消息中提取已完成动作的短摘要。 */
function extractCompletedActions(assistantMessages: ChatMessage[]): string[] {
  return assistantMessages
    .slice(-8)
    .map((message) => textOfContent(message.content).replace(/\s+/g, " ").slice(0, 120))
    .filter(Boolean)
    .slice(0, 8);
}

/** 从消息中提取阻塞点和失败信息。 */
function extractBlockers(messages: ChatMessage[]): string[] {
  const blockers: string[] = [];
  const patterns = [/(?:失败|报错|阻塞|无法|不能).{3,80}/g, /(?:failed|error|blocked|cannot|unable)\s.{3,80}/gi];
  for (const msg of messages.slice(-20)) {
    for (const pattern of patterns) {
      const matches = textOfContent(msg.content).match(pattern);
      if (matches) blockers.push(...matches.map((item) => item.trim()).slice(0, 1));
    }
  }
  return [...new Set(blockers)].slice(0, 6);
}

/** 推断当前上下文所处阶段，供 checkpoint 注入时快速定位。 */
function inferCurrentPhase(messages: ChatMessage[]): string {
  const text = messages.slice(-8).map((message) => textOfContent(message.content)).join("\n").toLowerCase();
  if (/test|测试|vitest|failing|失败/.test(text)) return "testing";
  if (/implement|实现|修改|patch|代码/.test(text)) return "implementation";
  if (/plan|方案|设计|规划/.test(text)) return "planning";
  return "conversation";
}

/** 为 checkpoint 生成内容校验和，避免后续持久化时无法追溯来源。 */
function buildCheckpointChecksum(sessionId: string, sourceMessageIds: string[], messages: ChatMessage[]): string {
  const payload = JSON.stringify({
    sessionId,
    sourceMessageIds,
    messageDigests: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: textOfContent(message.content).slice(0, 500),
    })),
  });
  return createHash("sha256").update(payload).digest("hex");
}
