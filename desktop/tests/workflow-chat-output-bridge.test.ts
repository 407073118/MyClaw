import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession, SiliconPerson, WorkflowDefinition, WorkflowStreamEvent } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const saveWorkflowMock = vi.fn();
const saveWorkflowRunMock = vi.fn();
const saveSessionMock = vi.fn();
const windowSendMock = vi.hoisted(() => vi.fn());

type WorkflowListener = (event: WorkflowStreamEvent) => void;
type FakeWorkflowResult = {
  status: "succeeded" | "failed" | "canceled" | "waiting-input";
  totalSteps: number;
  durationMs: number;
  finalState?: {
    outputs?: Record<string, unknown>;
  };
};

class FakeWorkflowEmitter {
  private listeners = new Set<WorkflowListener>();

  /** 注册 workflow 事件监听器，便于测试主动驱动节点状态变化。 */
  on(listener: WorkflowListener): void {
    this.listeners.add(listener);
  }

  /** 主动向所有监听器派发 workflow 事件，模拟真实运行期流式回调。 */
  emit(event: WorkflowStreamEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakePregelRunner {
  public readonly runId = "workflow-run-1";
  public readonly emitter = new FakeWorkflowEmitter();
  private runPromise: Promise<FakeWorkflowResult>;
  private resolveRunPromise!: (value: FakeWorkflowResult) => void;

  constructor() {
    this.runPromise = new Promise((resolve) => {
      this.resolveRunPromise = resolve;
    });
    lastRunner = this;
  }

  /** 返回受测试控制的运行 Promise，直到用例显式 finish。 */
  run(): Promise<FakeWorkflowResult & { finalState: { outputs?: Record<string, unknown> } }> {
    return this.runPromise.then((result) => ({
      ...result,
      finalState: result.finalState ?? { outputs: {} },
    }));
  }

  /** 测试专用：结束挂起的 workflow run。 */
  finish(result: FakeWorkflowResult): void {
    this.resolveRunPromise(result);
  }

  /** 兼容真实 runner 的热恢复接口。 */
  resume(): Promise<FakeWorkflowResult & { finalState: { outputs?: Record<string, unknown> } }> {
    return this.run();
  }

  /** 兼容真实 runner 的取消接口。 */
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
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: windowSendMock,
      },
    }],
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveWorkflow: saveWorkflowMock,
  saveWorkflowRun: saveWorkflowRunMock,
  saveSession: saveSessionMock,
  deleteWorkflowFile: vi.fn(),
}));

vi.mock("../src/main/services/pending-saves", () => ({
  trackSave: vi.fn((p: Promise<unknown>) => p),
}));

vi.mock("../src/main/services/builtin-tool-executor", () => ({
  BuiltinToolExecutor: class {
    /** 测试里不需要真实 skills。 */
    setSkills(): void {}

    /** 测试里不会执行真实工具。 */
    async execute(): Promise<{ success: boolean; output: string }> {
      return { success: true, output: "" };
    }
  },
}));

vi.mock("../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: vi.fn(() => ({ executeTurn: vi.fn() })),
}));

vi.mock("../src/main/services/model-runtime/canonical-turn-content", () => ({
  buildCanonicalTurnContent: vi.fn(() => ({ messages: [] })),
  // 测试保留 legacy 消息原样回放，避免无关 canonical 过滤影响桥接断言。
  prepareLegacyMessagesForCanonicalReplay: vi.fn((messages) => messages),
}));

vi.mock("../src/main/services/model-runtime/prompt-composer", () => ({
  composePromptSections: vi.fn(() => []),
}));

vi.mock("../src/main/services/model-runtime/turn-outcome-store", () => ({
  loadTurnOutcome: vi.fn(() => null),
  updateTurnOutcome: vi.fn(),
}));

vi.mock("../src/main/services/model-runtime/tool-registry", () => ({
  hydrateCanonicalToolRegistryFromLegacyTools: vi.fn(() => []),
}));

vi.mock("../src/main/services/model-runtime/turn-execution-plan-resolver", () => ({
  resolveTurnExecutionPlan: vi.fn(() => ({
    providerFamily: "br-minimax",
    protocolTarget: "openai-chat-compatible",
    replayPolicy: "assistant-turn",
    experienceProfileId: null,
    promptPolicyId: null,
    toolPolicyId: null,
    reasoningProfileId: null,
    legacyExecutionPlan: { replayPolicy: "assistant-turn" },
  })),
}));

vi.mock("../src/main/services/reasoning-runtime", () => ({
  buildExecutionPlan: vi.fn(() => ({ replayPolicy: "assistant-turn" })),
}));

vi.mock("../src/main/services/artifact-context-builder", () => ({
  buildArtifactContextBlock: vi.fn(() => ""),
}));

vi.mock("../src/main/services/builtin-tool-registry", () => ({
  builtinToolIdToFunctionName: vi.fn((toolId: string) => toolId.replace(/\./g, "_")),
}));

vi.mock("../src/main/services/tool-schemas", () => ({
  // 测试默认不暴露 MCP 工具，返回空映射即可覆盖 session 路由依赖。
  buildMcpFunctionNameMap: vi.fn(() => new Map()),
  buildToolLabel: vi.fn((name: string) => name),
}));

vi.mock("../src/main/ipc/sessions", () => ({
  broadcastSessionTasksUpdated: vi.fn(),
}));

vi.mock("../src/main/services/workflow-engine", () => ({
  PregelRunner: FakePregelRunner,
  NodeExecutorRegistry: class {
    /** 测试只验证 IPC 接线，不关心真实 executor 注册细节。 */
    register(): void {}
  },
  StartNodeExecutor: class {},
  AnswerNodeExecutor: class {},
  CodeNodeExecutor: class {},
  EndNodeExecutor: class {},
  ConditionNodeExecutor: class {},
  LlmNodeExecutor: class {},
  TemplateNodeExecutor: class {},
  VariableAssignerNodeExecutor: class {},
  ToolNodeExecutor: class {},
  HttpRequestNodeExecutor: class {},
  HumanInputNodeExecutor: class {},
  JoinNodeExecutor: class {},
}));

vi.mock("../src/main/services/workflow-engine/sqlite-checkpointer", () => ({
  SqliteCheckpointer: class {
    /** 测试里不访问真实 sqlite。 */
    async init(): Promise<void> {}

    /** 测试里只需要空运行历史。 */
    listRuns(): unknown[] {
      return [];
    }

    createRun(): void {}
    updateRunStatus(): void {}
    saveCheckpoint(): void {}
    getLatestCheckpoint(): null {
      return null;
    }
    restoreChannelData(): Map<string, unknown> {
      return new Map();
    }
    getRun(): null {
      return null;
    }
  },
}));

/** 构造一个绑定 workflow 的硅基员工对象。 */
function buildSiliconPerson(): SiliconPerson {
  return {
    id: "sp-1",
    name: "小王",
    title: "天气助理",
    description: "负责查询天气并回复用户。",
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
        updatedAt: "2026-05-19T00:00:00.000Z",
      },
    ],
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    workflowIds: ["workflow-1"],
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
}

/** 构造一个用于接收 workflow 输出的员工私域 session。 */
function buildSession(): ChatSession {
  return {
    id: "session-1",
    title: "默认会话",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    siliconPersonId: "sp-1",
    createdAt: "2026-05-19T00:00:00.000Z",
    messages: [],
    tasks: [],
  };
}

/** 构造最小 workflow 定义，包含一个会投影到 task 的 LLM 节点。 */
function buildWorkflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "天气查询",
    description: "查询天气并回复用户。",
    status: "active",
    source: "personal",
    updatedAt: "2026-05-19T00:00:00.000Z",
    version: 1,
    nodeCount: 3,
    edgeCount: 2,
    libraryRootId: "",
    entryNodeId: "node-start",
    nodes: [
      { id: "node-start", kind: "start", label: "开始" },
      { id: "node-llm", kind: "llm", label: "整理天气", llm: { prompt: "整理天气" } },
      { id: "node-end", kind: "end", label: "结束" },
    ],
    edges: [
      { id: "edge-1", fromNodeId: "node-start", toNodeId: "node-llm", kind: "normal" },
      { id: "edge-2", fromNodeId: "node-llm", toNodeId: "node-end", kind: "normal" },
    ],
    stateSchema: [],
  };
}

/** 构造最小 RuntimeContext，让 workflow IPC 能读写 session / workflow 状态。 */
function buildContext(): RuntimeContext {
  const session = buildSession();
  const siliconPerson = buildSiliconPerson();
  const workflow = buildWorkflowDefinition();
  return {
    runtime: {
      myClawRootPath: "F:/MyClaw",
      skillsRootPath: "F:/MyClaw/skills",
      sessionsRootPath: "F:/MyClaw/sessions",
      workspaceRootPath: "F:/MyClaw/workspace",
      artifactsRootPath: "F:/MyClaw/artifacts",
      cacheRootPath: "F:/MyClaw/cache",
      paths: {
        rootDir: "F:/MyClaw",
        myClawDir: "F:/MyClaw/.myclaw",
        skillsDir: "F:/MyClaw/skills",
        sessionsDir: "F:/MyClaw/sessions",
        sessionsDbFile: "F:/MyClaw/sessions.db",
        modelsDir: "F:/MyClaw/models",
        workspaceDir: "F:/MyClaw/workspace",
        artifactsDir: "F:/MyClaw/artifacts",
        cacheDir: "F:/MyClaw/cache",
        settingsFile: "F:/MyClaw/settings.json",
      },
    },
    state: {
      models: [],
      sessions: [session],
      siliconPersons: [siliconPerson],
      workflowDefinitions: { [workflow.id]: workflow },
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
      activeSessionRuns: new Map(),
      skills: [],
      getDefaultModelProfileId: () => "profile-1",
      setDefaultModelProfileId: () => {},
      getWorkflows: () => [{
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
      }],
      getApprovals: () => ({
        mode: "auto-read-only",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
        alwaysAllowedTools: [],
      }),
      getApprovalRequests: () => [],
      setApprovalRequests: () => {},
      getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      setPersonalPromptProfile: () => {},
    },
    services: {
      artifactRegistry: { query: vi.fn(), listArtifactLinks: vi.fn(() => []) } as any,
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

describe("workflow chat output bridge", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    lastRunner = null;
    saveWorkflowMock.mockReset();
    saveWorkflowRunMock.mockReset();
    saveSessionMock.mockReset();
    windowSendMock.mockReset();
    saveWorkflowMock.mockResolvedValue(undefined);
    saveWorkflowRunMock.mockResolvedValue(undefined);
    saveSessionMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("工作流成功完成后把最终 answer 追加成硅基员工对话消息", async () => {
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

    lastRunner?.finish({
      status: "succeeded",
      totalSteps: 4,
      durationMs: 30,
      finalState: {
        outputs: {
          answer: "今天上海小雨，建议带伞。",
        },
      },
    });

    await vi.waitFor(() => {
      expect(ctx.state.sessions[0]?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "今天上海小雨，建议带伞。",
        }),
      ]));
    });

    expect(saveSessionMock).toHaveBeenCalledWith(
      ctx.runtime.paths,
      expect.objectContaining({
        id: "session-1",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: "今天上海小雨，建议带伞。" }),
        ]),
      }),
    );
    expect(windowSendMock).toHaveBeenCalledWith(
      "session:stream",
      expect.objectContaining({
        type: "session.updated",
        session: expect.objectContaining({
          id: "session-1",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "assistant", content: "今天上海小雨，建议带伞。" }),
          ]),
        }),
      }),
    );
  });

  it("没有绑定 session 的普通 workflow run 不会写入对话消息", async () => {
    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    const ctx = buildContext();

    registerWorkflowHandlers(ctx);
    const startRunHandler = ipcHandleRegistry.get("workflow:start-run");
    expect(startRunHandler).toBeTypeOf("function");

    await startRunHandler?.({}, { workflowId: "workflow-1", initialState: {} });

    lastRunner?.finish({
      status: "succeeded",
      totalSteps: 2,
      durationMs: 10,
      finalState: {
        outputs: {
          answer: "这条消息不应该进入对话。",
        },
      },
    });

    await vi.waitFor(() => {
      expect(ctx.state.workflowRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "workflow-run-1", status: "succeeded" }),
      ]));
    });
    expect(ctx.state.sessions[0]?.messages).toEqual([]);
  });

  it("失败的硅基员工 workflow run 不会写入对话消息", async () => {
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

    lastRunner?.finish({
      status: "failed",
      totalSteps: 2,
      durationMs: 10,
      finalState: {
        outputs: {
          answer: "失败结果不应发送给用户。",
        },
      },
    });

    await vi.waitFor(() => {
      expect(ctx.state.workflowRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "workflow-run-1", status: "failed" }),
      ]));
    });
    expect(ctx.state.sessions[0]?.messages).toEqual([]);
  });

  it("空白最终输出不会生成空白 assistant 消息", async () => {
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

    lastRunner?.finish({
      status: "succeeded",
      totalSteps: 2,
      durationMs: 10,
      finalState: {
        outputs: {
          answer: "   ",
        },
      },
    });

    await vi.waitFor(() => {
      expect(ctx.state.workflowRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "workflow-run-1", status: "succeeded" }),
      ]));
    });
    expect(ctx.state.sessions[0]?.messages).toEqual([]);
  });
});
