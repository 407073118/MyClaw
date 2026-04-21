import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession, SiliconPerson, WorkflowDefinition, WorkflowStreamEvent } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const saveWorkflowMock = vi.fn();
const saveWorkflowRunMock = vi.fn();
const saveSessionMock = vi.fn();

type WorkflowListener = (event: WorkflowStreamEvent) => void;

class FakeWorkflowEmitter {
  private listeners = new Set<WorkflowListener>();

  /** 注册 workflow 事件监听器，便于测试主动驱动节点状态变化。 */
  on(listener: WorkflowListener): void {
    this.listeners.add(listener);
  }

  /** 主动向所有监听器派发 workflow 事件，模拟真实运行期流式回调。 */
  emit(event: WorkflowStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class FakePregelRunner {
  public readonly runId = "workflow-run-1";
  public readonly emitter = new FakeWorkflowEmitter();
  private runPromise: Promise<{
    status: "succeeded" | "failed" | "canceled" | "waiting-input";
    totalSteps: number;
    durationMs: number;
    error?: string;
  }>;
  private resolveRunPromise!: (value: {
    status: "succeeded" | "failed" | "canceled" | "waiting-input";
    totalSteps: number;
    durationMs: number;
    error?: string;
  }) => void;

  constructor() {
    /** 让测试自己控制 run 的最终结束时机，便于在中途注入 stream 事件。 */
    this.runPromise = new Promise((resolve) => {
      this.resolveRunPromise = resolve;
    });
  }

  /** 返回悬挂中的 run promise，直到测试显式结束运行。 */
  run(): Promise<{
    status: "succeeded" | "failed" | "canceled" | "waiting-input";
    totalSteps: number;
    durationMs: number;
    error?: string;
  }> {
    return this.runPromise;
  }

  /** 测试专用：手动结束 workflow 运行。 */
  finish(result: {
    status: "succeeded" | "failed" | "canceled" | "waiting-input";
    totalSteps: number;
    durationMs: number;
    error?: string;
  }): void {
    this.resolveRunPromise(result);
  }

  /** 保持与真实 runner 接口兼容，当前用例不需要额外行为。 */
  resume(): Promise<{
    status: "succeeded" | "failed" | "canceled" | "waiting-input";
    totalSteps: number;
    durationMs: number;
    error?: string;
  }> {
    return this.runPromise;
  }

  /** 保持与真实 runner 接口兼容，当前用例不需要额外行为。 */
  abort(): void {}
}

let lastRunner: FakePregelRunner | null = null;

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandleRegistry.set(channel, handler);
    }),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  webContents: {
    getAllWebContents: () => [],
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveWorkflow: saveWorkflowMock,
  saveWorkflowRun: saveWorkflowRunMock,
  saveSession: saveSessionMock,
  saveSiliconPerson: vi.fn(),
  deleteWorkflowFile: vi.fn(),
  deleteWorkflowRunFile: vi.fn(),
  deleteSessionFiles: vi.fn(),
}));

vi.mock("../src/main/services/model-client", () => ({
  callModel: vi.fn(),
}));

vi.mock("../src/main/services/builtin-tool-executor", () => ({
  BuiltinToolExecutor: class {
    /** 测试里不需要真实 skills。 */
    setSkills(): void {}
    setAllowExternalPaths(): void {}

    /** 测试里不需要真实工具执行。 */
    async execute(): Promise<{ success: boolean; output: string; error?: string }> {
      return { success: true, output: "" };
    }

    isOutsideWorkspace(): boolean {
      return false;
    }

    async shutdown(): Promise<void> {}
  },
}));

vi.mock("../src/main/services/pending-saves", () => ({
  trackSave: vi.fn((p: Promise<unknown>) => p),
}));

vi.mock("../src/main/services/artifact-context-builder", () => ({
  buildArtifactContextBlock: vi.fn(() => ""),
}));

vi.mock("../src/main/services/model-runtime/canonical-turn-content", () => ({
  buildCanonicalTurnContent: vi.fn(() => ({ systemSections: [], userSections: [], messages: [], toolCalls: [], toolResults: [], approvalEvents: [], taskState: null, replayHints: {} })),
}));

vi.mock("../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: vi.fn(() => ({ executeTurn: vi.fn() })),
}));

vi.mock("../src/main/services/model-runtime/prompt-composer", () => ({
  composePromptSections: vi.fn(() => []),
}));

vi.mock("../src/main/services/model-runtime/turn-outcome-store", () => ({
  loadTurnOutcome: vi.fn(() => null),
  updateTurnOutcome: vi.fn(),
}));

vi.mock("../src/main/services/model-runtime/tool-registry", () => ({
  buildCanonicalToolRegistry: vi.fn(() => ({ specs: [], resolve: vi.fn(), functionNameToToolId: vi.fn((n: string) => n), buildToolLabel: vi.fn((n: string) => n) })),
  hydrateCanonicalToolRegistryFromLegacyTools: vi.fn(() => []),
}));

vi.mock("../src/main/services/model-runtime/turn-execution-plan-resolver", () => ({
  resolveTurnExecutionPlan: vi.fn((input: Record<string, unknown>) => ({
    providerFamily: "br-minimax",
    protocolTarget: "openai-chat-compatible",
    replayPolicy: "assistant-turn",
    reasoningEffort: "medium",
    capabilityRoutes: {},
    telemetryTags: {},
    experienceProfileId: null,
    promptPolicyId: null,
    toolPolicyId: null,
    reasoningProfileId: null,
    legacyExecutionPlan: input?.legacyExecutionPlan ?? {
      adapterId: "br-minimax",
      replayPolicy: "assistant-turn",
      reasoningMode: "auto",
    },
  })),
}));

vi.mock("../src/main/services/reasoning-runtime", () => ({
  resolveSessionRuntimeIntent: vi.fn(),
  buildExecutionPlan: vi.fn(() => ({
    runtimeVersion: 1,
    adapterId: "br-minimax",
    adapterSelectionSource: "profile",
    reasoningMode: "auto",
    replayPolicy: "assistant-turn",
    fallbackAdapterIds: [],
  })),
}));

vi.mock("../src/main/services/model-capability-resolver", () => ({
  resolveModelCapability: vi.fn(() => ({
    effective: { supportsReasoning: true, source: "registry" },
  })),
}));

vi.mock("../src/main/services/context-assembler", () => ({
  assembleContext: vi.fn(() => ({
    messages: [], budgetUsed: 0, wasCompacted: false, compactionReason: null, removedCount: 0,
  })),
}));

vi.mock("../src/main/services/tool-schemas", () => ({
  buildToolSchemas: vi.fn(() => []),
  functionNameToToolId: vi.fn((name: string) => name),
  buildToolLabel: vi.fn((name: string) => name),
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

vi.mock("../src/main/services/personal-prompt-profile", () => ({
  buildPersonalPromptContext: vi.fn(() => ""),
}));

vi.mock("../src/main/services/context-enricher", () => ({
  extractEnrichedContext: vi.fn(() => ({})),
  buildEnrichedContextBlock: vi.fn(() => ""),
}));

vi.mock("@shared/task-logical", () => ({
  buildTaskDisplayItems: vi.fn(() => ""),
  buildTaskFingerprint: vi.fn((t: Record<string, unknown>) => `${t.subject}`),
  coalesceTasks: vi.fn((tasks: unknown[]) => ({ tasks, aliasMap: {} })),
}));

vi.mock("../src/main/services/workflow-engine", () => ({
  PregelRunner: class extends FakePregelRunner {
    constructor(...args: unknown[]) {
      super();
      void args;
      lastRunner = this;
    }
  },
  NodeExecutorRegistry: class {
    /** 测试只验证 IPC 接线，不关心 executor 注册细节。 */
    register(): void {}
  },
  StartNodeExecutor: class {},
  EndNodeExecutor: class {},
  ConditionNodeExecutor: class {},
  LlmNodeExecutor: class {},
  ToolNodeExecutor: class {},
  HumanInputNodeExecutor: class {},
  JoinNodeExecutor: class {},
}));

vi.mock("../src/main/services/workflow-engine/sqlite-checkpointer", () => ({
  SqliteCheckpointer: class {
    /** 测试里不访问真实 sqlite。 */
    async init(): Promise<void> {}

    /** 测试里只需要空历史。 */
    listRuns(): unknown[] {
      return [];
    }

    /** 测试里不需要真实 run 持久化。 */
    createRun(): void {}

    /** 测试里不需要真实 run 状态更新。 */
    updateRunStatus(): void {}

    /** 测试里不需要真实 checkpoint。 */
    saveCheckpoint(): void {}

    /** 测试里不需要真实 checkpoint 查询。 */
    getLatestCheckpoint(): null {
      return null;
    }

    /** 测试里不需要真实 checkpoint 恢复。 */
    restoreChannelData(): Map<string, unknown> {
      return new Map();
    }

    /** 测试里不需要真实 run 详情。 */
    getRun(): null {
      return null;
    }
  },
}));

/** 构造一个最小硅基员工对象，便于覆盖 workflow 驱动 task 的 session 行为。 */
function buildSiliconPerson(): SiliconPerson {
  return {
    id: "sp-1",
    name: "小王",
    title: "硅基运营",
    description: "负责追踪工作流执行",
    status: "idle",
    source: "personal",
    approvalMode: "inherit",
    currentSessionId: "session-1",
    sessions: [
      {
        id: "session-1",
        title: "默认会话",
        status: "idle",
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ],
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    workflowIds: ["workflow-1"],
    updatedAt: "2026-04-08T00:00:00.000Z",
  };
}

/** 构造最小 session，上面先放一个手工 task，验证 workflow 不会替代 tasklist。 */
function buildSession(): ChatSession {
  return {
    id: "session-1",
    title: "默认会话",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    siliconPersonId: "sp-1",
    createdAt: "2026-04-08T00:00:00.000Z",
    messages: [],
    tasks: [
      {
        id: "manual-task-1",
        subject: "人工补充任务",
        description: "这个任务必须保留",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
    ],
  };
}

/** 构造一个最小 workflow 定义，包含两个会变成 task 的节点。 */
function buildWorkflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "运营分解流",
    description: "按节点推进任务",
    status: "active",
    source: "personal",
    updatedAt: "2026-04-08T00:00:00.000Z",
    version: 1,
    nodeCount: 4,
    edgeCount: 3,
    libraryRootId: "",
    entryNodeId: "node-start",
    nodes: [
      { id: "node-start", kind: "start", label: "开始" },
      { id: "node-plan", kind: "llm", label: "拆解任务", llm: { prompt: "请拆解" } },
      { id: "node-run", kind: "tool", label: "执行脚本", tool: { toolId: "shell.exec" } },
      { id: "node-end", kind: "end", label: "结束" },
    ],
    edges: [
      { id: "edge-1", fromNodeId: "node-start", toNodeId: "node-plan", kind: "normal" },
      { id: "edge-2", fromNodeId: "node-plan", toNodeId: "node-run", kind: "normal" },
      { id: "edge-3", fromNodeId: "node-run", toNodeId: "node-end", kind: "normal" },
    ],
    stateSchema: [],
  };
}

/** 构造最小 RuntimeContext，让 workflow IPC 能读取 session / workflow / silicon person 状态。 */
function buildContext(): RuntimeContext {
  const session = buildSession();
  const siliconPerson = buildSiliconPerson();
  const workflow = buildWorkflowDefinition();
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
        sessionsDbFile: "/tmp/myclaw/sessions.db",
        modelsDir: "/tmp/myclaw/models",
        workspaceDir: "/tmp/myclaw/workspace",
        artifactsDir: "/tmp/myclaw/artifacts",
        cacheDir: "/tmp/myclaw/cache",
        settingsFile: "/tmp/myclaw/settings.json",
      },
    },
    state: {
      models: [
        {
          id: "profile-1",
          name: "BR MiniMax",
          provider: "openai-compatible",
          providerFlavor: "br-minimax",
          baseUrl: "http://api-cybotforge-pre.brapp.com",
          apiKey: "test-key",
          model: "minimax-m2-5",
        },
      ],
      sessions: [session],
      siliconPersons: [siliconPerson],
      workflowDefinitions: {
        [workflow.id]: workflow,
      },
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
      activeSessionRuns: new Map(),
      skills: [],
      getDefaultModelProfileId: () => "profile-1",
      setDefaultModelProfileId: () => {},
      getWorkflows: () => [
        {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          status: workflow.status,
          source: workflow.source,
          updatedAt: workflow.updatedAt,
          version: workflow.version,
          nodeCount: workflow.nodeCount,
          edgeCount: workflow.edgeCount,
          libraryRootId: workflow.libraryRootId,
        },
      ],
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
    },
    tools: {
      resolveBuiltinTools: () => [],
      resolveMcpTools: () => [],
    },
  } as RuntimeContext;
}

describe("silicon person workflow run", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    lastRunner = null;
    saveWorkflowMock.mockReset();
    saveWorkflowRunMock.mockReset();
    saveSessionMock.mockReset();
    saveWorkflowMock.mockResolvedValue(undefined);
    saveWorkflowRunMock.mockResolvedValue(undefined);
    saveSessionMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("seeds workflow-driven tasks into the silicon-person session without replacing manual tasks", async () => {
    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    const ctx = buildContext();

    registerWorkflowHandlers(ctx);

    const startRunHandler = ipcHandleRegistry.get("workflow:start-run");
    expect(startRunHandler).toBeTypeOf("function");

    void startRunHandler?.({}, {
      workflowId: "workflow-1",
      initialState: {
        siliconPersonId: "sp-1",
        sessionId: "session-1",
      },
    });

    expect(lastRunner?.runId).toBe("workflow-run-1");
    expect(ctx.state.sessions[0]?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "manual-task-1",
        subject: "人工补充任务",
      }),
      expect.objectContaining({
        subject: "拆解任务",
        status: "pending",
      }),
      expect.objectContaining({
        subject: "执行脚本",
        status: "pending",
      }),
    ]));
    expect(saveSessionMock).toHaveBeenCalledWith(
      ctx.runtime.paths,
      expect.objectContaining({
        id: "session-1",
        tasks: expect.arrayContaining([
          expect.objectContaining({ id: "manual-task-1" }),
          expect.objectContaining({ subject: "拆解任务" }),
        ]),
      }),
    );

    lastRunner?.finish({
      status: "succeeded",
      totalSteps: 2,
      durationMs: 24,
    });
  });

  it("updates the matching silicon-person session tasks as workflow stream events arrive", async () => {
    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    const ctx = buildContext();

    registerWorkflowHandlers(ctx);

    const startRunHandler = ipcHandleRegistry.get("workflow:start-run");
    expect(startRunHandler).toBeTypeOf("function");

    await startRunHandler?.({}, {
      workflowId: "workflow-1",
      initialState: {
        siliconPersonId: "sp-1",
        sessionId: "session-1",
      },
    });

    expect(lastRunner).not.toBeNull();

    lastRunner?.emitter.emit({
      type: "node-start",
      runId: "workflow-run-1",
      nodeId: "node-plan",
      nodeKind: "llm",
    });

    expect(ctx.state.sessions[0]?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject: "拆解任务",
        status: "in_progress",
      }),
    ]));

    lastRunner?.emitter.emit({
      type: "node-complete",
      runId: "workflow-run-1",
      nodeId: "node-plan",
      outputs: {},
      durationMs: 12,
    });

    expect(ctx.state.sessions[0]?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject: "拆解任务",
        status: "completed",
      }),
    ]));

    lastRunner?.finish({
      status: "succeeded",
      totalSteps: 2,
      durationMs: 24,
    });

    await vi.waitFor(() => {
      expect(ctx.state.workflowRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-run-1",
          status: "succeeded",
        }),
      ]));
    });
  });
});
