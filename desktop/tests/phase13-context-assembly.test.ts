/**
 * Phase 13: Context Assembly & Compaction Pipeline tests
 *
 * 测试内容：
 * - ContextAssembler builds correct message structure
 * - Recent-turn retention respects minRecentTurnsToKeep
 * - ToolOutputSanitizer trims oversized tool output
 * - ContextCompactor follows multi-stage compaction order
 * - ContextCheckpointService creates valid checkpoints
 * - Integration: assembler + compactor produces within-budget output
 */

import { describe, it, expect } from "vitest";

import {
  sanitizeToolOutput,
  DEFAULT_MAX_TOOL_OUTPUT_TOKENS,
} from "../src/main/services/tool-output-sanitizer";

import {
  assembleContext,
  type AssembledContext,
} from "../src/main/services/context-assembler";

import {
  compactMessages,
  type CompactionResult,
} from "../src/main/services/context-compactor";

import {
  createCheckpoint,
  type ContextCheckpoint,
} from "../src/main/services/context-checkpoint-service";

import type {
  ChatSession,
  ChatMessage,
  ModelCapability,
  ContextBudgetPolicy,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

function makeMessage(
  role: ChatMessage["role"],
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function makeSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "test-session",
    title: "Test",
    modelProfileId: "profile-1",
    attachedDirectory: "/test/project",
    createdAt: new Date().toISOString(),
    messages,
  };
}

const defaultCapability: ModelCapability = {
  contextWindowTokens: 32768,
  maxInputTokens: 28672,
  maxOutputTokens: 4096,
  supportsTools: true,
  supportsStreaming: true,
  tokenCountingMode: "character-fallback",
  source: "registry",
};

// ---------------------------------------------------------------------------
// Tool Output Sanitizer
// ---------------------------------------------------------------------------

describe("sanitizeToolOutput", () => {
  it("passes through short output unchanged", () => {
    const output = "File contents here";
    expect(sanitizeToolOutput(output)).toBe(output);
  });

  it("trims oversized output and adds truncation notice", () => {
    // 生成一个超大的输出
    const bigOutput = "x".repeat(DEFAULT_MAX_TOOL_OUTPUT_TOKENS * 5);
    const result = sanitizeToolOutput(bigOutput);
    expect(result.length).toBeLessThan(bigOutput.length);
    expect(result).toContain("[输出已截断]");
  });

  it("respects custom maxTokens parameter", () => {
    const output = "x".repeat(500);
    const result = sanitizeToolOutput(output, 100);
    expect(result.length).toBeLessThan(output.length);
    expect(result).toContain("[输出已截断]");
  });

  it("handles empty output", () => {
    expect(sanitizeToolOutput("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Context Assembler
// ---------------------------------------------------------------------------

describe("assembleContext", () => {
  it("produces system + recent turns in correct order", () => {
    const messages = [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi there!"),
      makeMessage("user", "How are you?"),
    ];
    const session = makeSession(messages);
    const result = assembleContext({
      session,
      capability: defaultCapability,
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
      workingDir: "/test/project",
    });

    // 第一条应该是 system prompt
    expect(result.messages[0].role).toBe("system");
    // 后续是会话消息
    expect(result.messages.length).toBeGreaterThan(1);
    expect(result.budgetUsed).toBeGreaterThan(0);
  });

  it("retains all messages when within budget", () => {
    const messages = [
      makeMessage("user", "Short message"),
      makeMessage("assistant", "Short reply"),
    ];
    const session = makeSession(messages);
    const result = assembleContext({
      session,
      capability: defaultCapability,
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
      workingDir: "/test/project",
    });

    // system + 2 messages
    expect(result.messages.length).toBe(3);
    expect(result.wasCompacted).toBe(false);
  });

  it("respects minRecentTurnsToKeep", () => {
    // 创建很多消息
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(makeMessage("user", `Question ${i}: ${"x".repeat(200)}`));
      messages.push(makeMessage("assistant", `Answer ${i}: ${"y".repeat(200)}`));
    }
    const session = makeSession(messages);

    const policy: ContextBudgetPolicy = {
      ...DEFAULT_CONTEXT_BUDGET_POLICY,
      minRecentTurnsToKeep: 6,
    };

    const result = assembleContext({
      session,
      capability: { ...defaultCapability, contextWindowTokens: 4096, maxInputTokens: 3072 },
      policy,
      workingDir: "/test/project",
    });

    // 应该至少保留 minRecentTurnsToKeep 条近期消息
    // 减去 system 后 >= 6
    const nonSystemMessages = result.messages.filter(m => m.role !== "system");
    expect(nonSystemMessages.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Context Compactor
// ---------------------------------------------------------------------------

describe("compactMessages", () => {
  it("returns uncompacted when within budget", () => {
    const messages = [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi"),
    ];
    const result = compactMessages({
      messages,
      budgetTokens: 10000,
      capability: defaultCapability,
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
    });

    expect(result.compacted).toEqual(messages);
    expect(result.removedCount).toBe(0);
    expect(result.reason).toBeNull();
  });

  it("trims tool output first", () => {
    const bigToolOutput = "x".repeat(50000);
    const messages = [
      makeMessage("user", "Read this file"),
      makeMessage("assistant", "", {
        tool_calls: [{ id: "tc1", type: "function", function: { name: "fs_read", arguments: "{}" } }],
      }),
      makeMessage("tool", bigToolOutput, { tool_call_id: "tc1" }),
      makeMessage("assistant", "Got it"),
    ];

    const result = compactMessages({
      messages,
      budgetTokens: 5000,
      capability: defaultCapability,
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
    });

    // 工具输出应该被截断
    const toolMsg = result.compacted.find(m => m.role === "tool");
    expect(toolMsg!.content.length).toBeLessThan(bigToolOutput.length);
  });

  it("removes stale messages when still over budget after tool trim", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 40; i++) {
      messages.push(makeMessage("user", `Message ${i}: ${"content".repeat(100)}`));
      messages.push(makeMessage("assistant", `Reply ${i}: ${"response".repeat(100)}`));
    }

    const result = compactMessages({
      messages,
      budgetTokens: 2000,
      capability: defaultCapability,
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, minRecentTurnsToKeep: 4 },
    });

    expect(result.removedCount).toBeGreaterThan(0);
    expect(result.compacted.length).toBeLessThan(messages.length);
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Context Checkpoint Service
// ---------------------------------------------------------------------------

describe("createCheckpoint", () => {
  it("creates a checkpoint from session messages", () => {
    const messages = [
      makeMessage("user", "Let's work on the auth module"),
      makeMessage("assistant", "Sure, I'll start by reading the auth files."),
      makeMessage("user", "Focus on the login flow"),
      makeMessage("assistant", "The login flow uses JWT tokens. Key file: auth.ts"),
    ];
    const session = makeSession(messages);
    const checkpoint = createCheckpoint(session);

    expect(checkpoint.sessionId).toBe(session.id);
    expect(checkpoint.createdAt).toBeTruthy();
    expect(checkpoint.summary).toBeTruthy();
    expect(checkpoint.recentTurnCount).toBeGreaterThan(0);
  });

  it("handles empty session", () => {
    const session = makeSession([]);
    const checkpoint = createCheckpoint(session);
    expect(checkpoint.sessionId).toBe(session.id);
    expect(checkpoint.summary).toBeTruthy();
  });
});
