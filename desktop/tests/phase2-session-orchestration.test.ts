import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "../src/main/services/runtime-context";
import {
  CHAT_RUN_PHASE_VALUES,
  CHAT_RUN_STATUS_VALUES,
  EventType,
  type ChatRunRuntimeStatusPayload,
} from "@shared/contracts";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const sentStreamEvents: Array<{ channel: string; payload: unknown }> = [];

const callModelMock = vi.fn();
const assembleContextMock = vi.fn();
const resolveModelCapabilityMock = vi.fn();
const resolveSessionRuntimeIntentMock = vi.fn();
const buildExecutionPlanMock = vi.fn();
const saveSessionMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandleRegistry.set(channel, handler);
    }),
  },
  webContents: {
    getAllWebContents: () => [{
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sentStreamEvents.push({
          channel,
          payload: JSON.parse(JSON.stringify(payload)),
        });
      },
    }],
  },
}));

vi.mock("../src/main/services/model-client", () => ({
  callModel: callModelMock,
}));

vi.mock("../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: () => ({
    executeTurn: async (input: {
      profile: unknown;
      mode?: "legacy" | "canonical";
      content?: unknown;
      plan?: unknown;
      toolSpecs?: unknown[];
      messages?: unknown[];
      tools?: unknown[];
      executionPlan?: unknown;
      signal?: AbortSignal;
      onDelta?: (delta: { content?: string; reasoning?: string }) => void;
      onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void;
    }) => {
      const result = await callModelMock({
        profile: input.profile,
        messages: input.messages,
        tools: input.tools,
        executionPlan: input.plan ?? input.executionPlan,
        signal: input.signal,
        onDelta: input.onDelta,
        onToolCallDelta: input.onToolCallDelta,
      });
      return {
        ...result,
        plan: input.plan ?? input.executionPlan,
        outcome: { id: "outcome-1" },
        requestShape: {},
      };
    },
  }),
}));

vi.mock("../src/main/services/context-assembler", () => ({
  assembleContext: assembleContextMock,
}));

vi.mock("../src/main/services/model-capability-resolver", () => ({
  resolveModelCapability: resolveModelCapabilityMock,
}));

vi.mock("../src/main/services/reasoning-runtime", () => ({
  resolveSessionRuntimeIntent: resolveSessionRuntimeIntentMock,
  buildExecutionPlan: buildExecutionPlanMock,
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveSession: saveSessionMock,
  deleteSessionFiles: vi.fn(),
}));

vi.mock("../src/main/services/tool-schemas", () => ({
  buildToolSchemas: vi.fn(() => []),
  functionNameToToolId: vi.fn((name: string) => name),
  buildToolLabel: vi.fn((name: string) => name),
}));

vi.mock("../src/main/services/builtin-tool-executor", () => ({
  BuiltinToolExecutor: class {
    setSkills(): void {}
    setAllowExternalPaths(): void {}
    async execute(): Promise<{ success: boolean; output: string }> {
      return { success: true, output: "" };
    }
    async shutdown(): Promise<void> {}
    isOutsideWorkspace(): boolean {
      return false;
    }
  },
}));

type SessionWithExecutionPlan = {
  runtimeVersion?: number;
  executionPlan?: {
    adapterId: string;
    replayPolicy: string;
    degradationReason: string | null;
    planSource: string;
  };
  messages: Array<{ role: string; content: unknown }>;
};

/** 构造最小 RuntimeContext，专门验证 Task 4 的 send orchestration。 */
function buildContext(): RuntimeContext {
  return {
    runtime: {
      myClawRootPath: "/tmp/myclaw",
      skillsRootPath: "/tmp/myclaw/skills",
      sessionsRootPath: "/tmp/myclaw/sessions",
      paths: {
        rootDir: "/tmp",
        myClawDir: "/tmp/myclaw",
        skillsDir: "/tmp/myclaw/skills",
        sessionsDir: "/tmp/myclaw/sessions",
        modelsDir: "/tmp/myclaw/models",
        settingsFile: "/tmp/myclaw/settings.json",
      },
    },
    state: {
      models: [{
        id: "profile-1",
        name: "BR MiniMax",
        provider: "openai-compatible",
        providerFlavor: "br-minimax",
        baseUrl: "http://api-pre.cybotforge.100credit.cn",
        apiKey: "test-key",
        model: "minimax-m2-5",
      }],
      sessions: [],
      employees: [],
      skills: [],
      workflowDefinitions: {},
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
      activeSessionRuns: new Map(),
      getDefaultModelProfileId: () => "profile-1",
      setDefaultModelProfileId: () => {},
      getWorkflows: () => [],
      getApprovals: () => ({
        mode: "prompt",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      }),
      getApprovalRequests: () => [],
      setApprovalRequests: () => {},
      getPersonalPromptProfile: () => ({
        prompt: "",
        summary: "",
        tags: [],
        updatedAt: null,
      }),
      setPersonalPromptProfile: () => {},
    },
    services: {
      refreshSkills: async () => [],
      listMcpServers: () => [],
      mcpManager: null,
      resolveModelCapability: undefined,
    },
    tools: {
      resolveBuiltinTools: () => [],
      resolveMcpTools: () => [],
    },
  };
}

describe("Phase 2 session orchestration", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    sentStreamEvents.length = 0;
    callModelMock.mockReset();
    assembleContextMock.mockReset();
    resolveModelCapabilityMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    saveSessionMock.mockReset();
  });

  it("exports explicit chat run runtime status vocabulary for interrupt orchestration", () => {
    const payload: ChatRunRuntimeStatusPayload = {
      sessionId: "session-1",
      runId: "run-1",
      status: "canceling",
      phase: "approval",
      messageId: "msg-1",
      reason: "user_requested",
    };

    expect(CHAT_RUN_STATUS_VALUES).toEqual(expect.arrayContaining([
      "running",
      "canceling",
      "canceled",
      "completed",
    ]));
    expect(CHAT_RUN_PHASE_VALUES).toEqual(expect.arrayContaining([
      "planning",
      "model",
      "approval",
      "tools",
      "persisting",
    ]));
    expect(payload).toMatchObject({
      sessionId: "session-1",
      runId: "run-1",
      status: "canceling",
      phase: "approval",
    });
  });

  it("cancels an active run, preserves partial assistant content, and avoids synthetic abort errors", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    registerSessionHandlers(ctx);
    const cancelHandler = ipcHandleRegistry.get("session:cancel-run");

    expect(cancelHandler).toBeTypeOf("function");

    const sessionId = "session-1";
    const runId = "run-cancel";
    const messageId = "message-cancel";
    const abortController = new AbortController();
    const session = {
      id: sessionId,
      title: "Cancelable",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-10T00:00:00.000Z",
      messages: [] as Array<{ id: string; role: string; content: string; createdAt: string }>,
    };
    ctx.state.sessions.push(session);
    session.messages.push({
      id: messageId,
      role: "assistant",
      content: "partial answer",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    ctx.state.activeSessionRuns.set(sessionId, {
      runId,
      abortController,
      status: "running",
      phase: "model",
      currentMessageId: messageId,
      pendingApprovalIds: [],
      cancelRequested: false,
    });

    const cancelResult = await cancelHandler?.({}, sessionId, { runId }) as {
      success: boolean;
      state: string;
    };
    expect(cancelResult).toEqual({
      success: true,
      state: "canceling",
    });
    expect(abortController.signal.aborted).toBe(true);
    expect(session.chatRunState).toMatchObject({
      runId,
      status: "canceling",
    });
    expect(session.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: "partial answer",
      }),
    ]));
    expect(session.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("[模型调用失败]"),
      }),
    ]));
    expect(session.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("AbortError"),
      }),
    ]));

    const runtimeStatuses = sentStreamEvents
      .filter((event) => event.channel === "session:stream")
      .map((event) => event.payload)
      .filter((payload): payload is { type: string; status?: string; runId?: string } => {
        return typeof payload === "object" && payload !== null && "type" in payload;
      })
      .filter((payload) => payload.type === EventType.RuntimeStatus)
      .map((payload) => payload.status);

    expect(runtimeStatuses).toEqual(expect.arrayContaining([
      "canceling",
    ]));
    expect(ctx.state.activeSessionRuns.has(sessionId)).toBe(true);
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      chatRunState: expect.objectContaining({
        status: "canceling",
        runId,
      }),
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "partial answer",
        }),
      ]),
    });
  });

  it("runs session send as intent -> plan -> execute and preserves degradation metadata", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    const order: string[] = [];

    const runtimeIntent = {
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "high",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
    };

    const executionPlan = {
      runtimeVersion: 1,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "high",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
      degradationReason: "capability-missing",
      planSource: "capability",
      fallbackAdapterIds: ["openai-compatible"],
    };

    resolveSessionRuntimeIntentMock.mockImplementation(() => {
      order.push("intent");
      return runtimeIntent;
    });
    resolveModelCapabilityMock.mockImplementation(() => {
      order.push("capability");
      return {
        effective: {
          supportsReasoning: false,
          source: "registry",
        },
      };
    });
    buildExecutionPlanMock.mockImplementation(() => {
      order.push("plan");
      return executionPlan;
    });
    assembleContextMock.mockImplementation((input) => {
      order.push("context");
      expect(input).toMatchObject({
        executionPlan,
      });
      return {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "hello" },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock.mockImplementation(async (input) => {
      order.push("execute");
      expect(input).toMatchObject({
        executionPlan: expect.objectContaining({
          providerFamily: "br-minimax",
          legacyExecutionPlan: executionPlan,
        }),
      });
      return {
        content: "done",
        toolCalls: [],
        finishReason: "stop",
      };
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");

    expect(createHandler).toBeTypeOf("function");
    expect(sendHandler).toBeTypeOf("function");

    const created = await createHandler?.({}, { title: "Phase 2" }) as {
      session: { id: string; runtimeIntent?: typeof runtimeIntent };
    };
    created.session.runtimeIntent = runtimeIntent;
    const response = await sendHandler?.({}, created.session.id, { content: "hello" }) as {
      session: SessionWithExecutionPlan;
    };

    // resolveSessionRuntimeIntent is called 3 times per send:
    // 1) sessionReasoningEffort extraction, 2) isPlanModeEnabled check, 3) agentic loop
    expect(resolveSessionRuntimeIntentMock).toHaveBeenCalledTimes(3);
    expect(buildExecutionPlanMock).toHaveBeenCalledTimes(2);
    expect(buildExecutionPlanMock).toHaveBeenCalledWith(expect.objectContaining({
      session: {
        runtimeIntent,
      },
      profile: expect.objectContaining({
        id: "profile-1",
      }),
      capability: expect.objectContaining({
        supportsReasoning: false,
      }),
    }));
    // 发送前会先为工具策略预热一次 plan，再进入真实回合，
    // 所以关键顺序应以最后一轮 intent → capability → plan → context → execute 为准。
    expect(order).toEqual(expect.arrayContaining(["intent", "capability", "plan", "context", "execute"]));
    const lastIntent = order.lastIndexOf("intent");
    const lastCapability = order.lastIndexOf("capability");
    const lastPlan = order.lastIndexOf("plan");
    const contextIdx = order.indexOf("context");
    const executeIdx = order.indexOf("execute");
    expect(lastIntent).toBeLessThan(lastCapability);
    expect(lastCapability).toBeLessThan(lastPlan);
    expect(lastPlan).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(executeIdx);
    expect(assembleContextMock).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan: expect.objectContaining({
        replayPolicy: "assistant-turn",
        degradationReason: "capability-missing",
      }),
    }));
    expect(callModelMock).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan: expect.objectContaining({
        providerFamily: "br-minimax",
        legacyExecutionPlan: expect.objectContaining({
          replayPolicy: "assistant-turn",
        }),
      }),
    }));
    expect(response.session.runtimeVersion).toBe(1);
    expect(response.session.executionPlan).toMatchObject({
      adapterId: "br-minimax",
      replayPolicy: "assistant-turn",
      degradationReason: "capability-missing",
      planSource: "capability",
    });
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      executionPlan: expect.objectContaining({
        degradationReason: "capability-missing",
        planSource: "capability",
      }),
    });
    expect(response.session.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "done",
    });
  });
});
