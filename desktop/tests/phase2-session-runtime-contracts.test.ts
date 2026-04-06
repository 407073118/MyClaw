import { describe, expect, it } from "vitest";

import type {
  ChatSession,
  Phase2SessionRuntimeIntent,
  ResolvedExecutionPlan,
  ResolvedSessionRuntimeIntent,
} from "@shared/contracts";
import {
  EXECUTION_PLAN_SOURCE_VALUES,
  SESSION_RUNTIME_TOOL_STRATEGY_VALUES,
  SESSION_RUNTIME_VERSION,
} from "@shared/contracts";
import { resolveSessionRuntimeIntent } from "../src/main/services/reasoning-runtime";

describe("Phase 2 session runtime contracts", () => {
  it("supports richer runtime intent and execution plan metadata", () => {
    const intent: Phase2SessionRuntimeIntent = {
      reasoningMode: "auto",
      reasoningEnabled: true,
      reasoningEffort: "high",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn-with-reasoning",
      toolStrategy: "auto",
    };

    const plan: ResolvedExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "br-minimax",
      adapterSelectionSource: "intent",
      reasoningMode: "auto",
      reasoningEnabled: true,
      reasoningEffort: "high",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn-with-reasoning",
      toolStrategy: "auto",
      degradationReason: null,
      planSource: "intent",
      fallbackAdapterIds: ["openai-compatible"],
    };

    const parsed = JSON.parse(JSON.stringify({ intent, plan })) as {
      intent: Phase2SessionRuntimeIntent;
      plan: ResolvedExecutionPlan;
    };

    expect(parsed.intent.reasoningEnabled).toBe(true);
    expect(parsed.intent.toolStrategy).toBe("auto");
    expect(parsed.plan.reasoningEffort).toBe("high");
    expect(parsed.plan.degradationReason).toBeNull();
    expect(parsed.plan.planSource).toBe("intent");
  });

  it("keeps older persisted sessions valid when phase 2 fields are absent", () => {
    const legacySessionJson = JSON.stringify({
      id: "session-legacy",
      title: "Legacy Session",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      runtimeVersion: SESSION_RUNTIME_VERSION,
      runtimeIntent: {
        reasoningMode: "auto",
      },
      messages: [],
    } satisfies ChatSession);

    const parsed = JSON.parse(legacySessionJson) as ChatSession;
    const parsedRuntimeIntent = parsed.runtimeIntent as Partial<Phase2SessionRuntimeIntent> | null | undefined;

    expect(parsed.runtimeIntent?.reasoningMode).toBe("auto");
    expect(parsedRuntimeIntent?.reasoningEnabled).toBeUndefined();
    expect(parsedRuntimeIntent?.toolStrategy).toBeUndefined();
  });

  it("keeps truly older sessions valid when runtimeIntent is absent or null", () => {
    const legacyWithoutIntent = JSON.parse(JSON.stringify({
      id: "session-legacy-absent",
      title: "Legacy Without Intent",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      runtimeVersion: SESSION_RUNTIME_VERSION,
      messages: [],
    } satisfies ChatSession)) as ChatSession;

    const legacyWithNullIntent = JSON.parse(JSON.stringify({
      id: "session-legacy-null",
      title: "Legacy Null Intent",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      runtimeVersion: SESSION_RUNTIME_VERSION,
      runtimeIntent: null,
      messages: [],
    } satisfies ChatSession)) as ChatSession;

    expect(legacyWithoutIntent.runtimeIntent).toBeUndefined();
    expect(legacyWithNullIntent.runtimeIntent).toBeNull();
    expect(resolveSessionRuntimeIntent(legacyWithoutIntent)).toEqual<ResolvedSessionRuntimeIntent>({
      reasoningMode: "auto",
      reasoningEffort: "medium",
      adapterHint: "auto",
      replayPolicy: "content-only",
    });
    expect(resolveSessionRuntimeIntent(legacyWithNullIntent)).toEqual<ResolvedSessionRuntimeIntent>({
      reasoningMode: "auto",
      reasoningEffort: "medium",
      adapterHint: "auto",
      replayPolicy: "content-only",
    });
  });

  it("stays compatible with the existing reasoning-runtime default shell", () => {
    expect(resolveSessionRuntimeIntent()).toEqual<ResolvedSessionRuntimeIntent>({
      reasoningMode: "auto",
      reasoningEffort: "medium",
      adapterHint: "auto",
      replayPolicy: "content-only",
    });
  });

  it("exports phase 2 tool strategy and plan source values", () => {
    expect(SESSION_RUNTIME_TOOL_STRATEGY_VALUES).toContain("auto");
    expect(EXECUTION_PLAN_SOURCE_VALUES).toContain("intent");
  });
});
