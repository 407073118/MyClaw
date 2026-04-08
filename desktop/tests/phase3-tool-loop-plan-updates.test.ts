import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventType, type ApprovalRequest } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const sentStreamEvents: Array<{ channel: string; payload: unknown }> = [];

const callModelMock = vi.fn();
const assembleContextMock = vi.fn();
const resolveModelCapabilityMock = vi.fn();
const resolveSessionRuntimeIntentMock = vi.fn();
const buildExecutionPlanMock = vi.fn();
const saveSessionMock = vi.fn();
const toolExecuteMock = vi.fn();

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
    async execute(): Promise<{ success: boolean; output: string; error?: string }> {
      return toolExecuteMock();
    }
    async shutdown(): Promise<void> {}
    isOutsideWorkspace(): boolean {
      return false;
    }
  },
}));

function buildContext(): RuntimeContext {
  const approvalPolicy = {
    mode: "prompt" as const,
    autoApproveReadOnly: true,
    autoApproveSkills: true,
    alwaysAllowedTools: [] as string[],
  };
  let approvalRequests: ApprovalRequest[] = [];

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
      getApprovals: () => approvalPolicy,
      getApprovalRequests: () => approvalRequests,
      setApprovalRequests: (requests) => {
        approvalRequests = requests;
      },
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

const runtimeIntent = {
  reasoningMode: "auto" as const,
  reasoningEnabled: false,
  reasoningEffort: "high" as const,
  adapterHint: "br-minimax" as const,
  replayPolicy: "assistant-turn" as const,
  toolStrategy: "auto" as const,
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
  degradationReason: null,
  planSource: "capability",
  fallbackAdapterIds: ["openai-compatible"],
};

describe("Phase 3 tool loop plan updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T00:00:00.000Z"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ipcHandleRegistry.clear();
    sentStreamEvents.length = 0;
    callModelMock.mockReset();
    assembleContextMock.mockReset();
    resolveModelCapabilityMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    saveSessionMock.mockReset();
    toolExecuteMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("advances the active plan task after a successful tool round", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    let assembleCallCount = 0;

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockImplementation((input) => {
      assembleCallCount += 1;
      return {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "Advance task with tool success" },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "fs.read",
            argumentsJson: "{\"path\":\"README.md\"}",
            input: { path: "README.md" },
          },
        ],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "done",
        toolCalls: [],
        finishReason: "stop",
      });
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: "README contents",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-existing",
          title: "Advance task with tool success",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Advance task with tool success",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(assembleCallCount).toBe(2);
    expect(sentStreamEvents).toContainEqual(expect.objectContaining({
      channel: "session:stream",
      payload: expect.objectContaining({
        type: "session.updated",
        sessionId: created.session.id,
        session: expect.objectContaining({
          planState: expect.objectContaining({
            tasks: [
              expect.objectContaining({
                id: "task-existing",
                status: "in_progress",
                detail: expect.any(String),
              }),
            ],
          }),
        }),
      }),
    }));
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-existing",
          title: "Advance task with tool success",
          status: "completed",
          detail: expect.any(String),
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
    expect(response.session.planState?.tasks[0]?.blocker).toBeUndefined();
  });

  it("preserves blocked plan state across the next loop round and final assistant turn after a tool failure", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    let assembleCallCount = 0;
    let secondRoundPlanSnapshot: unknown;

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockImplementation((input) => {
      assembleCallCount += 1;
      if (assembleCallCount === 2) {
        secondRoundPlanSnapshot = JSON.parse(JSON.stringify(input.session.planState));
      }

      return {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "Handle tool failure" },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "fs.read",
            argumentsJson: "{\"path\":\"missing.md\"}",
            input: { path: "missing.md" },
          },
        ],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "recovered",
        toolCalls: [],
        finishReason: "stop",
      });
    toolExecuteMock.mockResolvedValue({
      success: false,
      output: "",
      error: "File not found",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-existing",
          title: "Handle tool failure",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Handle tool failure",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(assembleCallCount).toBe(2);
    expect(secondRoundPlanSnapshot).toMatchObject({
      tasks: [
        {
          id: "task-existing",
          title: "Handle tool failure",
          status: "blocked",
          blocker: "File not found",
          detail: expect.any(String),
        },
      ],
    });
    expect(sentStreamEvents).toContainEqual(expect.objectContaining({
      channel: "session:stream",
      payload: expect.objectContaining({
        type: "session.updated",
        sessionId: created.session.id,
        session: expect.objectContaining({
          planState: expect.objectContaining({
            tasks: [
              expect.objectContaining({
                id: "task-existing",
                status: "blocked",
                detail: expect.any(String),
                blocker: "File not found",
              }),
            ],
          }),
        }),
      }),
    }));
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-existing",
          title: "Handle tool failure",
          status: "blocked",
          blocker: "File not found",
          detail: expect.any(String),
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
  });

  it("keeps the persisted plan state structurally valid after tool-loop progress updates", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "Keep plan shape valid" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "fs.read",
            argumentsJson: "{\"path\":\"README.md\"}",
            input: { path: "README.md" },
          },
        ],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "done",
        toolCalls: [],
        finishReason: "stop",
      });
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: "README contents",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-structured",
          title: "Keep plan shape valid",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Keep plan shape valid",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-structured",
          title: "Keep plan shape valid",
          status: "completed",
          detail: expect.any(String),
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
    expect(() => JSON.parse(JSON.stringify(response.session.planState))).not.toThrow();
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      planState: {
        tasks: [
          {
            id: "task-structured",
            title: "Keep plan shape valid",
            status: "completed",
            detail: expect.any(String),
          },
        ],
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    });
  });

  it("marks the task blocked when a tool is denied", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    ctx.state.getApprovals().autoApproveReadOnly = false;

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "Denied tool round" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool-call-denied",
            name: "fs.write",
            argumentsJson: "{\"path\":\"README.md\",\"content\":\"hi\"}",
            input: { path: "README.md", content: "hi" },
          },
        ],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "cannot continue",
        toolCalls: [],
        finishReason: "stop",
      });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const resolveApprovalHandler = ipcHandleRegistry.get("session:resolve-approval");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-denied",
          title: "Denied tool round",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const responsePromise = sendHandler?.({}, created.session.id, {
      content: "Denied tool round",
    }) as Promise<{
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    }>;

    await vi.waitFor(() => {
      expect(ctx.state.getApprovalRequests()).toHaveLength(1);
    });
    const approvalRequest = ctx.state.getApprovalRequests()[0] as { id: string };
    await resolveApprovalHandler?.({}, approvalRequest.id, "deny");

    const response = await responsePromise;

    expect(toolExecuteMock).not.toHaveBeenCalled();
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-denied",
          title: "Denied tool round",
          status: "blocked",
          blocker: expect.stringContaining("用户拒绝"),
          detail: expect.any(String),
        },
      ],
      updatedAt: expect.any(String),
    });
  });

  it("cancels an approval wait without turning it into deny or blocked semantics", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    ctx.state.getApprovals().autoApproveReadOnly = false;

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "Cancel approval wait" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValueOnce({
      content: "",
      toolCalls: [
        {
          id: "tool-call-cancel",
          name: "fs.write",
          argumentsJson: "{\"path\":\"README.md\",\"content\":\"hi\"}",
          input: { path: "README.md", content: "hi" },
        },
      ],
      finishReason: "tool_calls",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const cancelHandler = ipcHandleRegistry.get("session:cancel-run");
    const created = await createHandler?.({}, { title: "Phase 3 Cancel" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent;
        planModeState?: {
          mode: string;
          approvalStatus: string;
          planVersion: number;
        } | null;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planModeState = {
      mode: "executing",
      approvalStatus: "approved",
      planVersion: 1,
    };
    created.session.planState = {
      tasks: [
        {
          id: "task-cancel",
          title: "Cancel approval wait",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const responsePromise = sendHandler?.({}, created.session.id, {
      content: "Cancel approval wait",
    }) as Promise<{
      session: {
        planModeState?: {
          mode: string;
          blockedReason?: string;
        } | null;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    }>;

    await vi.waitFor(() => {
      expect(ctx.state.getApprovalRequests()).toHaveLength(1);
      expect(ctx.state.activeSessionRuns.get(created.session.id)?.pendingApprovalIds).toHaveLength(1);
    });

    const run = ctx.state.activeSessionRuns.get(created.session.id);
    const cancelResult = await cancelHandler?.({}, created.session.id, { runId: run?.runId }) as {
      success: boolean;
      state: string;
    };

    expect(cancelResult).toEqual({
      success: true,
      state: "canceling",
    });

    const response = await responsePromise;

    expect(toolExecuteMock).not.toHaveBeenCalled();
    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(response.session.planModeState).toMatchObject({
      mode: "canceled",
    });
    expect(response.session.planState?.tasks[0]).toMatchObject({
      id: "task-cancel",
      title: "Cancel approval wait",
    });
    expect(response.session.planState?.tasks[0]?.status).not.toBe("blocked");
    expect(response.session.planState?.tasks[0]?.blocker).toBeUndefined();
    expect(ctx.state.getApprovalRequests()).toHaveLength(0);
    expect(ctx.state.activeSessionRuns.has(created.session.id)).toBe(false);

    const runtimeStatuses = sentStreamEvents
      .map((event) => event.payload)
      .filter((payload): payload is { type: string; status?: string } => {
        return typeof payload === "object" && payload !== null && "type" in payload;
      })
      .filter((payload) => payload.type === EventType.RuntimeStatus)
      .map((payload) => payload.status);

    expect(runtimeStatuses).toEqual(expect.arrayContaining([
      "canceling",
      "canceled",
    ]));
  });

  it("marks the task blocked when loop detection stops repeated tool rounds", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "Loop stop round" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: "",
      toolCalls: [
        {
          id: "tool-call-loop",
          name: "fs.read",
          argumentsJson: "{\"path\":\"README.md\"}",
          input: { path: "README.md" },
        },
      ],
      finishReason: "tool_calls",
    });
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: "README contents",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-loop",
          title: "Loop stop round",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Loop stop round",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(5);
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-loop",
          title: "Loop stop round",
          status: "blocked",
          blocker: expect.stringContaining("tool loop"),
          detail: expect.any(String),
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
  });
});
