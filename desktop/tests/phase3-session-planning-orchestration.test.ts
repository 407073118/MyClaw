import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "../src/main/services/runtime-context";

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
      return { success: true, output: "tool ok" };
    }
    async shutdown(): Promise<void> {}
    isOutsideWorkspace(): boolean {
      return false;
    }
  },
}));

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

describe("Phase 3 session planning orchestration", () => {
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
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates and updates plan state during session execution when the session has no plan yet", async () => {
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
        { role: "user", content: "Plan the migration" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: "done",
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");

    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: { id: string; runtimeIntent?: typeof runtimeIntent };
    };
    created.session.runtimeIntent = runtimeIntent;

    const response = await sendHandler?.({}, created.session.id, { content: "Plan the migration" }) as {
      session: {
        planState?: {
          tasks: Array<{ title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          title: "Plan the migration",
          status: "completed",
        },
      ],
    });
    expect(response.session.planState?.updatedAt).toBe("2026-04-06T00:00:00.000Z");
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      planState: {
        tasks: [
          {
            title: "Plan the migration",
            status: "completed",
          },
        ],
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    });
  });

  it("emits SessionUpdated with in-progress plan state before the round continues", async () => {
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
    assembleContextMock.mockImplementation((input) => {
      expect(input.session.planState).toMatchObject({
        tasks: [
          {
            title: "Inspect planner state visibility",
            status: "in_progress",
          },
        ],
      });
      return {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "Inspect planner state visibility" },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock.mockResolvedValue({
      content: "done",
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: { id: string; runtimeIntent?: typeof runtimeIntent };
    };
    created.session.runtimeIntent = runtimeIntent;

    await sendHandler?.({}, created.session.id, { content: "Inspect planner state visibility" });

    expect(assembleContextMock).toHaveBeenCalledTimes(1);
    expect(sentStreamEvents).toContainEqual(expect.objectContaining({
      channel: "session:stream",
      payload: expect.objectContaining({
        type: "session.updated",
        sessionId: created.session.id,
        session: expect.objectContaining({
          planState: expect.objectContaining({
            tasks: [
              expect.objectContaining({
                title: "Inspect planner state visibility",
                status: "in_progress",
              }),
            ],
          }),
        }),
      }),
    }));
  });

  it("keeps plan progress alive through a tool round and persists the updated task state", async () => {
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
    assembleContextMock.mockImplementation((input) => {
      expect(input.session.planState?.tasks[0]).toMatchObject({
        id: "task-existing",
        title: "Persist plan progress",
        status: "in_progress",
      });
      return {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "Persist plan progress" },
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
          title: "Persist plan progress",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, { content: "Persist plan progress" }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(assembleContextMock).toHaveBeenCalledTimes(2);
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-existing",
          title: "Persist plan progress",
          status: "completed",
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      planState: {
        tasks: [
          {
            id: "task-existing",
            title: "Persist plan progress",
            status: "completed",
          },
        ],
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    });
  });

  it("creates a fresh task instead of silently reviving a blocked task on a new round", async () => {
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
    assembleContextMock.mockImplementation((input) => {
      expect(input.session.planState).toMatchObject({
        tasks: [
          {
            id: "task-blocked",
            title: "Blocked task",
            status: "blocked",
          },
          {
            title: "Start fresh after blocker",
            status: "in_progress",
          },
        ],
      });
      return {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "Start fresh after blocker" },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock.mockResolvedValue({
      content: "done",
      toolCalls: [],
      finishReason: "stop",
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
          tasks: Array<{ id: string; title: string; status: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-blocked",
          title: "Blocked task",
          status: "blocked",
          blocker: "Waiting for explicit resume",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, { content: "Start fresh after blocker" }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; blocker?: string }>;
        } | null;
      };
    };

    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-blocked",
          title: "Blocked task",
          status: "blocked",
          blocker: "Waiting for explicit resume",
        },
        {
          title: "Start fresh after blocker",
          status: "completed",
        },
      ],
    });
  });

  it("does not overwrite a completed plan task when the final response lands on the safety-ceiling round", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    let callCount = 0;

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
        { role: "user", content: "Finish on the last safe round" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockImplementation(async () => {
      callCount++;
      if (callCount < 200) {
        return {
          content: "",
          toolCalls: [
            {
              id: `tool-call-${callCount}`,
              name: "fs.read",
              argumentsJson: JSON.stringify({ path: `README-${callCount}.md` }),
              input: { path: `README-${callCount}.md` },
            },
          ],
          finishReason: "tool_calls",
        };
      }

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
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: { id: string; runtimeIntent?: typeof runtimeIntent };
    };
    created.session.runtimeIntent = runtimeIntent;

    const response = await sendHandler?.({}, created.session.id, { content: "Finish on the last safe round" }) as {
      session: {
        messages: Array<{ role: string; content: unknown }>;
        planState?: {
          tasks: Array<{ title: string; status: string }>;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(200);
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          title: "Finish on the last safe round",
          status: "completed",
        },
      ],
    });
    expect(response.session.messages).not.toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("安全上限"),
    }));
  });
});
