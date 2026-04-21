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
const executeTurnMock = vi.fn();

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
  createExecutionGateway: vi.fn(() => ({ executeTurn: executeTurnMock })),
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
  saveSiliconPerson: vi.fn(),
  saveWorkflowRun: vi.fn(),
  deleteWorkflowRunFile: vi.fn(),
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

vi.mock("../src/main/services/model-runtime/canonical-turn-content", () => ({
  buildCanonicalTurnContent: vi.fn(() => ({ systemSections: [], userSections: [], messages: [], toolCalls: [], toolResults: [], approvalEvents: [], taskState: null, replayHints: {} })),
}));
vi.mock("../src/main/services/model-runtime/background-task-manager", () => ({
  createBackgroundTaskManager: vi.fn(() => ({ getSnapshot: () => null, reset: vi.fn(), poll: vi.fn(), cancel: vi.fn() })),
}));
vi.mock("../src/main/services/model-runtime/computer-action-harness", () => ({
  createComputerActionHarness: vi.fn(() => ({ getComputerCalls: () => [] })),
  getComputerActionToolId: vi.fn(() => "computer"),
  buildComputerActionLabel: vi.fn(() => ""),
  getComputerActionRisk: vi.fn(() => "write"),
}));
vi.mock("../src/main/services/model-runtime/prompt-composer", () => ({
  composePromptSections: vi.fn(() => []),
}));
vi.mock("../src/main/services/model-runtime/tool-registry", () => ({
  buildCanonicalToolRegistry: vi.fn(() => ({ specs: [], resolve: vi.fn(), functionNameToToolId: vi.fn((n: string) => n), buildToolLabel: vi.fn((n: string) => n) })),
}));
vi.mock("../src/main/services/model-runtime/turn-execution-plan-resolver", () => ({
  resolveTurnExecutionPlan: vi.fn((input: Record<string, unknown>) => ({
    providerFamily: "br-minimax",
    protocolTarget: "openai-chat-compatible",
    replayPolicy: "assistant-turn",
    reasoningEffort: "medium",
    capabilityRoutes: {},
    telemetryTags: {},
    legacyExecutionPlan: input?.legacyExecutionPlan ?? {
      adapterId: "br-minimax",
      replayPolicy: "assistant-turn",
      reasoningMode: "auto",
    },
  })),
}));
vi.mock("../src/main/services/model-runtime/turn-outcome-store", () => ({
  loadTurnOutcome: vi.fn(() => null),
  updateTurnOutcome: vi.fn(),
}));
vi.mock("../src/main/services/session-background-task", () => ({
  isTerminalBackgroundTaskStatus: vi.fn(() => false),
  syncSessionBackgroundTaskSnapshot: vi.fn(),
}));
vi.mock("../src/main/services/silicon-person-session", () => ({
  syncSiliconPersonExecutionResult: vi.fn(),
}));
vi.mock("../src/main/services/silicon-person-workspace", () => ({
  getOrCreateWorkspace: vi.fn(() => null),
  shutdownAllWorkspaces: vi.fn(),
}));
vi.mock("../src/main/services/planner-runtime", () => ({
  blockTask: vi.fn(),
  completeTask: vi.fn(),
  createPlanState: vi.fn(() => null),
  startTask: vi.fn(),
}));
vi.mock("../src/main/services/task-store", () => ({
  createTask: vi.fn(),
  listTasks: vi.fn(() => []),
  getTask: vi.fn(() => null),
  updateTask: vi.fn(),
  clearCompletedTasks: vi.fn(),
}));
vi.mock("../src/main/services/artifact-context-builder", () => ({
  buildArtifactContextBlock: vi.fn(() => ""),
}));
vi.mock("../src/main/services/personal-prompt-profile", () => ({
  buildPersonalPromptContext: vi.fn(() => ""),
}));
vi.mock("../src/main/services/context-enricher", () => ({
  extractEnrichedContext: vi.fn(() => ({})),
  buildEnrichedContextBlock: vi.fn(() => ""),
}));
vi.mock("@shared/task-logical", () => ({
  buildTaskDisplayItems: vi.fn(() => ""),
}));
vi.mock("../src/main/services/pending-saves", () => ({
  trackSave: vi.fn((p: Promise<unknown>) => p),
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
      workspaceRootPath: "/tmp/myclaw/workspace",
      artifactsRootPath: "/tmp/myclaw/artifacts",
      cacheRootPath: "/tmp/myclaw/cache",
      paths: {
        rootDir: "/tmp",
        myClawDir: "/tmp/myclaw",
        skillsDir: "/tmp/myclaw/skills",
        sessionsDir: "/tmp/myclaw/sessions",
        modelsDir: "/tmp/myclaw/models",
        workspaceDir: "/tmp/myclaw/workspace",
        artifactsDir: "/tmp/myclaw/artifacts",
        cacheDir: "/tmp/myclaw/cache",
        settingsFile: "/tmp/myclaw/settings.json",
      },
    },
    state: {
      models: [{
        id: "profile-1",
        name: "BR MiniMax",
        provider: "openai-compatible",
        providerFlavor: "br-minimax",
        baseUrl: "http://api-cybotforge-pre.brapp.com",
        apiKey: "test-key",
        model: "minimax-m2-5",
      }],
      sessions: [],
      siliconPersons: [],
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
      artifactRegistry: { query: vi.fn(() => []) } as any,
      artifactManager: {} as any,
      refreshSkills: async () => [],
      listMcpServers: () => [],
      mcpManager: null,
      appUpdater: { getSnapshot: () => ({}) } as any,
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
    executeTurnMock.mockReset();
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
    executeTurnMock.mockImplementation(async (input: Record<string, unknown>) => {
      order.push("execute");
      return {
        content: "done",
        toolCalls: [],
        finishReason: "stop",
        reasoning: null,
        citations: [],
        capabilityEvents: [],
        computerCalls: [],
        backgroundTask: null,
        plan: input.plan ?? input.executionPlan ?? {},
        providerFamily: "br-minimax",
        protocolTarget: "openai-chat-compatible",
        capabilityRoutes: {},
        actualExecutionPath: {},
        toolBundle: { specs: [] },
        latencyMs: 100,
        outcome: { id: "outcome-1", finishReason: "stop" },
        outcomeId: "outcome-1",
        requestShape: {},
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

    // 验证关键流程节点被调用
    expect(resolveSessionRuntimeIntentMock).toHaveBeenCalled();
    expect(buildExecutionPlanMock).toHaveBeenCalled();
    // 重构后 handler 通过 executionGateway.executeTurn 执行模型调用
    expect(executeTurnMock).toHaveBeenCalled();
    expect(order).toContain("intent");
    expect(order).toContain("plan");
    expect(order).toContain("execute");
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
