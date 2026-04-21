import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const gatewayExecuteMock = vi.fn();
const {
  loadTurnOutcomeMock,
  updateTurnOutcomeMock,
  backgroundRetrieveMock,
  backgroundCancelMock,
  createExecutionGatewayMock,
  createComputerActionHarnessMock,
  resolveSessionRuntimeIntentMock,
  buildExecutionPlanMock,
} = vi.hoisted(() => ({
  loadTurnOutcomeMock: vi.fn(),
  updateTurnOutcomeMock: vi.fn(() => Promise.resolve()),
  backgroundRetrieveMock: vi.fn(),
  backgroundCancelMock: vi.fn(),
  createExecutionGatewayMock: vi.fn(),
  createComputerActionHarnessMock: vi.fn(),
  resolveSessionRuntimeIntentMock: vi.fn(),
  buildExecutionPlanMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => ipcHandleRegistry.set(channel, handler)) },
  webContents: { getAllWebContents: () => [] },
}));

vi.mock("../../../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: createExecutionGatewayMock,
}));
vi.mock("../../../src/main/services/model-runtime/computer-action-harness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/main/services/model-runtime/computer-action-harness")>();
  return {
    ...actual,
    createComputerActionHarness: createComputerActionHarnessMock,
  };
});
vi.mock("../../../src/main/services/model-runtime/background-task-manager", () => ({
  createBackgroundTaskManager: () => ({
    retrieve: backgroundRetrieveMock,
    cancel: backgroundCancelMock,
  }),
}));

vi.mock("../../../src/main/services/context-assembler", () => ({ assembleContext: vi.fn(() => ({ messages: [{ role: "user", content: "hello" }], budgetUsed: 1, wasCompacted: false, compactionReason: null, removedCount: 0, maskedToolOutputCount: 0, shouldSuggestNewChat: false })) }));
vi.mock("../../../src/main/services/model-capability-resolver", () => ({ resolveModelCapability: vi.fn(() => ({ effective: { supportsReasoning: true, source: "registry" } })) }));
vi.mock("../../../src/main/services/reasoning-runtime", () => ({
  resolveSessionRuntimeIntent: resolveSessionRuntimeIntentMock,
  buildExecutionPlan: buildExecutionPlanMock,
}));
vi.mock("../../../src/main/services/state-persistence", () => ({ saveSession: vi.fn(), saveSiliconPerson: vi.fn(), saveWorkflowRun: vi.fn(), deleteWorkflowRunFile: vi.fn(), deleteSessionFiles: vi.fn() }));
vi.mock("../../../src/main/services/model-runtime/turn-outcome-store", () => ({
  updateTurnOutcome: updateTurnOutcomeMock,
  loadTurnOutcome: loadTurnOutcomeMock,
}));
vi.mock("../../../src/main/services/tool-schemas", () => ({ buildToolSchemas: vi.fn(() => []), functionNameToToolId: vi.fn((name: string) => name), buildToolLabel: vi.fn((name: string) => name) }));
vi.mock("../../../src/main/services/builtin-tool-executor", () => ({ BuiltinToolExecutor: class {
  setSkills() {}
  setAllowExternalPaths() {}
  getBrowserService() {
    return {};
  }
  async shutdown() {}
  isOutsideWorkspace() { return false; }
} }));

import { registerSessionHandlers } from "../../../src/main/ipc/sessions";
import { makeProfile } from "../contracts/test-helpers";

describe("sessions execution gateway", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    gatewayExecuteMock.mockReset();
    loadTurnOutcomeMock.mockReset();
    updateTurnOutcomeMock.mockReset();
    backgroundRetrieveMock.mockReset();
    backgroundCancelMock.mockReset();
    createExecutionGatewayMock.mockReset();
    createComputerActionHarnessMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    createExecutionGatewayMock.mockImplementation(() => ({ executeTurn: gatewayExecuteMock }));
    createComputerActionHarnessMock.mockImplementation((options: any) => ({ ...options }));
    resolveSessionRuntimeIntentMock.mockImplementation((sessionLike?: { runtimeIntent?: Record<string, unknown> | null }) => {
      const runtimeIntent = sessionLike?.runtimeIntent ?? {};
      return {
        reasoningMode: "auto",
        reasoningEffort: (runtimeIntent as { reasoningEffort?: string }).reasoningEffort ?? "medium",
        adapterHint: "auto",
        replayPolicy: "content-only",
        workflowMode: (runtimeIntent as { workflowMode?: string }).workflowMode ?? "default",
        planModeEnabled: (runtimeIntent as { planModeEnabled?: boolean }).planModeEnabled ?? false,
        reasoningEnabled: (runtimeIntent as { reasoningEnabled?: boolean }).reasoningEnabled,
        toolStrategy: (runtimeIntent as { toolStrategy?: string }).toolStrategy,
      };
    });
    buildExecutionPlanMock.mockImplementation((input?: {
      session?: { runtimeIntent?: Record<string, unknown> | null } | null;
      intent?: Record<string, unknown> | null;
    }) => {
      const runtimeIntent = input?.session?.runtimeIntent ?? input?.intent ?? {};
      return {
        runtimeVersion: 1,
        adapterId: "openai-compatible",
        adapterSelectionSource: "profile",
        reasoningMode: "auto",
        reasoningEffort: (runtimeIntent as { reasoningEffort?: string }).reasoningEffort ?? "medium",
        replayPolicy: "content-only",
        fallbackAdapterIds: [],
        planSource: "profile",
        degradationReason: null,
      };
    });
    gatewayExecuteMock.mockResolvedValue({
      content: "assistant reply",
      toolCalls: [],
      finishReason: "stop",
      plan: { providerFamily: "generic-openai-compatible" },
      outcome: { id: "outcome-1" },
    });
  });

  it("routes session model turns through the shared execution gateway", async () => {
    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile()],
        sessions: [{ id: "session-1", title: "Test", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z", messages: [] }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:send-message");
    await handler?.({}, "session-1", { content: "hello", attachedDirectory: null });

    expect(gatewayExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: "canonical",
      plan: expect.objectContaining({
        providerFamily: "generic-openai-compatible",
        protocolTarget: "openai-chat-compatible",
      }),
      content: expect.objectContaining({
        systemSections: expect.any(Array),
      }),
      toolSpecs: [],
    }));
  });

  it("passes previousResponseId into canonical execution when server-state continuation is enabled", async () => {
    loadTurnOutcomeMock.mockReturnValue({
      id: "turn-1",
      responseId: "resp_prev_123",
    });
    gatewayExecuteMock.mockResolvedValue({
      content: "assistant reply",
      toolCalls: [],
      finishReason: "stop",
      plan: { providerFamily: "openai-native", protocolTarget: "openai-responses" },
      outcome: { id: "outcome-2", responseId: "resp_456" },
    });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          baseUrl: "https://api.openai.com/v1",
          responsesApiConfig: {
            useServerState: true,
          },
        })],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [],
          lastTurnOutcomeId: "turn-1",
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:send-message");
    await handler?.({}, "session-1", { content: "hello", attachedDirectory: null });

    expect(loadTurnOutcomeMock).toHaveBeenCalledWith(ctx.runtime.paths, "turn-1");
    expect(gatewayExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
      previousResponseId: "resp_prev_123",
      plan: expect.objectContaining({
        protocolTarget: "openai-responses",
      }),
    }));
  });

  it("keeps the active turn on its original reasoning effort when the session setting changes mid-run", async () => {
    let resolveFirstTurn!: (value: {
      content: string;
      reasoning?: string;
      toolCalls: Array<{ id: string; name: string; argumentsJson: string; input: Record<string, unknown> }>;
      finishReason: string;
      plan: { providerFamily: string; protocolTarget: string };
      outcome: { id: string };
    }) => void;
    const firstTurnPromise = new Promise<{
      content: string;
      reasoning?: string;
      toolCalls: Array<{ id: string; name: string; argumentsJson: string; input: Record<string, unknown> }>;
      finishReason: string;
      plan: { providerFamily: string; protocolTarget: string };
      outcome: { id: string };
    }>((resolve) => {
      resolveFirstTurn = resolve;
    });

    gatewayExecuteMock
      .mockImplementationOnce(() => firstTurnPromise)
      .mockResolvedValueOnce({
        content: "done",
        toolCalls: [],
        finishReason: "stop",
        plan: { providerFamily: "generic-openai-compatible", protocolTarget: "openai-chat-compatible" },
        outcome: { id: "outcome-2" },
      });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile()],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [],
          runtimeIntent: {
            reasoningEffort: "medium",
          },
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const sendMessageHandler = ipcHandleRegistry.get("session:send-message");
    const updateRuntimeIntentHandler = ipcHandleRegistry.get("session:update-runtime-intent");

    const sendPromise = sendMessageHandler?.({}, "session-1", {
      content: "inspect tasks",
      attachedDirectory: null,
    });

    await vi.waitFor(() => expect(gatewayExecuteMock).toHaveBeenCalledTimes(1));

    await expect(updateRuntimeIntentHandler?.({}, "session-1", {
      reasoningEffort: "xhigh",
    })).resolves.toEqual(expect.objectContaining({
      session: expect.objectContaining({
        runtimeIntent: expect.objectContaining({
          reasoningEffort: "xhigh",
        }),
      }),
    }));

    resolveFirstTurn({
      content: "",
      reasoning: "need to inspect tasks",
      toolCalls: [
        { id: "tool-1", name: "task.list", argumentsJson: "{}", input: {} },
      ],
      finishReason: "tool_calls",
      plan: { providerFamily: "generic-openai-compatible", protocolTarget: "openai-chat-compatible" },
      outcome: { id: "outcome-1" },
    });

    await expect(sendPromise).resolves.toEqual(expect.objectContaining({
      session: expect.objectContaining({
        runtimeIntent: expect.objectContaining({
          reasoningEffort: "xhigh",
        }),
      }),
    }));

    expect(gatewayExecuteMock).toHaveBeenCalledTimes(2);
    expect(gatewayExecuteMock.mock.calls[0]?.[0]?.plan?.reasoningEffort).toBe("medium");
    expect(gatewayExecuteMock.mock.calls[1]?.[0]?.plan?.reasoningEffort).toBe("medium");
  });

  it("keeps the session clean when a turn is handed off to background execution", async () => {
    gatewayExecuteMock.mockResolvedValueOnce({
      content: "",
      toolCalls: [],
      finishReason: "background",
      backgroundTask: {
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "queued",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
      },
      plan: { providerFamily: "openai-native", protocolTarget: "openai-responses" },
      outcome: {
        id: "turn-background-1",
        backgroundTask: {
          id: "resp_background_1",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          providerResponseId: "resp_background_1",
          status: "queued",
          pollAfterMs: 2000,
          startedAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
        },
      },
    });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
        })],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [],
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:send-message");
    const result = await handler?.({}, "session-1", { content: "research this", attachedDirectory: null });

    expect(result).toEqual({
      session: expect.objectContaining({
        id: "session-1",
        lastTurnOutcomeId: "turn-background-1",
        backgroundTask: expect.objectContaining({
          status: "queued",
        }),
      }),
    });
    expect(ctx.state.sessions[0]?.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "research this",
      }),
    ]);
  });

  it("polls the latest background task for a session and writes the refreshed handle back to turn outcomes", async () => {
    loadTurnOutcomeMock.mockReturnValue({
      id: "turn-1",
      backgroundTask: {
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "queued",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
      },
    });
    backgroundRetrieveMock.mockResolvedValue({
      id: "resp_background_1",
      status: "in_progress",
      outputText: "",
      task: {
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "in_progress",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:01:00.000Z",
      },
    });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
        })],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [],
          lastTurnOutcomeId: "turn-1",
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:poll-background-task");
    const result = await handler?.({}, "session-1");

    expect(backgroundRetrieveMock).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        baseUrl: "https://api.openai.com/v1",
      }),
      task: expect.objectContaining({
        providerResponseId: "resp_background_1",
      }),
    }));
    expect(updateTurnOutcomeMock).toHaveBeenCalledWith(ctx.runtime.paths, expect.objectContaining({
      id: "turn-1",
      backgroundTask: expect.objectContaining({
        status: "in_progress",
      }),
    }));
    expect(result).toEqual({
      outcomeId: "turn-1",
      task: expect.objectContaining({
        status: "in_progress",
      }),
      status: "in_progress",
      outputText: "",
      session: expect.objectContaining({
        id: "session-1",
        backgroundTask: expect.objectContaining({
          status: "in_progress",
        }),
      }),
    });
  });

  it("routes risky native computer actions through the shared approval flow before execution", async () => {
    let approvalRequests: Array<Record<string, unknown>> = [];

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
        })],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [],
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => approvalRequests,
        setApprovalRequests: (next: Array<Record<string, unknown>>) => { approvalRequests = next; },
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const sendMessageHandler = ipcHandleRegistry.get("session:send-message");
    await sendMessageHandler?.({}, "session-1", { content: "start computer loop", attachedDirectory: null });

    expect(createComputerActionHarnessMock).toHaveBeenCalledTimes(1);
    const harnessOptions = createComputerActionHarnessMock.mock.calls[0]?.[0] as {
      requestApproval?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const approvalPromise = harnessOptions.requestApproval?.({
      sessionId: "session-1",
      callId: "cc_approval_1",
      actionIndex: 0,
      action: {
        type: "click",
        x: 512,
        y: 288,
      },
    });

    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]).toMatchObject({
      sessionId: "session-1",
      toolId: "computer.click",
      source: "builtin-tool",
      risk: "write",
    });

    await Promise.resolve();
    const resolveHandler = ipcHandleRegistry.get("session:resolve-approval");
    await expect(resolveHandler?.({}, approvalRequests[0]?.id, "allow-once")).resolves.toEqual({
      success: true,
    });

    await expect(approvalPromise).resolves.toEqual(expect.objectContaining({
      approved: true,
    }));
    expect(approvalRequests).toEqual([]);
  });

  it("batches read-only tool approvals so independent requests appear together", async () => {
    let approvalRequests: Array<Record<string, unknown>> = [];

    gatewayExecuteMock
      .mockResolvedValueOnce({
        content: "",
        reasoning: "need to inspect tasks",
        toolCalls: [
          { id: "tool-1", name: "task.list", argumentsJson: "{}", input: {} },
          { id: "tool-2", name: "task.get", argumentsJson: "{\"id\":\"task-1\"}", input: { id: "task-1" } },
        ],
        finishReason: "tool_calls",
        plan: { providerFamily: "generic-openai-compatible", protocolTarget: "openai-chat-compatible" },
        outcome: { id: "outcome-1" },
      })
      .mockResolvedValueOnce({
        content: "done",
        toolCalls: [],
        finishReason: "stop",
        plan: { providerFamily: "generic-openai-compatible", protocolTarget: "openai-chat-compatible" },
        outcome: { id: "outcome-2" },
      });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile()],
        sessions: [{ id: "session-1", title: "Test", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z", messages: [] }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: false, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => approvalRequests,
        setApprovalRequests: (next: Array<Record<string, unknown>>) => { approvalRequests = next; },
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const sendMessageHandler = ipcHandleRegistry.get("session:send-message");
    const sendPromise = sendMessageHandler?.({}, "session-1", { content: "inspect tasks", attachedDirectory: null });

    await vi.waitFor(() => expect(approvalRequests).toHaveLength(2));
    expect(approvalRequests.map((request) => request.toolId)).toEqual(["task.list", "task.get"]);

    const resolveHandler = ipcHandleRegistry.get("session:resolve-approval");
    await expect(resolveHandler?.({}, approvalRequests[0]?.id, "allow-once")).resolves.toEqual({ success: true });
    await expect(resolveHandler?.({}, approvalRequests[1]?.id, "allow-once")).resolves.toEqual({ success: true });

    await expect(sendPromise).resolves.toEqual(expect.objectContaining({
      session: expect.objectContaining({ id: "session-1" }),
    }));
  });

  it("replays completed background output back into the session transcript", async () => {
    loadTurnOutcomeMock.mockReturnValue({
      id: "turn-1",
      backgroundTask: {
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "in_progress",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:01:00.000Z",
      },
      capabilityEvents: [
        {
          type: "background_response_started",
          capabilityId: "research-task",
          createdAt: "2026-04-14T00:00:00.000Z",
          payload: {
            responseId: "resp_background_1",
          },
        },
      ],
      citations: [],
    });
    backgroundRetrieveMock.mockResolvedValue({
      id: "resp_background_1",
      status: "completed",
      outputText: "Deep research answer",
      task: {
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "completed",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:03:00.000Z",
      },
      result: {
        content: "Deep research answer",
        reasoning: undefined,
        toolCalls: [],
        finishReason: "stop",
        usage: undefined,
        responseId: "resp_background_1",
        requestVariantId: null,
        fallbackReason: null,
        retryCount: 0,
        fallbackEvents: [],
        citations: [
          {
            id: "cite-1",
            url: "https://openai.com/index/introducing-gpt-5-2-codex/",
            title: "Introducing GPT-5.2-Codex",
            domain: "openai.com",
            snippet: "Deep research",
            startIndex: 0,
            endIndex: 13,
            sourceType: "vendor-web-search",
            traceRef: "ws_1",
          },
        ],
        capabilityEvents: [
          {
            type: "web_search_call",
            capabilityId: "search",
            createdAt: "2026-04-14T00:03:00.000Z",
            payload: {
              traceId: "ws_1",
            },
          },
        ],
        backgroundTask: null,
      },
    });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
        })],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [
            {
              id: "user-1",
              role: "user",
              content: "research this",
              createdAt: "2026-04-14T00:00:00.000Z",
            },
          ],
          lastTurnOutcomeId: "turn-1",
          backgroundTask: {
            id: "resp_background_1",
            providerFamily: "openai-native",
            protocolTarget: "openai-responses",
            providerResponseId: "resp_background_1",
            status: "in_progress",
            pollAfterMs: 2000,
            startedAt: "2026-04-14T00:00:00.000Z",
            updatedAt: "2026-04-14T00:01:00.000Z",
          },
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:poll-background-task");
    const result = await handler?.({}, "session-1");

    expect(updateTurnOutcomeMock).toHaveBeenCalledWith(ctx.runtime.paths, expect.objectContaining({
      id: "turn-1",
      backgroundTask: null,
      citations: expect.arrayContaining([
        expect.objectContaining({
          id: "cite-1",
        }),
      ]),
      capabilityEvents: expect.arrayContaining([
        expect.objectContaining({
          type: "background_response_started",
        }),
        expect.objectContaining({
          type: "web_search_call",
        }),
      ]),
      finishReason: "stop",
      responseId: "resp_background_1",
    }));
    expect(ctx.state.sessions[0]).toEqual(expect.objectContaining({
      backgroundTask: null,
    }));
    expect(ctx.state.sessions[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: "Deep research answer",
      }),
    ]));
    expect(result).toEqual({
      outcomeId: "turn-1",
      task: null,
      status: "completed",
      outputText: "Deep research answer",
      session: expect.objectContaining({
        id: "session-1",
        backgroundTask: null,
        lastTurnCitations: expect.arrayContaining([
          expect.objectContaining({
            id: "cite-1",
          }),
        ]),
        lastCapabilityEvents: expect.arrayContaining([
          expect.objectContaining({
            type: "background_response_started",
          }),
          expect.objectContaining({
            type: "web_search_call",
          }),
        ]),
      }),
    });
  });
});
