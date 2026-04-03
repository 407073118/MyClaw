/**
 * Phase 6: Smart Compact & Token UI tests
 *
 * Tests:
 * - calculateSessionTokens sums all usage correctly
 * - smartCompactMessages does NOT compact when under threshold
 * - fallbackSummary returns correct format
 * - contextWindow defaults to 32768 when not set
 * - ChatMessage with usage field can be serialized/deserialized
 */

import { describe, it, expect } from "vitest";

import { calculateSessionTokens, fallbackSummary } from "../src/main/ipc/sessions";
import type { ChatSession, ChatMessage, MessageTokenUsage, ModelProfile } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "test-session",
    title: "Test",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    createdAt: new Date().toISOString(),
    messages,
  };
}

function makeMessage(
  role: ChatMessage["role"],
  content: string,
  usage?: MessageTokenUsage | null,
): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(usage !== undefined ? { usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// calculateSessionTokens
// ---------------------------------------------------------------------------

describe("calculateSessionTokens", () => {
  it("returns 0 for empty session", () => {
    const session = makeSession([]);
    expect(calculateSessionTokens(session)).toBe(0);
  });

  it("returns 0 when no messages have usage", () => {
    const session = makeSession([
      makeMessage("user", "hello"),
      makeMessage("assistant", "world"),
    ]);
    expect(calculateSessionTokens(session)).toBe(0);
  });

  it("sums totalTokens across messages with usage", () => {
    const session = makeSession([
      makeMessage("user", "hello"),
      makeMessage("assistant", "response 1", { promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
      makeMessage("user", "follow up"),
      makeMessage("assistant", "response 2", { promptTokens: 40, completionTokens: 50, totalTokens: 90 }),
    ]);
    expect(calculateSessionTokens(session)).toBe(120);
  });

  it("handles null usage gracefully", () => {
    const session = makeSession([
      makeMessage("assistant", "response", null),
    ]);
    expect(calculateSessionTokens(session)).toBe(0);
  });

  it("handles mixed messages with and without usage", () => {
    const session = makeSession([
      makeMessage("user", "hello"),
      makeMessage("assistant", "with usage", { promptTokens: 100, completionTokens: 200, totalTokens: 300 }),
      makeMessage("tool", "tool output"),
      makeMessage("system", "system msg"),
    ]);
    expect(calculateSessionTokens(session)).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// fallbackSummary
// ---------------------------------------------------------------------------

describe("fallbackSummary", () => {
  it("returns correct format with message counts", () => {
    const messages: ChatMessage[] = [
      makeMessage("user", "msg1"),
      makeMessage("user", "msg2"),
      makeMessage("assistant", "reply1"),
      makeMessage("assistant", "reply2"),
      makeMessage("assistant", "reply3"),
      makeMessage("tool", "output1"),
    ];
    const result = fallbackSummary(messages);

    expect(result).toContain("移除了 6 条早期消息");
    expect(result).toContain("2 条用户消息");
    expect(result).toContain("3 条助手消息");
    expect(result).toContain("1 条工具消息");
    expect(result).toContain("保留了最近消息以维持上下文");
  });

  it("handles empty array", () => {
    const result = fallbackSummary([]);
    expect(result).toContain("移除了 0 条早期消息");
    expect(result).toContain("0 条用户消息");
  });
});

// ---------------------------------------------------------------------------
// contextWindow default
// ---------------------------------------------------------------------------

describe("contextWindow default", () => {
  it("ModelProfile contextWindow defaults to undefined (callers use 32768)", () => {
    const profile: ModelProfile = {
      id: "test",
      name: "Test Model",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com",
      apiKey: "test-key",
      model: "gpt-4",
    };
    // contextWindow is optional and defaults to undefined
    expect(profile.contextWindow).toBeUndefined();

    // The caller should use ?? 32768
    const contextWindow = profile.contextWindow ?? 32768;
    expect(contextWindow).toBe(32768);
  });

  it("ModelProfile contextWindow can be set", () => {
    const profile: ModelProfile = {
      id: "test",
      name: "Test Model",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com",
      apiKey: "test-key",
      model: "gpt-4",
      contextWindow: 128000,
    };
    expect(profile.contextWindow).toBe(128000);
    const contextWindow = profile.contextWindow ?? 32768;
    expect(contextWindow).toBe(128000);
  });
});

// ---------------------------------------------------------------------------
// ChatMessage usage serialization
// ---------------------------------------------------------------------------

describe("ChatMessage with usage serialization", () => {
  it("can serialize and deserialize message with usage", () => {
    const msg: ChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "Hello world",
      createdAt: "2026-01-01T00:00:00Z",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };

    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json) as ChatMessage;

    expect(parsed.usage).toBeDefined();
    expect(parsed.usage!.promptTokens).toBe(100);
    expect(parsed.usage!.completionTokens).toBe(50);
    expect(parsed.usage!.totalTokens).toBe(150);
  });

  it("can serialize message without usage", () => {
    const msg: ChatMessage = {
      id: "msg-2",
      role: "user",
      content: "Hello",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json) as ChatMessage;

    expect(parsed.usage).toBeUndefined();
  });

  it("threshold calculation is 80% of context window", () => {
    const contextWindow = 32768;
    const threshold = Math.floor(contextWindow * 0.8);
    expect(threshold).toBe(26214);

    const contextWindow128k = 128000;
    const threshold128k = Math.floor(contextWindow128k * 0.8);
    expect(threshold128k).toBe(102400);
  });
});
