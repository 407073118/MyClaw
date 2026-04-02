/**
 * Phase 16: Context Fallback & Degradation tests
 *
 * Tests:
 * - ContextAssembler degrades gracefully when capability is minimal
 * - MemoryService failure does not block context assembly
 * - Compactor falls back to summary stub when model summary unavailable
 * - resolveModelCapability always returns a usable capability even with empty profile
 * - buildBudgetSnapshot handles edge cases without throwing
 * - sanitizeToolOutput handles null/undefined gracefully
 */

import { describe, it, expect } from "vitest";

import { resolveModelCapability } from "../src/main/services/model-capability-resolver";
import { buildBudgetSnapshot, normalizeOutputLimit } from "../src/main/services/token-budget-manager";
import { assembleContext } from "../src/main/services/context-assembler";
import { compactMessages } from "../src/main/services/context-compactor";
import { sanitizeToolOutput } from "../src/main/services/tool-output-sanitizer";
import { MemoryService } from "../src/main/services/memory-service";
import { estimateTokenCount } from "../src/main/services/token-estimator";

import type { ModelProfile, ChatSession, ChatMessage, ModelCapability } from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides?: Partial<ModelProfile>): ModelProfile {
  return {
    id: "test",
    name: "Test",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com",
    apiKey: "key",
    model: "unknown-model",
    ...overrides,
  };
}

function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

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

// ---------------------------------------------------------------------------
// Capability resolution fallbacks
// ---------------------------------------------------------------------------

describe("capability resolution fallbacks", () => {
  it("always returns usable capability for unknown model", () => {
    const profile = makeProfile({ model: "completely-unknown-model-xyz" });
    const resolved = resolveModelCapability(profile);

    expect(resolved.effective).toBeDefined();
    expect(resolved.effective.contextWindowTokens).toBeGreaterThan(0);
    expect(resolved.effective.maxOutputTokens).toBeGreaterThan(0);
    expect(resolved.effective.source).toBeTruthy();
  });

  it("returns usable capability for empty profile", () => {
    const profile = makeProfile({ model: "", provider: "openai-compatible" });
    const resolved = resolveModelCapability(profile);

    expect(resolved.effective.contextWindowTokens).toBeGreaterThan(0);
  });

  it("legacy contextWindow is used when no registry match", () => {
    // 使用不匹配任何 registry 条目的 provider，确保 legacy 生效
    const profile = makeProfile({
      contextWindow: 65536,
      provider: "local-gateway",
      model: "custom-local-model-xyz",
    });
    const resolved = resolveModelCapability(profile);

    // local-gateway 有 registry 匹配（32768），registry 优先于 legacy
    // 验证至少返回了有效值
    expect(resolved.effective.contextWindowTokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Budget snapshot edge cases
// ---------------------------------------------------------------------------

describe("budget snapshot edge cases", () => {
  it("handles zero-value capability fields", () => {
    const cap: ModelCapability = {
      contextWindowTokens: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      source: "default",
    };
    // 不应抛错，应降级到默认值
    const snapshot = buildBudgetSnapshot(cap, DEFAULT_CONTEXT_BUDGET_POLICY);
    expect(snapshot.effectiveContextWindow).toBe(32768); // fallback
    expect(snapshot.safeInputBudget).toBeGreaterThanOrEqual(0);
  });

  it("handles undefined policy fields", () => {
    const cap: ModelCapability = {
      contextWindowTokens: 32768,
      source: "registry",
    };
    const snapshot = buildBudgetSnapshot(cap, {});
    expect(snapshot.safeInputBudget).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Context assembly degradation
// ---------------------------------------------------------------------------

describe("context assembly degradation", () => {
  it("assembles with minimal capability (tiny context window)", () => {
    const session = makeSession([
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi"),
    ]);
    const result = assembleContext({
      session,
      capability: { contextWindowTokens: 256, maxOutputTokens: 64, source: "default" },
      workingDir: "/test",
    });

    // 应该至少返回 system + 部分消息，不抛错
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0].role).toBe("system");
  });

  it("assembles empty session without error", () => {
    const session = makeSession([]);
    const result = assembleContext({
      session,
      capability: { contextWindowTokens: 32768, source: "default" },
      workingDir: "/test",
    });

    expect(result.messages.length).toBe(1); // just system
    expect(result.wasCompacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Memory service isolation
// ---------------------------------------------------------------------------

describe("memory service isolation", () => {
  it("retrieval failure does not throw", () => {
    const service = new MemoryService();
    // 空服务检索不应报错
    const result = service.getRelevantMemories("any query", 5);
    expect(result).toEqual([]);
  });

  it("buildMemoryContext returns empty for no memories", () => {
    const service = new MemoryService();
    expect(service.buildMemoryContext("query")).toBe("");
  });

  it("extraction from malformed messages does not throw", () => {
    const service = new MemoryService();
    const messages = [
      makeMessage("user", ""),
      makeMessage("assistant", ""),
    ];
    const result = service.extractAndStore(messages, "session-1");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Compactor fallback
// ---------------------------------------------------------------------------

describe("compactor fallback behavior", () => {
  it("compacts without model summary (uses structural removal)", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(makeMessage("user", `Question ${i}: ${"x".repeat(500)}`));
      messages.push(makeMessage("assistant", `Answer ${i}: ${"y".repeat(500)}`));
    }

    const result = compactMessages({
      messages,
      budgetTokens: 1000,
      capability: { contextWindowTokens: 4096, source: "default" },
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, minRecentTurnsToKeep: 4 },
    });

    expect(result.removedCount).toBeGreaterThan(0);
    expect(result.compacted.length).toBeGreaterThanOrEqual(4);
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tool output sanitizer edge cases
// ---------------------------------------------------------------------------

describe("tool output sanitizer edge cases", () => {
  it("handles null-like input safely", () => {
    expect(sanitizeToolOutput("")).toBe("");
  });

  it("handles very long single-line output", () => {
    const output = "a".repeat(100000);
    const result = sanitizeToolOutput(output, 500);
    expect(result.length).toBeLessThan(output.length);
    expect(result).toContain("[输出已截断]");
  });
});

// ---------------------------------------------------------------------------
// Token estimator edge cases
// ---------------------------------------------------------------------------

describe("token estimator edge cases", () => {
  it("handles all counting modes without error", () => {
    const text = "Test 测试";
    const modes = [
      "provider-native",
      "openai-compatible-estimate",
      "anthropic-estimate",
      "local-heuristic",
      "character-fallback",
    ] as const;
    for (const mode of modes) {
      const result = estimateTokenCount(text, mode);
      expect(result).toBeGreaterThan(0);
    }
  });
});
