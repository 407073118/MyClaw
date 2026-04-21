import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRuntimeIntent } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();

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
    getAllWebContents: () => [],
  },
}));

vi.mock("../src/main/services/model-client", () => ({
  callModel: callModelMock,
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
vi.mock("../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: vi.fn(() => ({ executeTurn: executeTurnMock })),
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

/** 构造最小 RuntimeContext，专门用于验证 session 主链路是否接上 execution plan。 */
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

describe("phase1 session runtime integration", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    callModelMock.mockReset();
    assembleContextMock.mockReset();
    resolveModelCapabilityMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    saveSessionMock.mockReset();
    executeTurnMock.mockReset();
  });

  it("exposes activeSessionRuns as a session-scoped in-flight registry", () => {
    const ctx = buildContext();
    const registry = ctx.state.activeSessionRuns;

    expect(registry).toBeInstanceOf(Map);

    const runState = {
      runId: "run-1",
      abortController: new AbortController(),
      status: "running" as const,
      phase: "model" as const,
      currentMessageId: "msg-1",
      pendingApprovalIds: ["approval-1"],
      cancelRequested: false,
    };

    registry?.set("session-1", runState);
    expect(registry?.get("session-1")).toMatchObject({
      runId: "run-1",
      status: "running",
      phase: "model",
    });

    registry?.delete("session-1");
    expect(registry?.has("session-1")).toBe(false);
  });

  it("creates sessions with runtimeVersion and passes execution plans to callModel", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    const order: string[] = [];
    const seededRuntimeIntent: SessionRuntimeIntent = {
      reasoningEffort: "medium",
      adapterHint: "auto",
      replayPolicy: "assistant-turn-with-reasoning",
      toolStrategy: "auto",
    };
    const runtimeIntent = {
      reasoningMode: "auto",
      reasoningEnabled: true,
      reasoningEffort: "medium",
      adapterHint: "auto",
      replayPolicy: "assistant-turn-with-reasoning",
      toolStrategy: "auto",
    };
    const executionPlan = {
      runtimeVersion: 1,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn-with-reasoning",
      fallbackAdapterIds: ["openai-compatible"],
      adapterHint: "auto",
    };

    resolveSessionRuntimeIntentMock.mockImplementation(() => {
      order.push("intent");
      return runtimeIntent;
    });
    resolveModelCapabilityMock.mockImplementation(() => {
      order.push("capability");
      return {
        effective: {
          supportsReasoning: true,
          source: "registry",
        },
      };
    });
    assembleContextMock.mockImplementation((input) => {
      order.push("context");
      expect(input).toMatchObject({
        executionPlan: expect.objectContaining({
          adapterId: "br-minimax",
          replayPolicy: "assistant-turn-with-reasoning",
        }),
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
    buildExecutionPlanMock.mockImplementation((input) => {
      order.push("plan");
      expect(input).toMatchObject({
        session: {
          runtimeIntent: seededRuntimeIntent,
        },
        profile: expect.objectContaining({
          id: "profile-1",
        }),
        capability: expect.objectContaining({
          supportsReasoning: true,
        }),
      });
      return executionPlan;
    });
    callModelMock.mockImplementation(async (input) => {
      order.push("execute");
      return {
        content: "done",
        toolCalls: [],
        finishReason: "stop",
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

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");

    expect(createHandler).toBeTypeOf("function");
    expect(sendHandler).toBeTypeOf("function");

    const created = await createHandler?.({}, { title: "Phase 1" }) as {
      session: {
        id: string;
        runtimeVersion?: number;
      };
    };
    const storedSession = ctx.state.sessions.find((session) => session.id === created.session.id);

    expect(storedSession).toBeDefined();
    if (!storedSession) {
      throw new Error("Expected created session to be stored in ctx.state.sessions");
    }
    storedSession.runtimeIntent = seededRuntimeIntent;

    expect(created.session.runtimeVersion).toBe(1);

    const response = await sendHandler?.({}, created.session.id, { content: "hello" }) as {
      session: { runtimeVersion?: number; messages: Array<{ role: string; content: unknown }> };
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
    expect(response.session.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "done",
    });
  });

});
