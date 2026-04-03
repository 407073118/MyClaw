/**
 * Phase 12: Token Estimation & Budget Manager tests
 *
 * Tests:
 * - estimateTokenCount returns reasonable character-based estimates
 * - estimateMessagesTokens sums message token estimates
 * - buildBudgetSnapshot computes correct budget allocation
 * - budget respects requestBody max_tokens / max_completion_tokens overrides
 * - calibrateEstimate adjusts future estimates based on actual usage
 * - edge cases: zero capability, missing fields, very large messages
 */

import { describe, it, expect } from "vitest";

import { estimateTokenCount, estimateMessagesTokens } from "../src/main/services/token-estimator";
import {
  buildBudgetSnapshot,
  normalizeOutputLimit,
  type BudgetSnapshot,
} from "../src/main/services/token-budget-manager";

import type {
  ModelCapability,
  ContextBudgetPolicy,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Token Estimator
// ---------------------------------------------------------------------------

describe("estimateTokenCount", () => {
  it("estimates tokens for English text (~4 chars per token)", () => {
    const text = "Hello, world! This is a test message.";
    const estimate = estimateTokenCount(text, "character-fallback");
    // ~36 chars → ~9 tokens, allow reasonable range
    expect(estimate).toBeGreaterThan(5);
    expect(estimate).toBeLessThan(20);
  });

  it("estimates tokens for Chinese text (~1.5 chars per token)", () => {
    const text = "你好世界，这是一条测试消息。";
    const estimate = estimateTokenCount(text, "character-fallback");
    // ~14 Chinese chars → ~9 tokens, allow reasonable range
    expect(estimate).toBeGreaterThan(5);
    expect(estimate).toBeLessThan(20);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("", "character-fallback")).toBe(0);
  });

  it("handles openai-compatible-estimate mode", () => {
    const text = "Hello, world! This is a test message.";
    const estimate = estimateTokenCount(text, "openai-compatible-estimate");
    expect(estimate).toBeGreaterThan(0);
  });

  it("handles mixed content", () => {
    const text = "Hello 你好 World 世界";
    const estimate = estimateTokenCount(text, "character-fallback");
    expect(estimate).toBeGreaterThan(3);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums token estimates across messages", () => {
    const messages = [
      { role: "system" as const, content: "You are a helpful assistant." },
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];
    const total = estimateMessagesTokens(messages, "character-fallback");
    expect(total).toBeGreaterThan(10);
  });

  it("returns 0 for empty array", () => {
    expect(estimateMessagesTokens([], "character-fallback")).toBe(0);
  });

  it("accounts for role overhead per message", () => {
    const singleMsg = [{ role: "user" as const, content: "Hi" }];
    const estimate = estimateMessagesTokens(singleMsg, "character-fallback");
    // Should be more than just content tokens due to role/format overhead
    expect(estimate).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Budget Snapshot
// ---------------------------------------------------------------------------

describe("buildBudgetSnapshot", () => {
  const baseCapability: ModelCapability = {
    contextWindowTokens: 32768,
    maxInputTokens: 28672,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
    tokenCountingMode: "character-fallback",
    source: "registry",
  };

  it("computes correct budget with defaults", () => {
    const snapshot = buildBudgetSnapshot(baseCapability, DEFAULT_CONTEXT_BUDGET_POLICY);

    expect(snapshot.effectiveContextWindow).toBe(32768);
    expect(snapshot.effectiveMaxOutput).toBe(4096);
    expect(snapshot.effectiveMaxInput).toBe(28672);
    // safeInputBudget = maxInput - systemReserve - toolReserve - memoryReserve - outputReserve - safetyMargin
    // = 28672 - 2048 - 4096 - 4096 - 4096 - 1024 = 13312
    expect(snapshot.safeInputBudget).toBe(13312);
    expect(snapshot.compactTriggerTokens).toBeGreaterThan(0);
  });

  it("uses contextWindowTokens when maxInputTokens is missing", () => {
    const cap: ModelCapability = {
      contextWindowTokens: 128000,
      maxOutputTokens: 8192,
      source: "registry",
    };
    const snapshot = buildBudgetSnapshot(cap, DEFAULT_CONTEXT_BUDGET_POLICY);

    expect(snapshot.effectiveMaxInput).toBe(128000);
    expect(snapshot.effectiveMaxOutput).toBe(8192);
  });

  it("falls back to safe defaults when all fields missing", () => {
    const cap: ModelCapability = { source: "default" };
    const snapshot = buildBudgetSnapshot(cap, DEFAULT_CONTEXT_BUDGET_POLICY);

    expect(snapshot.effectiveContextWindow).toBe(32768);
    expect(snapshot.effectiveMaxInput).toBe(32768);
    expect(snapshot.effectiveMaxOutput).toBe(4096);
  });

  it("respects custom budget policy", () => {
    const policy: ContextBudgetPolicy = {
      outputReserveTokens: 8192,
      systemReserveTokens: 4096,
      toolReserveTokens: 2048,
      memoryReserveTokens: 2048,
      safetyMarginTokens: 512,
      compactTriggerRatio: 0.7,
      minRecentTurnsToKeep: 6,
      maxSummaryBlocks: 2,
      enableLongTermMemory: false,
      enableContextCheckpoint: false,
    };
    const snapshot = buildBudgetSnapshot(baseCapability, policy);

    expect(snapshot.effectiveMaxOutput).toBe(4096); // capped by capability
    expect(snapshot.compactTriggerTokens).toBe(Math.floor(snapshot.safeInputBudget * 0.7));
    expect(snapshot.policy.enableLongTermMemory).toBe(false);
  });

  it("ensures safeInputBudget is never negative", () => {
    const tinyCapability: ModelCapability = {
      contextWindowTokens: 1024,
      maxInputTokens: 512,
      maxOutputTokens: 256,
      source: "default",
    };
    const snapshot = buildBudgetSnapshot(tinyCapability, DEFAULT_CONTEXT_BUDGET_POLICY);
    expect(snapshot.safeInputBudget).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Output Limit Normalization
// ---------------------------------------------------------------------------

describe("normalizeOutputLimit", () => {
  it("extracts max_tokens from requestBody", () => {
    const result = normalizeOutputLimit({ max_tokens: 2048 });
    expect(result).toBe(2048);
  });

  it("prefers max_completion_tokens over max_tokens", () => {
    const result = normalizeOutputLimit({
      max_tokens: 2048,
      max_completion_tokens: 4096,
    });
    expect(result).toBe(4096);
  });

  it("returns null when no output limit fields present", () => {
    const result = normalizeOutputLimit({});
    expect(result).toBeNull();
  });

  it("returns null for undefined requestBody", () => {
    const result = normalizeOutputLimit(undefined);
    expect(result).toBeNull();
  });

  it("handles string values gracefully", () => {
    const result = normalizeOutputLimit({ max_tokens: "2048" });
    expect(result).toBe(2048);
  });
});
