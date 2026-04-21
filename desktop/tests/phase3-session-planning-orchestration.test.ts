import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "../src/main/services/runtime-context";
import { PLAN_MODE_STATE_VALUES } from "@shared/contracts";

const ORCHESTRATION_TEST_TIMEOUT_MS = 20000;

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const sentStreamEvents: Array<{ channel: string; payload: unknown }> = [];

const callModelMock = vi.fn();
const assembleContextMock = vi.fn();
const resolveModelCapabilityMock = vi.fn();
const resolveSessionRuntimeIntentMock = vi.fn();
const buildExecutionPlanMock = vi.fn();
const saveSessionMock = vi.fn();
const saveWorkflowRunMock = vi.fn();
const deleteWorkflowRunFileMock = vi.fn();

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
  saveWorkflowRun: saveWorkflowRunMock,
  deleteWorkflowRunFile: deleteWorkflowRunFileMock,
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
        baseUrl: "http://api-cybotforge-pre.brapp.com",
        apiKey: "test-key",
        model: "minimax-m2-5",
      }],
      sessions: [],
      employees: [],
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
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
    saveWorkflowRunMock.mockReset();
    deleteWorkflowRunFileMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("includes canceled in the plan mode state vocabulary for explicit user stops", () => {
    expect(PLAN_MODE_STATE_VALUES).toEqual(expect.arrayContaining([
      "canceled",
    ]));
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
  }, ORCHESTRATION_TEST_TIMEOUT_MS);

  it("registers plan mode approval handlers and parks the session in awaiting approval before execution", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "analysis",
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "planner system" },
        { role: "user", content: "Plan the rollout" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: JSON.stringify({
        goal: "Plan the rollout",
        summary: "Draft a visible plan before execution",
        steps: [
          { id: "step-collect-context", title: "Collect context", kind: "analysis" },
          { id: "step-apply-change", title: "Apply change", kind: "tool" },
        ],
        acceptanceCriteria: [
          "User approves the plan before execution",
        ],
      }),
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    expect(ipcHandleRegistry.has("session:approve-plan")).toBe(true);
    expect(ipcHandleRegistry.has("session:revise-plan")).toBe(true);
    expect(ipcHandleRegistry.has("session:cancel-plan-mode")).toBe(true);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");

    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: { id: string; runtimeIntent?: Record<string, unknown> };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Plan the rollout",
    }) as {
      session: {
        planModeState?: {
          mode: string;
          approvalStatus: string;
        } | null;
        planState?: {
          tasks: Array<{ id: string; title: string; status: string }>;
        } | null;
      };
    };

    expect(response.session.planModeState).toMatchObject({
      mode: "awaiting_approval",
      approvalStatus: "pending",
    });
    expect(response.session.planState?.tasks).toEqual([
      expect.objectContaining({
        id: "step-collect-context",
        title: "Collect context",
        status: "pending",
      }),
      expect.objectContaining({
        id: "step-apply-change",
        title: "Apply change",
        status: "pending",
      }),
    ]);
    expect(callModelMock).toHaveBeenCalledTimes(1);
  });

  it("adds explicit planner guidance so plan mode analysis returns a structured JSON plan", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "analysis",
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "planner system" },
        { role: "user", content: "Plan the rollout" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: JSON.stringify({
        goal: "Plan the rollout",
        steps: [
          { id: "step-collect-context", title: "Collect context", kind: "analysis", lane: "planner" },
          { id: "step-apply-change", title: "Apply change", kind: "tool", lane: "implementer" },
        ],
      }),
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: { id: string; runtimeIntent?: Record<string, unknown> };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };

    await sendHandler?.({}, created.session.id, {
      content: "Plan the rollout",
    });

    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(callModelMock.mock.calls[0]?.[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Return strict JSON"),
      }),
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("\"lane\""),
      }),
    ]));
  });

  it("skips approved confirmation steps and runs the next executable step", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "execution",
    });
    assembleContextMock.mockImplementation((input) => {
      expect(input.session.planState).toMatchObject({
        tasks: [
          {
            id: "step-confirm",
            status: "completed",
            kind: "user_confirmation",
          },
          {
            id: "step-apply",
            status: "in_progress",
            kind: "tool",
          },
        ],
      });
      return {
        messages: [
          { role: "system", content: "planner system" },
          { role: "user", content: "Execute approved plan" },
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
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent & {
          workflowMode?: "plan";
          planModeEnabled?: boolean;
        };
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string }>;
          updatedAt: string;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
          planVersion: number;
        } | null;
      };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };
    created.session.planModeState = {
      mode: "executing",
      approvalStatus: "approved",
      planVersion: 1,
    };
    created.session.planState = {
      tasks: [
        {
          id: "step-confirm",
          title: "Confirm the rollout",
          status: "pending",
          kind: "user_confirmation",
        },
        {
          id: "step-apply",
          title: "Apply the rollout",
          status: "pending",
          kind: "tool",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Execute approved plan",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string }>;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "step-confirm",
          status: "completed",
          kind: "user_confirmation",
        },
        {
          id: "step-apply",
          status: "completed",
          kind: "tool",
        },
      ],
    });
  });

  it("injects the current executing step into runtime context before the model round starts", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "execution",
    });
    assembleContextMock.mockImplementation((input) => {
      expect(input.session.planModeState).toMatchObject({
        currentTaskId: "step-apply",
        currentTaskTitle: "Apply the rollout",
        currentTaskKind: "tool",
      });
      return {
        messages: [
          { role: "system", content: "planner system" },
          { role: "user", content: "Execute approved plan" },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock.mockResolvedValue({
      content: "Applied the rollout",
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent & {
          workflowMode?: "plan";
          planModeEnabled?: boolean;
        };
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string; lane?: string }>;
          updatedAt: string;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
          planVersion: number;
        } | null;
      };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };
    created.session.planModeState = {
      mode: "executing",
      approvalStatus: "approved",
      planVersion: 1,
    };
    created.session.planState = {
      tasks: [
        {
          id: "step-apply",
          title: "Apply the rollout",
          status: "pending",
          kind: "tool",
          lane: "implementer",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    await sendHandler?.({}, created.session.id, {
      content: "Execute approved plan",
    });

    expect(callModelMock).toHaveBeenCalledTimes(1);
    expect(callModelMock.mock.calls[0]?.[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Current plan step"),
      }),
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Apply the rollout"),
      }),
    ]));
  });

  it("materializes parallel workstreams and a workflow-style run summary for complex plans", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "analysis",
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "planner system" },
        { role: "user", content: "Plan the rollout" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: JSON.stringify({
        goal: "Plan the rollout",
        summary: "Use visible tracks for a complex task",
        steps: [
          { id: "step-analyze", title: "Analyze the request", kind: "analysis", lane: "planner" },
          { id: "step-implement", title: "Implement the change", kind: "tool", lane: "implementer" },
          { id: "step-verify", title: "Verify the change", kind: "verification", lane: "verifier" },
        ],
      }),
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: { id: string; runtimeIntent?: Record<string, unknown> };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Plan the rollout",
    }) as {
      session: {
        planModeState?: {
          workflowRun?: {
            status: string;
            currentNodeIds: string[];
          } | null;
          workstreams?: Array<{ id: string; label: string; status: string; stepIds: string[] }>;
        } | null;
      };
    };

    expect(response.session.planModeState?.workstreams).toEqual([
      expect.objectContaining({
        id: "planner",
        stepIds: ["step-analyze"],
      }),
      expect.objectContaining({
        id: "implementer",
        stepIds: ["step-implement"],
      }),
      expect.objectContaining({
        id: "verifier",
        stepIds: ["step-verify"],
      }),
    ]);
    expect(response.session.planModeState?.workflowRun).toMatchObject({
      status: "queued",
      currentNodeIds: ["step-analyze", "step-implement", "step-verify"],
    });
  });

  it("persists the synthesized workflow-style run when plan mode produces a complex draft", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "analysis",
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "planner system" },
        { role: "user", content: "Plan the rollout" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: JSON.stringify({
        goal: "Plan the rollout",
        summary: "Use visible tracks for a complex task",
        steps: [
          { id: "step-analyze", title: "Analyze the request", kind: "analysis", lane: "planner" },
          { id: "step-implement", title: "Implement the change", kind: "tool", lane: "implementer" },
          { id: "step-verify", title: "Verify the change", kind: "verification", lane: "verifier" },
        ],
      }),
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);
    saveWorkflowRunMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: { id: string; runtimeIntent?: Record<string, unknown> };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };

    await sendHandler?.({}, created.session.id, {
      content: "Plan the rollout",
    });

    expect(saveWorkflowRunMock).toHaveBeenCalledTimes(1);
    expect(saveWorkflowRunMock.mock.calls[0]?.[1]).toMatchObject({
      workflowId: created.session.id,
      status: "queued",
      currentNodeIds: ["step-analyze", "step-implement", "step-verify"],
    });
  });

  it("marks the session workflow-style run as canceled when plan mode is canceled", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    saveSessionMock.mockResolvedValue(undefined);
    saveWorkflowRunMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const cancelHandler = ipcHandleRegistry.get("session:cancel-plan-mode");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: {
        id: string;
        runtimeIntent?: Record<string, unknown>;
        planModeState?: Record<string, unknown> | null;
      };
    };

    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };
    created.session.planModeState = {
      mode: "executing",
      workflowMode: "plan",
      approvalStatus: "approved",
      planVersion: 2,
      workflowRun: {
        id: `plan-run-${created.session.id}`,
        workflowId: created.session.id,
        workflowVersion: 2,
        status: "running",
        currentNodeIds: ["step-implement"],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:05:00.000Z",
      },
    };

    const response = await cancelHandler?.({}, created.session.id) as {
      session: {
        planModeState?: unknown;
        planState?: unknown;
      };
    };

    expect(response.session.planModeState).toBeNull();
    expect(response.session.planState).toBeNull();
    expect(saveWorkflowRunMock).toHaveBeenCalledTimes(1);
    expect(saveWorkflowRunMock.mock.calls[0]?.[1]).toMatchObject({
      id: `plan-run-${created.session.id}`,
      workflowId: created.session.id,
      status: "canceled",
      finishedAt: expect.any(String),
    });
  });

  it("does not mutate the workflow run registry when persisting the synthetic run fails", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "analysis",
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "planner system" },
        { role: "user", content: "Plan the rollout" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: JSON.stringify({
        goal: "Plan the rollout",
        steps: [
          { id: "step-analyze", title: "Analyze the request", kind: "analysis", lane: "planner" },
          { id: "step-implement", title: "Implement the change", kind: "tool", lane: "implementer" },
        ],
      }),
      toolCalls: [],
      finishReason: "stop",
    });
    saveSessionMock.mockResolvedValue(undefined);
    saveWorkflowRunMock.mockRejectedValueOnce(new Error("disk full"));

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: { id: string; runtimeIntent?: Record<string, unknown> };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };

    await expect(sendHandler?.({}, created.session.id, {
      content: "Plan the rollout",
    })).rejects.toThrow(/disk full/i);
    expect(ctx.state.workflowRuns).toEqual([]);
  });

  it("rolls back the synthetic workflow run when saving the session fails after run persistence", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "planning",
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "Plan the rollout" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: JSON.stringify({
        goal: "Plan the rollout",
        steps: [
          { id: "step-analyze", title: "Analyze the request", kind: "analysis", lane: "planner" },
          { id: "step-implement", title: "Implement the change", kind: "tool", lane: "implementer" },
        ],
      }),
      toolCalls: [],
      finishReason: "stop",
    });
    saveWorkflowRunMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: { id: string; runtimeIntent?: Record<string, unknown> };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };
    saveSessionMock.mockRejectedValueOnce(new Error("session write failed"));

    await expect(sendHandler?.({}, created.session.id, {
      content: "Plan the rollout",
    })).rejects.toThrow(/session write failed/i);
    expect(ctx.state.workflowRuns).toEqual([]);
    expect(deleteWorkflowRunFileMock).toHaveBeenCalledWith(
      ctx.runtime.paths,
      `plan-run-${created.session.id}`,
    );
  });

  it("automatically advances to the next executable step within the same approved execution run", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "execution",
    });
    let assembleCall = 0;
    assembleContextMock.mockImplementation((input) => {
      assembleCall += 1;
      if (assembleCall === 1) {
        expect(input.session.planState).toMatchObject({
          tasks: [
            {
              id: "step-apply",
              status: "in_progress",
              kind: "tool",
            },
            {
              id: "step-verify",
              status: "pending",
              kind: "verification",
            },
          ],
        });
      } else {
        expect(input.session.planState).toMatchObject({
          tasks: [
            {
              id: "step-apply",
              status: "completed",
              kind: "tool",
            },
            {
              id: "step-verify",
              status: "in_progress",
              kind: "verification",
            },
          ],
        });
      }
      return {
        messages: [
          { role: "system", content: "planner system" },
          {
            role: "user",
            content: assembleCall === 1 ? "Execute approved plan" : "Continue verification step",
          },
        ],
        budgetUsed: 10,
        wasCompacted: false,
        compactionReason: null,
        removedCount: 0,
      };
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "Applied the rollout",
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: "Verified the rollout",
        toolCalls: [],
        finishReason: "stop",
      });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent & {
          workflowMode?: "plan";
          planModeEnabled?: boolean;
        };
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string }>;
          updatedAt: string;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
          planVersion: number;
        } | null;
      };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };
    created.session.planModeState = {
      mode: "executing",
      approvalStatus: "approved",
      planVersion: 1,
    };
    created.session.planState = {
      tasks: [
        {
          id: "step-apply",
          title: "Apply the rollout",
          status: "pending",
          kind: "tool",
        },
        {
          id: "step-verify",
          title: "Verify the rollout",
          status: "pending",
          kind: "verification",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Execute approved plan",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string }>;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(2);
    expect(response.session.planModeState).toMatchObject({
      mode: "completed",
      approvalStatus: "approved",
    });
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          id: "step-apply",
          status: "completed",
          kind: "tool",
        },
        {
          id: "step-verify",
          status: "completed",
          kind: "verification",
        },
      ],
    });
  });

  it("completes plan mode without appending a fallback task when approval only resolves the last confirmation step", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();

    resolveSessionRuntimeIntentMock.mockReturnValue({
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      ...executionPlan,
      workflowMode: "plan",
      phase: "execution",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Plan Mode Session" }) as {
      session: {
        id: string;
        runtimeIntent?: typeof runtimeIntent & {
          workflowMode?: "plan";
          planModeEnabled?: boolean;
        };
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string }>;
          updatedAt: string;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
          planVersion: number;
        } | null;
      };
    };
    created.session.runtimeIntent = {
      ...runtimeIntent,
      workflowMode: "plan",
      planModeEnabled: true,
    };
    created.session.planModeState = {
      mode: "executing",
      approvalStatus: "approved",
      planVersion: 1,
    };
    created.session.planState = {
      tasks: [
        {
          id: "step-final-confirm",
          title: "Confirm completion",
          status: "pending",
          kind: "user_confirmation",
        },
      ],
      updatedAt: "2026-04-05T23:59:00.000Z",
    };

    const response = await sendHandler?.({}, created.session.id, {
      content: "Finalize approved plan",
    }) as {
      session: {
        planState?: {
          tasks: Array<{ id: string; title: string; status: string; kind?: string }>;
        } | null;
        planModeState?: {
          mode: string;
          approvalStatus: string;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(0);
    expect(response.session.planModeState).toMatchObject({
      mode: "completed",
      approvalStatus: "approved",
    });
    expect(response.session.planState?.tasks).toEqual([
      expect.objectContaining({
        id: "step-final-confirm",
        status: "completed",
        kind: "user_confirmation",
      }),
    ]);
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

  it("keeps br-minimax deep research turns in planning until additional tasks are created", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const ctx = buildContext();
    let modelRound = 0;

    ctx.state.models[0] = {
      ...ctx.state.models[0],
      providerFamily: "br-minimax",
      protocolTarget: "openai-responses",
      deploymentProfile: "br-private",
    };

    resolveSessionRuntimeIntentMock.mockReturnValue(runtimeIntent);
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue(executionPlan);
    assembleContextMock.mockImplementation((input: { session: { messages: Array<{ role: string; content: unknown }> } }) => ({
      messages: input.session.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    }));
    callModelMock.mockImplementation(async (input: { messages: Array<{ role: string; content: unknown }> }) => {
      modelRound++;
      if (modelRound === 1) {
        return {
          content: "I will analyze the annual report step by step.",
          toolCalls: [
            {
              id: "task-call-1",
              name: "task.create",
              argumentsJson: JSON.stringify({
                subject: "Collect annual report basics",
                description: "Gather the company profile and headline metrics from the annual report",
                activeForm: "Collecting annual report basics",
              }),
              input: {
                subject: "Collect annual report basics",
                description: "Gather the company profile and headline metrics from the annual report",
                activeForm: "Collecting annual report basics",
              },
            },
          ],
          finishReason: "tool_calls",
        };
      }

      if (modelRound === 2) {
        expect(input.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("Planning is incomplete for this research request"),
          }),
        ]));
        return {
          content: "I need to complete the plan before research.",
          toolCalls: [
            {
              id: "task-call-2",
              name: "task.create",
              argumentsJson: JSON.stringify({
                subject: "Analyze financial performance",
                description: "Extract revenue, profit, and cash flow trends and explain the changes",
                activeForm: "Analyzing financial performance",
              }),
              input: {
                subject: "Analyze financial performance",
                description: "Extract revenue, profit, and cash flow trends and explain the changes",
                activeForm: "Analyzing financial performance",
              },
            },
            {
              id: "task-call-3",
              name: "task.create",
              argumentsJson: JSON.stringify({
                subject: "Synthesize industry comparison",
                description: "Compare industry trends and competitors, then produce the final conclusion",
                activeForm: "Synthesizing industry comparison",
              }),
              input: {
                subject: "Synthesize industry comparison",
                description: "Compare industry trends and competitors, then produce the final conclusion",
                activeForm: "Synthesizing industry comparison",
              },
            },
          ],
          finishReason: "tool_calls",
        };
      }

      return {
        content: "The plan is complete and ready for execution.",
        toolCalls: [],
        finishReason: "stop",
      };
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Research Planning" }) as {
      session: { id: string; runtimeIntent?: typeof runtimeIntent };
    };
    created.session.runtimeIntent = runtimeIntent;

    const response = await sendHandler?.({}, created.session.id, { content: "Analyze the 2025 annual report" }) as {
      session: {
        messages: Array<{ role: string; content: unknown }>;
        tasks?: Array<{ subject: string }>;
      };
    };
    const persistedTasks = saveSessionMock.mock.calls.at(-1)?.[1]?.tasks as Array<{ subject: string }> | undefined;

    expect(callModelMock).toHaveBeenCalledTimes(2);
    expect(persistedTasks?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(persistedTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "Collect annual report basics" }),
    ]));
    expect(response.session.messages).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("Planning is incomplete for this research request"),
    }));
  });

  it("allows the main session loop to continue beyond 200 rounds and complete normally", async () => {
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
        { role: "user", content: "Finish after 200 rounds" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockImplementation(async () => {
      callCount++;
      if (callCount < 201) {
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

    const response = await sendHandler?.({}, created.session.id, { content: "Finish after 200 rounds" }) as {
      session: {
        messages: Array<{ role: string; content: unknown }>;
        planState?: {
          tasks: Array<{ title: string; status: string }>;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(201);
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          title: "Finish after 200 rounds",
          status: "completed",
        },
      ],
    });
    expect(response.session.messages).not.toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("安全上限"),
    }));
  }, ORCHESTRATION_TEST_TIMEOUT_MS);

  it("still stops on repeated identical tool rounds after removing the main session turn ceiling", async () => {
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
        { role: "user", content: "Break the loop safely" },
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
          argumentsJson: JSON.stringify({ path: "README.md" }),
          input: { path: "README.md" },
        },
      ],
      finishReason: "tool_calls",
    });
    saveSessionMock.mockResolvedValue(undefined);

    registerSessionHandlers(ctx);

    const createHandler = ipcHandleRegistry.get("session:create");
    const sendHandler = ipcHandleRegistry.get("session:send-message");
    const created = await createHandler?.({}, { title: "Phase 3" }) as {
      session: { id: string; runtimeIntent?: typeof runtimeIntent };
    };
    created.session.runtimeIntent = runtimeIntent;

    const response = await sendHandler?.({}, created.session.id, { content: "Break the loop safely" }) as {
      session: {
        messages: Array<{ role: string; content: unknown }>;
        planState?: {
          tasks: Array<{ title: string; status: string; blocker?: string }>;
        } | null;
      };
    };

    expect(callModelMock).toHaveBeenCalledTimes(5);
    expect(response.session.messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("检测到工具调用循环"),
    }));
    expect(response.session.messages).not.toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("安全上限"),
    }));
    expect(response.session.planState).toMatchObject({
      tasks: [
        {
          title: "Break the loop safely",
          status: "blocked",
          blocker: expect.stringContaining("Detected tool loop"),
        },
      ],
    });
  }, ORCHESTRATION_TEST_TIMEOUT_MS);
});
