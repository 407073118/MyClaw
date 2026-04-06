import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequest } from "@shared/contracts";
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

describe("Phase 3 planning benchmarks", () => {
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

  it("freezes sequential multi-step task progression across rounds", async () => {
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
        { role: "user", content: "Continue the next planning step" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
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
          tasks: Array<{ id: string; title: string; status: string; detail?: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "pending",
        },
        {
          id: "task-run-tool",
          title: "Run tool",
          status: "pending",
        },
        {
          id: "task-verify-output",
          title: "Verify output",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    callModelMock.mockResolvedValueOnce({
      content: "step 1 done",
      toolCalls: [],
      finishReason: "stop",
    });

    const firstRound = await sendHandler?.({}, created.session.id, {
      content: "Continue the next planning step",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(firstRound.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "completed",
        },
        {
          id: "task-run-tool",
          title: "Run tool",
          status: "pending",
        },
        {
          id: "task-verify-output",
          title: "Verify output",
          status: "pending",
        },
      ],
    });
    expect(firstRound.session.planState?.tasks[0]?.detail).toContain("Round");
    expect(firstRound.session.planState?.updatedAt).toBe("2026-04-06T00:00:00.000Z");

    vi.setSystemTime(new Date("2026-04-06T00:01:00.000Z"));
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
        content: "step 2 done",
        toolCalls: [],
        finishReason: "stop",
      });
    toolExecuteMock.mockResolvedValueOnce({
      success: true,
      output: "README contents",
    });

    const secondRound = await sendHandler?.({}, created.session.id, {
      content: "Continue the next planning step",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(secondRound.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "completed",
        },
        {
          id: "task-run-tool",
          title: "Run tool",
          status: "completed",
        },
        {
          id: "task-verify-output",
          title: "Verify output",
          status: "pending",
        },
      ],
    });
    expect(secondRound.session.planState?.tasks[0]?.detail).toContain("Round");
    expect(secondRound.session.planState?.tasks[1]?.detail).toContain("Round");
    expect(secondRound.session.planState?.updatedAt).toBe("2026-04-06T00:01:00.000Z");

    vi.setSystemTime(new Date("2026-04-06T00:02:00.000Z"));
    callModelMock.mockResolvedValueOnce({
      content: "step 3 done",
      toolCalls: [],
      finishReason: "stop",
    });

    const thirdRound = await sendHandler?.({}, created.session.id, {
      content: "Continue the next planning step",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(thirdRound.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "completed",
        },
        {
          id: "task-run-tool",
          title: "Run tool",
          status: "completed",
        },
        {
          id: "task-verify-output",
          title: "Verify output",
          status: "completed",
        },
      ],
    });
    expect(thirdRound.session.planState?.tasks.every((task) => task.detail?.includes("Round"))).toBe(true);
    expect(thirdRound.session.planState?.updatedAt).toBe("2026-04-06T00:02:00.000Z");
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      planState: thirdRound.session.planState,
    });
  });

  it("freezes the blocked task path by preserving the blocker and starting a fresh task on same-request retry", async () => {
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
        { role: "user", content: "Inspect missing artifact" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
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
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-investigate-missing-artifact",
          title: "Inspect missing artifact",
          status: "pending",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

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
        content: "Need another route",
        toolCalls: [],
        finishReason: "stop",
      });
    toolExecuteMock.mockResolvedValueOnce({
      success: false,
      output: "",
      error: "File not found",
    });

    const blockedRound = await sendHandler?.({}, created.session.id, {
      content: "Inspect missing artifact",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(blockedRound.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-investigate-missing-artifact",
          title: "Inspect missing artifact",
          status: "blocked",
          blocker: "File not found",
          detail: "Tool failed: fs.read",
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-04-06T00:01:00.000Z"));
    callModelMock.mockResolvedValueOnce({
      content: "Fallback complete",
      toolCalls: [],
      finishReason: "stop",
    });

    const followUpRound = await sendHandler?.({}, created.session.id, {
      content: "Inspect missing artifact",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string; blocker?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(followUpRound.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-investigate-missing-artifact",
          title: "Inspect missing artifact",
          status: "blocked",
          blocker: "File not found",
        },
        {
          title: "Inspect missing artifact",
          status: "completed",
        },
      ],
    });
    expect(followUpRound.session.planState?.tasks[0]?.detail).toContain("Tool failed");
    expect(followUpRound.session.planState?.tasks[1]?.detail).toContain("Round");
    expect(followUpRound.session.planState?.updatedAt).toBe("2026-04-06T00:01:00.000Z");
    expect(followUpRound.session.planState?.tasks[1]?.id).not.toBe("task-investigate-missing-artifact");
  });

  it("freezes the completed task path without rewriting earlier completions", async () => {
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
        { role: "user", content: "Write release summary" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
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
          tasks: Array<{ id: string; title: string; status: string; detail?: string }>;
          updatedAt: string;
        } | null;
      };
    };
    created.session.runtimeIntent = runtimeIntent;
    created.session.planState = {
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "completed",
          detail: "Round completed",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    callModelMock.mockResolvedValueOnce({
      content: "Summary written",
      toolCalls: [],
      finishReason: "stop",
    });

    const response = await sendHandler?.({}, created.session.id, {
      content: "\n\nWrite release summary\nwith supporting notes",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; detail?: string }>;
          updatedAt: string;
        } | null;
      };
    };

    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "completed",
          detail: "Round completed",
        },
        {
          title: "Write release summary",
          status: "completed",
          detail: "Round completed",
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
    expect(response.session.planState?.tasks[1]?.id).not.toBe("task-collect-context");
    expect(saveSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      planState: response.session.planState,
    });
  });
});
