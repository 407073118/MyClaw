/**
 * 本地上下文记忆索引 — v1 使用会话内消息做轻量 BM25 风格召回。
 *
 * 该服务不修改原始会话，只为 Context Compiler 提供可解释的短记忆片段。
 */

import type { ChatSession } from "@shared/contracts";
import { textOfContent } from "@shared/contracts";
import { estimateTokenCount } from "./token-estimator";

export type ContextMemoryRecord = {
  id: string;
  sessionId: string;
  messageId: string;
  score: number;
  text: string;
  createdAt: string;
};

export type RetrieveContextMemoriesInput = {
  session: ChatSession;
  query: string;
  excludeMessageIds?: string[];
  limit?: number;
  tokenBudget?: number;
};

/** 将查询拆成稳定词项，兼容中英文和路径片段。 */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_./\\:-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 32);
}

/** 计算单条消息对查询的轻量相关性分数。 */
function scoreText(text: string, queryTokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    const occurrences = lower.split(token).length - 1;
    if (occurrences > 0) {
      score += 1 + Math.log2(occurrences + 1);
    }
  }
  if (/[A-Za-z]:[\\/]|(?:src|desktop|tests|shared)[\\/]/.test(text)) {
    score += 0.5;
  }
  if (/error|failed|失败|报错|决定|方案|next|todo/i.test(text)) {
    score += 0.5;
  }
  return score;
}

/**
 * 从当前 session 里召回短记忆片段。
 * v1 不引入外部向量库，后续可以把这里替换为 SQLite FTS 或图记忆 adapter。
 */
export function retrieveContextMemories(input: RetrieveContextMemoriesInput): ContextMemoryRecord[] {
  const limit = input.limit ?? 4;
  const tokenBudget = input.tokenBudget ?? 512;
  const exclude = new Set(input.excludeMessageIds ?? []);
  const queryTokens = tokenizeQuery(input.query);
  if (queryTokens.length === 0 || limit <= 0 || tokenBudget <= 0) {
    console.info("[context-memory-index] 跳过记忆召回：查询或预算为空", {
      sessionId: input.session.id,
      queryLength: input.query.length,
      tokenBudget,
    });
    return [];
  }

  const candidates = input.session.messages
    .filter((message) => !exclude.has(message.id))
    .map((message) => {
      const text = textOfContent(message.content).replace(/\s+/g, " ").trim();
      return {
        id: `memory-${message.id}`,
        sessionId: input.session.id,
        messageId: message.id,
        score: scoreText(text, queryTokens),
        text: text.slice(0, 500),
        createdAt: message.createdAt,
      } satisfies ContextMemoryRecord;
    })
    .filter((record) => record.text && record.score > 0)
    .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));

  const selected: ContextMemoryRecord[] = [];
  let usedTokens = 0;
  for (const candidate of candidates) {
    const nextTokens = estimateTokenCount(candidate.text, "character-fallback");
    if (usedTokens + nextTokens > tokenBudget) continue;
    selected.push(candidate);
    usedTokens += nextTokens;
    if (selected.length >= limit) break;
  }

  console.info("[context-memory-index] 已完成本地上下文记忆召回", {
    sessionId: input.session.id,
    candidateCount: candidates.length,
    selectedCount: selected.length,
    usedTokens,
  });
  return selected;
}
