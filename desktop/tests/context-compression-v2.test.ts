/**
 * 上下文压缩 V2 测试 — Observation Masking + 长会话提醒
 */

import { describe, it, expect } from "vitest";

import {
  compactMessages,
  type CompactionResult,
} from "../src/main/services/context-compactor";

import {
  assembleContext,
} from "../src/main/services/context-assembler";

import type {
  ChatMessage,
  ChatSession,
  ModelCapability,
  ContextBudgetPolicy,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

let msgSeq = 0;

function makeMsg(
  role: ChatMessage["role"],
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: `msg-${++msgSeq}`,
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
    modelProfileId: "p1",
    attachedDirectory: "/test",
    createdAt: new Date().toISOString(),
    messages,
  };
}

const cap: ModelCapability = {
  contextWindowTokens: 32768,
  maxInputTokens: 28672,
  maxOutputTokens: 4096,
  supportsTools: true,
  supportsStreaming: true,
  tokenCountingMode: "character-fallback",
  source: "registry",
};

/**
 * 构造一组带 tool_call 的标准轮次消息。
 * 每轮 = user + assistant(tool_call) + tool(output) + assistant(reply)
 */
function buildToolRounds(count: number, toolOutputLen: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const tcId = `tc-${i}`;
    msgs.push(makeMsg("user", `问题 ${i}`));
    msgs.push(makeMsg("assistant", "", {
      tool_calls: [{ id: tcId, type: "function", function: { name: `tool_${i}`, arguments: "{}" } }],
    }));
    msgs.push(makeMsg("tool", "x".repeat(toolOutputLen), { tool_call_id: tcId }));
    msgs.push(makeMsg("assistant", `回答 ${i}`));
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Observation Masking
// ---------------------------------------------------------------------------

describe("Observation Masking (Stage 1.5)", () => {
  it("保留最近 N 条工具输出，替换更早的为占位符", () => {
    // 每条工具输出 4000 字符 ≈ 1000 token，15 轮总量远超 budgetTokens
    const messages = buildToolRounds(15, 4000);
    const result = compactMessages({
      messages,
      budgetTokens: 5000,
      capability: cap,
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, recentToolOutputTurnsToKeep: 3 },
    });

    // 应该有被 mask 的工具输出
    expect(result.maskedToolOutputCount).toBeGreaterThan(0);

    // 被 mask 的消息应包含占位符文本
    const maskedTools = result.compacted.filter(
      (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("[工具输出已省略]"),
    );
    expect(maskedTools.length).toBeGreaterThan(0);

    // 最近 3 条工具输出不应被 mask
    const toolMsgs = result.compacted.filter((m) => m.role === "tool");
    const lastThree = toolMsgs.slice(-3);
    for (const m of lastThree) {
      const text = typeof m.content === "string" ? m.content : "";
      expect(text).not.toContain("[工具输出已省略]");
    }
  });

  it("跳过已经很短的工具输出（≤ 100 字符）", () => {
    const messages = buildToolRounds(5, 50); // 每条 50 字符，全部 ≤ 100
    const result = compactMessages({
      messages,
      budgetTokens: 500, // 很紧的预算，但短输出不会被 mask
      capability: cap,
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, recentToolOutputTurnsToKeep: 1 },
    });

    expect(result.maskedToolOutputCount).toBe(0);
  });

  it("占位符包含工具名和摘要信息", () => {
    const tcId = "tc-placeholder-test";
    const messages = [
      makeMsg("user", "读文件"),
      makeMsg("assistant", "", {
        tool_calls: [{ id: tcId, type: "function", function: { name: "fs_read", arguments: "{}" } }],
      }),
      makeMsg("tool", "这是一段很长的文件内容".repeat(50), { tool_call_id: tcId }),
      makeMsg("assistant", "文件读取完成"),
      // 添加最近的工具消息占位
      makeMsg("user", "继续"),
      makeMsg("assistant", "", {
        tool_calls: [{ id: "tc-recent", type: "function", function: { name: "other", arguments: "{}" } }],
      }),
      makeMsg("tool", "short result", { tool_call_id: "tc-recent" }),
      makeMsg("assistant", "完成"),
    ];

    const result = compactMessages({
      messages,
      budgetTokens: 300,
      capability: cap,
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, recentToolOutputTurnsToKeep: 1 },
    });

    const masked = result.compacted.find(
      (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("[工具输出已省略]"),
    );
    expect(masked).toBeTruthy();
    const text = masked!.content as string;
    expect(text).toContain("工具: fs_read");
    expect(text).toContain("原始行数:");
    expect(text).toContain("摘要:");
  });

  it("在预算足够时不触发 masking", () => {
    const messages = buildToolRounds(3, 200);
    const result = compactMessages({
      messages,
      budgetTokens: 100000,
      capability: cap,
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
    });

    expect(result.maskedToolOutputCount).toBe(0);
    expect(result.reason).toBeNull();
  });

  it("masking 足够时不进入 Stage 2 删消息", () => {
    // 10 轮 * 2000 字符工具输出 ≈ 5000 token 工具内容 + 其他消息
    // 给足够大的预算使得 masking 后刚好能进预算
    const messages = buildToolRounds(10, 2000);
    const result = compactMessages({
      messages,
      budgetTokens: 4000,
      capability: cap,
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, recentToolOutputTurnsToKeep: 2 },
    });

    // masking 应触发
    expect(result.maskedToolOutputCount).toBeGreaterThan(0);
    // 如果 masking 足够，不应删消息
    if (result.reason === "observation-masked") {
      expect(result.removedCount).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 长会话提醒 (shouldSuggestNewChat)
// ---------------------------------------------------------------------------

describe("shouldSuggestNewChat", () => {
  it("priorCompactionCount 达到阈值时返回 true", () => {
    const messages = [makeMsg("user", "Hello"), makeMsg("assistant", "Hi")];
    const session = makeSession(messages);
    const result = assembleContext({
      session,
      capability: cap,
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, suggestNewChatAfterCompactions: 2 },
      workingDir: "/test",
      priorCompactionCount: 2,
    });

    expect(result.shouldSuggestNewChat).toBe(true);
  });

  it("消息总数 >= 100 时返回 true", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(makeMsg("user", `msg ${i}`));
    }
    const session = makeSession(messages);
    const result = assembleContext({
      session,
      capability: { ...cap, contextWindowTokens: 999999, maxInputTokens: 999999 },
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
      workingDir: "/test",
    });

    expect(result.shouldSuggestNewChat).toBe(true);
  });

  it("短会话、无压缩时返回 false", () => {
    const messages = [makeMsg("user", "Hello"), makeMsg("assistant", "Hi")];
    const session = makeSession(messages);
    const result = assembleContext({
      session,
      capability: cap,
      policy: DEFAULT_CONTEXT_BUDGET_POLICY,
      workingDir: "/test",
    });

    expect(result.shouldSuggestNewChat).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// maskedToolOutputCount 透传
// ---------------------------------------------------------------------------

describe("maskedToolOutputCount 在 AssembledContext 中透传", () => {
  it("assembleContext 返回 maskedToolOutputCount", () => {
    const messages = buildToolRounds(15, 500);
    const session = makeSession(messages);
    const result = assembleContext({
      session,
      capability: { ...cap, contextWindowTokens: 8000, maxInputTokens: 6000 },
      policy: { ...DEFAULT_CONTEXT_BUDGET_POLICY, recentToolOutputTurnsToKeep: 2 },
      workingDir: "/test",
    });

    expect(typeof result.maskedToolOutputCount).toBe("number");
  });
});
