/**
 * Phase 17: Context Compiler 跨模型上下文编译测试。
 *
 * 测试内容：
 * - compileContext 使用 compactTriggerTokens 作为主链压缩阈值
 * - 触发压缩时生成结构化 checkpoint 与可观测 metadata
 * - 代码/JSON/diff/tool output 默认不走语义压缩，保持原文或结构化占位
 */

import { describe, expect, it } from "vitest";

import {
  compileContext,
} from "../src/main/services/context-compiler";

import type {
  ChatMessage,
  ChatSession,
  ContextBudgetPolicy,
  ModelCapability,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";

/** 构造稳定消息，方便断言 sourceMessageIds 与原文保留行为。 */
function makeMessage(
  id: string,
  role: ChatMessage["role"],
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: `2026-05-23T00:00:${id.replace(/\D/g, "").padStart(2, "0").slice(-2)}.000Z`,
    ...extra,
  };
}

/** 构造测试会话，默认只关注上下文编译输入。 */
function makeSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "session-context-compiler",
    title: "Context Compiler",
    modelProfileId: "profile-1",
    attachedDirectory: "F:/MyClaw",
    createdAt: "2026-05-23T00:00:00.000Z",
    messages,
  };
}

const capability: ModelCapability = {
  contextWindowTokens: 4096,
  maxInputTokens: 4096,
  maxOutputTokens: 512,
  supportsTools: true,
  supportsStreaming: true,
  tokenCountingMode: "character-fallback",
  source: "registry",
};

const policy: ContextBudgetPolicy = {
  ...DEFAULT_CONTEXT_BUDGET_POLICY,
  outputReserveTokens: 128,
  systemReserveTokens: 64,
  toolReserveTokens: 64,
  memoryReserveTokens: 64,
  safetyMarginTokens: 32,
  minRecentTurnsToKeep: 4,
  recentToolOutputTurnsToKeep: 1,
  enableContextCheckpoint: true,
};

describe("compileContext", () => {
  it("uses compactTriggerTokens as the effective compile limit before the safe input budget", () => {
    const messages = Array.from({ length: 18 }, (_, index) =>
      makeMessage(`m${index}`, index % 2 === 0 ? "user" : "assistant", `历史消息 ${index} ${"x".repeat(120)}`),
    );

    const result = compileContext({
      session: makeSession(messages),
      capability,
      policy,
      workingDir: "F:/MyClaw",
      compactTriggerTokens: 220,
      turnId: "turn-compact-trigger",
      systemPromptBuilder: () => "系统提示",
    });

    expect(result.metadata.trigger).toBe("token_threshold");
    expect(result.metadata.strategy).toEqual(expect.arrayContaining(["exact_keep", "checkpoint"]));
    expect(result.metadata.budgetLimit).toBeLessThanOrEqual(220);
    expect(result.metadata.removedMessageIds.length).toBeGreaterThan(0);
    expect(result.checkpoint?.turnId).toBe("turn-compact-trigger");
    expect(result.checkpoint?.sourceMessageIds).toEqual(messages.map((message) => message.id));
    expect(result.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("# Context Checkpoint"),
    });
    expect(result.sections.map((section) => section.kind)).toEqual(
      expect.arrayContaining(["system", "checkpoint", "recent_turns"]),
    );
  });

  it("keeps code and JSON text exact instead of applying prompt compression", () => {
    const codeBlock = "```ts\nconst payload = { ok: true, path: \"F:/MyClaw/desktop\" };\n```";
    const jsonBlock = "{ \"mustKeep\": true, \"api\": \"compileContext\" }";
    const messages = [
      makeMessage("m1", "user", `请保留这段代码\n${codeBlock}`),
      makeMessage("m2", "assistant", `配置如下\n${jsonBlock}`),
    ];

    const result = compileContext({
      session: makeSession(messages),
      capability,
      policy,
      workingDir: "F:/MyClaw",
      compactTriggerTokens: 4000,
      turnId: "turn-no-prompt-compress",
      systemPromptBuilder: () => "系统提示",
    });

    const compiledText = result.messages.map((message) => String((message as { content?: unknown }).content ?? "")).join("\n");
    expect(compiledText).toContain(codeBlock);
    expect(compiledText).toContain(jsonBlock);
    expect(result.metadata.strategy).not.toContain("prompt_compress");
  });
});
