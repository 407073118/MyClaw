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

/** 构造最小 RuntimeContext，专门用于验证 session 主链路是否接上 execution plan。 */
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

describe("phase1 session runtime integration", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    callModelMock.mockReset();
    assembleContextMock.mockReset();
    resolveModelCapabilityMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    saveSessionMock.mockReset();
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
      expect(input).toMatchObject({
        executionPlan,
      });
      return {
        content: "done",
        toolCalls: [],
        finishReason: "stop",
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

    // resolveSessionRuntimeIntent is called 3 times per send:
    // 1) sessionReasoningEffort extraction, 2) isPlanModeEnabled check, 3) agentic loop
    expect(resolveSessionRuntimeIntentMock).toHaveBeenCalledTimes(3);
    expect(buildExecutionPlanMock).toHaveBeenCalledTimes(2);
    expect(assembleContextMock).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan,
    }));
    expect(callModelMock).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan,
    }));
    expect(order).toEqual(expect.arrayContaining(["intent", "capability", "plan", "context", "execute"]));
    expect(order.indexOf("plan")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("context"));
    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("execute"));
    expect(response.session.runtimeVersion).toBe(1);
    expect(response.session.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "done",
    });
  });
});
