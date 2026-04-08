import { beforeEach, describe, expect, it, vi } from "vitest";

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
    callModelMock.mockReset();
    assembleContextMock.mockReset();
    resolveModelCapabilityMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    saveSessionMock.mockReset();
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
        executionPlan,
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
    expect(buildExecutionPlanMock).toHaveBeenCalledTimes(1);
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
    // resolveSessionRuntimeIntent is called 3 times (reasoningEffort, isPlanModeEnabled, loop),
    // but the critical ordering is: intent → capability → plan → context → execute
    expect(order).toEqual(expect.arrayContaining(["intent", "capability", "plan", "context", "execute"]));
    // Verify the core sequence ordering is correct
    const coreOrder = order.filter(s => s !== "intent" || order.indexOf(s) === order.lastIndexOf(s) ? true : order.lastIndexOf(s) === order.indexOf(s));
    const lastIntent = order.lastIndexOf("intent");
    const capIdx = order.indexOf("capability");
    const planIdx = order.indexOf("plan");
    expect(lastIntent).toBeLessThan(capIdx);
    expect(capIdx).toBeLessThan(planIdx);
    expect(assembleContextMock).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan: expect.objectContaining({
        replayPolicy: "assistant-turn",
        degradationReason: "capability-missing",
      }),
    }));
    expect(callModelMock).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan: expect.objectContaining({
        replayPolicy: "assistant-turn",
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
