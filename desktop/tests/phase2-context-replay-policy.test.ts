import { describe, expect, it } from "vitest";

import type {
  ChatMessage,
  ChatSession,
  ModelCapability,
} from "@shared/contracts";
import { assembleContext } from "../src/main/services/context-assembler";
import { compactMessages } from "../src/main/services/context-compactor";

function makeMessage(
  role: ChatMessage["role"],
  content: ChatMessage["content"],
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `${role}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: "2026-04-06T00:00:00.000Z",
    ...extra,
  };
}

function makeSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "phase2-context-session",
    title: "Phase 2 Context Replay",
    modelProfileId: "profile-1",
    attachedDirectory: "/tmp/project",
    createdAt: "2026-04-06T00:00:00.000Z",
    messages,
  };
}

const capability: ModelCapability = {
  contextWindowTokens: 32768,
  maxInputTokens: 28672,
  maxOutputTokens: 4096,
  supportsTools: true,
  supportsStreaming: true,
  supportsReasoning: true,
  tokenCountingMode: "character-fallback",
  source: "registry",
};

describe("Phase 2 context replay policy", () => {
  it("strips assistant reasoning for content-only replay", () => {
    const messages = [
      makeMessage("user", "Summarize the prior run"),
      makeMessage("assistant", "Final answer", { reasoning: "step one\nstep two" }),
    ];

    const compacted = compactMessages({
      messages,
      budgetTokens: 10000,
      capability,
      replayPolicy: "content-only",
    });

    const assembled = assembleContext({
      session: makeSession(messages),
      capability,
      workingDir: "/tmp/project",
      replayPolicy: "content-only",
    });

    expect(compacted.compacted[1]).toMatchObject({
      role: "assistant",
      content: "Final answer",
    });
    expect(compacted.compacted[1]).not.toHaveProperty("reasoning");
    expect(assembled.messages[2]).toMatchObject({
      role: "assistant",
      content: "Final answer",
    });
    expect(assembled.messages[2]).not.toHaveProperty("reasoning");
  });

  it("keeps assistant turn structure for assistant-turn replay but drops reasoning payload", () => {
    const messages = [
      makeMessage("user", "Should we call the weather tool?"),
      makeMessage("assistant", "", {
        reasoning: "Need the tool result before answering.",
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
          },
        }],
      }),
      makeMessage("tool", "{\"temperature\":22}", { tool_call_id: "tool-1" }),
      makeMessage("assistant", "It is 22C", { reasoning: "Tool returned 22C." }),
    ];

    const assembled = assembleContext({
      session: makeSession(messages),
      capability,
      workingDir: "/tmp/project",
      executionPlan: {
        replayPolicy: "assistant-turn",
      },
    });

    expect(assembled.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "Should we call the weather tool?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
          },
        }],
      },
      {
        role: "tool",
        content: "{\"temperature\":22}",
        tool_call_id: "tool-1",
      },
      {
        role: "assistant",
        content: "It is 22C",
      },
    ]);
  });

  it("keeps reasoning for assistant-turn-with-reasoning replay-aware providers", () => {
    const messages = [
      makeMessage("user", "Summarize the prior run"),
      makeMessage("assistant", "Final answer", { reasoning: "step one\nstep two" }),
    ];

    const compacted = compactMessages({
      messages,
      budgetTokens: 10000,
      capability,
      executionPlan: {
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    const assembled = assembleContext({
      session: makeSession(messages),
      capability,
      workingDir: "/tmp/project",
      executionPlan: {
        replayPolicy: "assistant-turn-with-reasoning",
      },
    });

    expect(compacted.compacted[1]).toMatchObject({
      role: "assistant",
      content: "Final answer",
      reasoning: "step one\nstep two",
    });
    expect(assembled.messages[2]).toMatchObject({
      role: "assistant",
      content: "Final answer",
      reasoning: "step one\nstep two",
    });
  });
});
