/**
 * 第 14 阶段：记忆服务测试。
 *
 * 测试内容：
 * - `MemoryExtractor` 是否能从消息中提取记忆候选
 * - `MemoryRanker` 是否按相关性、时间和重要度排序
 * - `MemoryRetriever` 是否能按查询取回相关记忆
 * - `MemoryService` 是否完成提取、排序、检索的一体化整合
 * - 没有旧版记忆文件时是否仍保持向后兼容
 */

import { describe, it, expect } from "vitest";

import {
  extractMemoryCandidates,
  type MemoryEntry,
  type MemoryType,
} from "../src/main/services/memory-extractor";

import {
  rankMemories,
} from "../src/main/services/memory-ranker";

import {
  retrieveRelevantMemories,
} from "../src/main/services/memory-retriever";

import {
  MemoryService,
} from "../src/main/services/memory-service";

import type { ChatMessage } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

function makeMessage(
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function makeMemory(
  type: MemoryType,
  content: string,
  importance: number = 0.5,
  createdAt?: string,
): MemoryEntry {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    type,
    content,
    importance,
    createdAt: createdAt ?? new Date().toISOString(),
    sessionId: "test-session",
  };
}

// ---------------------------------------------------------------------------
// Memory Extractor
// ---------------------------------------------------------------------------

describe("extractMemoryCandidates", () => {
  it("extracts project facts from assistant messages", () => {
    const messages = [
      makeMessage("user", "What's the project structure?"),
      makeMessage("assistant", "The project uses TypeScript with Electron. The main entry is src/main/index.ts."),
    ];
    const candidates = extractMemoryCandidates(messages, "test-session");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some(c => c.type === "project-fact")).toBe(true);
  });

  it("extracts user preferences from user messages", () => {
    const messages = [
      makeMessage("user", "Please always use Chinese comments in the code."),
      makeMessage("assistant", "Got it, I'll use Chinese comments."),
    ];
    const candidates = extractMemoryCandidates(messages, "test-session");
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("returns empty array for empty messages", () => {
    const candidates = extractMemoryCandidates([], "test-session");
    expect(candidates).toEqual([]);
  });

  it("assigns sessionId to extracted memories", () => {
    const messages = [
      makeMessage("assistant", "The auth module uses JWT tokens for authentication."),
    ];
    const candidates = extractMemoryCandidates(messages, "my-session-id");
    for (const c of candidates) {
      expect(c.sessionId).toBe("my-session-id");
    }
  });
});

// ---------------------------------------------------------------------------
// Memory Ranker
// ---------------------------------------------------------------------------

describe("rankMemories", () => {
  it("ranks by importance", () => {
    const memories = [
      makeMemory("project-fact", "Low importance", 0.2),
      makeMemory("project-fact", "High importance", 0.9),
      makeMemory("project-fact", "Medium importance", 0.5),
    ];
    const ranked = rankMemories(memories, "some query");
    expect(ranked[0].importance).toBeGreaterThanOrEqual(ranked[1].importance);
  });

  it("boosts relevance for matching query", () => {
    const memories = [
      makeMemory("project-fact", "The auth module uses JWT"),
      makeMemory("project-fact", "The database uses PostgreSQL"),
    ];
    const ranked = rankMemories(memories, "auth JWT");
    // 与 `auth` 相关的记忆应该排得更靠前。
    expect(ranked[0].content).toContain("auth");
  });

  it("returns empty for empty input", () => {
    expect(rankMemories([], "query")).toEqual([]);
  });

  it("handles pinned memories", () => {
    const unpinned = makeMemory("project-fact", "Unpinned fact", 0.3);
    const pinned = { ...makeMemory("pinned-context", "Pinned important context", 0.3), pinned: true };
    const ranked = rankMemories([unpinned, pinned], "anything");
    // 置顶记忆应当无条件排在最前面。
    expect(ranked[0].pinned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Memory Retriever
// ---------------------------------------------------------------------------

describe("retrieveRelevantMemories", () => {
  it("retrieves top-N relevant memories", () => {
    const memories = Array.from({ length: 20 }, (_, i) =>
      makeMemory("project-fact", `Fact number ${i}`, i / 20)
    );
    const retrieved = retrieveRelevantMemories(memories, "some query", 5);
    expect(retrieved.length).toBe(5);
  });

  it("returns all when fewer than limit", () => {
    const memories = [
      makeMemory("project-fact", "Only fact"),
    ];
    const retrieved = retrieveRelevantMemories(memories, "query", 10);
    expect(retrieved.length).toBe(1);
  });

  it("returns empty for empty memory store", () => {
    expect(retrieveRelevantMemories([], "query", 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Memory Service 集成测试
// ---------------------------------------------------------------------------

describe("MemoryService", () => {
  it("creates with empty state", () => {
    const service = new MemoryService();
    expect(service.getAllMemories()).toEqual([]);
  });

  it("adds and retrieves memories", () => {
    const service = new MemoryService();
    const memory = makeMemory("project-fact", "Test fact about authentication");
    service.addMemory(memory);
    expect(service.getAllMemories().length).toBe(1);

    const relevant = service.getRelevantMemories("authentication", 5);
    expect(relevant.length).toBe(1);
    expect(relevant[0].content).toContain("authentication");
  });

  it("extracts and stores memories from conversation", () => {
    const service = new MemoryService();
    const messages = [
      makeMessage("user", "What framework does this project use?"),
      makeMessage("assistant", "This project uses React with TypeScript and Zustand for state management."),
    ];
    service.extractAndStore(messages, "session-1");
    expect(service.getAllMemories().length).toBeGreaterThan(0);
  });

  it("handles old sessions without memory (backward compatibility)", () => {
    const service = new MemoryService();
    // 没有任何记忆的情况下获取不应崩溃
    const relevant = service.getRelevantMemories("anything", 5);
    expect(relevant).toEqual([]);
  });

  it("builds memory context string for injection", () => {
    const service = new MemoryService();
    service.addMemory(makeMemory("project-fact", "Project uses React"));
    service.addMemory(makeMemory("user-preference", "User prefers Chinese comments"));

    const context = service.buildMemoryContext("React project", 3);
    expect(context).toContain("React");
  });

  it("returns empty context when no relevant memories", () => {
    const service = new MemoryService();
    const context = service.buildMemoryContext("query", 5);
    expect(context).toBe("");
  });
});
