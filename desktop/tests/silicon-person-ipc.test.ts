import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession, SiliconPerson } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const saveSessionMock = vi.fn();
const saveSiliconPersonMock = vi.fn();
const callModelMock = vi.fn();
const assembleContextMock = vi.fn();
const resolveModelCapabilityMock = vi.fn();
const resolveSessionRuntimeIntentMock = vi.fn();
const buildExecutionPlanMock = vi.fn();
const invokeRegisteredWorkflowStartRunMock = vi.fn();

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
  saveSiliconPerson: saveSiliconPersonMock,
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

vi.mock("../src/main/ipc/workflows", () => ({
  invokeRegisteredWorkflowStartRun: invokeRegisteredWorkflowStartRunMock,
}));

/** 构造最小 RuntimeContext，用来验证硅基员工 IPC 的主线程写入语义。 */
function buildContext(input?: {
  siliconPersons?: SiliconPerson[];
  sessions?: ChatSession[];
}): RuntimeContext {
  let approvalRequests: Array<Record<string, unknown>> = [];
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
      sessions: input?.sessions ?? [],
      siliconPersons: input?.siliconPersons ?? [],
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
      getApprovalRequests: () => approvalRequests,
      setApprovalRequests: (requests) => {
        approvalRequests = requests as Array<Record<string, unknown>>;
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

/** 构造一个便于断言 currentSession 变化的硅基员工基线数据。 */
function buildSiliconPerson(): SiliconPerson {
  return {
    id: "sp-1",
    name: "小王",
    title: "硅基运营",
    description: "负责日常运营跟进",
    status: "idle",
    source: "personal",
    approvalMode: "inherit",
    currentSessionId: null,
    sessions: [],
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    workflowIds: [],
    updatedAt: "2026-04-08T00:00:00.000Z",
  };
}

describe("silicon person ipc", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    saveSessionMock.mockReset();
    saveSiliconPersonMock.mockReset();
    callModelMock.mockReset();
    assembleContextMock.mockReset();
    resolveModelCapabilityMock.mockReset();
    resolveSessionRuntimeIntentMock.mockReset();
    buildExecutionPlanMock.mockReset();
    invokeRegisteredWorkflowStartRunMock.mockReset();
    saveSessionMock.mockResolvedValue(undefined);
    saveSiliconPersonMock.mockResolvedValue(undefined);
  });

  it("registers manual session creation and switches currentSession to the new session", async () => {
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const ctx = buildContext({
      siliconPersons: [buildSiliconPerson()],
    });

    registerSiliconPersonHandlers(ctx);

    const createSessionHandler = ipcHandleRegistry.get("silicon-person:create-session");

    expect(createSessionHandler).toBeTypeOf("function");

    const payload = await createSessionHandler?.({}, "sp-1", { title: "跟进会话" }) as {
      siliconPerson: SiliconPerson;
      session: ChatSession;
    };

    expect(payload.session.title).toBe("跟进会话");
    expect(payload.session.siliconPersonId).toBe("sp-1");
    expect(payload.siliconPerson.currentSessionId).toBe(payload.session.id);
    expect(ctx.state.sessions).toHaveLength(1);
    expect(saveSessionMock).toHaveBeenCalledWith(
      ctx.runtime.paths,
      expect.objectContaining({
        id: payload.session.id,
        siliconPersonId: "sp-1",
      }),
    );
  });

  it("registers explicit currentSession switching without creating a new session", async () => {
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const session1: ChatSession = {
      id: "session-1",
      title: "默认会话",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      siliconPersonId: "sp-1",
      createdAt: "2026-04-08T00:00:00.000Z",
      messages: [],
    };
    const session2: ChatSession = {
      ...session1,
      id: "session-2",
      title: "复盘会话",
      createdAt: "2026-04-08T01:00:00.000Z",
    };
    const ctx = buildContext({
      sessions: [session1, session2],
      siliconPersons: [{
        ...buildSiliconPerson(),
        currentSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "默认会话",
            status: "idle",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: session1.createdAt,
          },
          {
            id: "session-2",
            title: "复盘会话",
            status: "idle",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: session2.createdAt,
          },
        ],
      }],
    });

    registerSiliconPersonHandlers(ctx);

    const switchSessionHandler = ipcHandleRegistry.get("silicon-person:switch-session");

    expect(switchSessionHandler).toBeTypeOf("function");

    const payload = await switchSessionHandler?.({}, "sp-1", "session-2") as {
      siliconPerson: SiliconPerson;
      session: ChatSession;
    };

    expect(payload.session.id).toBe("session-2");
    expect(payload.siliconPerson.currentSessionId).toBe("session-2");
    expect(ctx.state.sessions).toHaveLength(2);
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(saveSiliconPersonMock).toHaveBeenCalled();
  });

  it("routes silicon-person send-message through the shared session execution flow and syncs done summary", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const ctx = buildContext({
      siliconPersons: [buildSiliconPerson()],
    });

    resolveSessionRuntimeIntentMock.mockReturnValue({
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      runtimeVersion: 1,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
      degradationReason: null,
      planSource: "capability",
      fallbackAdapterIds: ["openai-compatible"],
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "请整理今天的运营事项" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockResolvedValue({
      content: "今天的运营事项已经整理完成。",
      reasoning: "",
      toolCalls: [],
      finishReason: "stop",
    });

    registerSessionHandlers(ctx);
    registerSiliconPersonHandlers(ctx);

    const sendMessageHandler = ipcHandleRegistry.get("silicon-person:send-message");

    expect(sendMessageHandler).toBeTypeOf("function");

    // fire-and-forget：立即返回 dispatched，后台排队执行
    const dispatchResult = await sendMessageHandler?.({}, "sp-1", {
      content: "请整理今天的运营事项",
    }) as { dispatched: boolean; siliconPersonId: string };

    expect(dispatchResult).toMatchObject({ dispatched: true, siliconPersonId: "sp-1" });

    // 等待后台队列消费完成
    await vi.waitFor(() => {
      expect(callModelMock).toHaveBeenCalledTimes(1);
    });

    // 再等待状态同步
    await vi.waitFor(() => {
      expect(ctx.state.siliconPersons[0]?.status).toBe("done");
    });

    const sp = ctx.state.siliconPersons[0]!;
    expect(sp.currentSessionId).toBeTruthy();
    expect(sp.unreadCount).toBe(1);
    expect(sp.hasUnread).toBe(true);
    expect(sp.needsApproval).toBe(false);

    const spSession = ctx.state.sessions.find((s) => s.siliconPersonId === "sp-1");
    expect(spSession).toBeDefined();
    expect(spSession!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: "请整理今天的运营事项",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "今天的运营事项已经整理完成。",
      }),
    ]));
  });

  it("marks the silicon person as canceling before the shared session run settles to canceled", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const ctx = buildContext({
      siliconPersons: [buildSiliconPerson()],
    });

    resolveSessionRuntimeIntentMock.mockReturnValue({
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      runtimeVersion: 1,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
      degradationReason: null,
      planSource: "capability",
      fallbackAdapterIds: ["openai-compatible"],
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "请先输出一半，再取消" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock.mockImplementation(({ onDelta, signal }) => {
      onDelta?.({ content: "半截回复" });
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const abortError = new Error("AbortError");
          abortError.name = "AbortError";
          reject(abortError);
        }, { once: true });
      });
    });

    registerSessionHandlers(ctx);
    registerSiliconPersonHandlers(ctx);

    const sendMessageHandler = ipcHandleRegistry.get("silicon-person:send-message");
    const cancelHandler = ipcHandleRegistry.get("session:cancel-run");

    expect(sendMessageHandler).toBeTypeOf("function");
    expect(cancelHandler).toBeTypeOf("function");

    // fire-and-forget：立即返回
    await sendMessageHandler?.({}, "sp-1", {
      content: "请先输出一半，再取消",
    });

    await vi.waitFor(() => {
      expect(ctx.state.siliconPersons[0]?.currentSessionId).toBeTruthy();
      expect(ctx.state.activeSessionRuns.size).toBe(1);
    });

    const sessionId = ctx.state.siliconPersons[0]?.currentSessionId!;
    const run = ctx.state.activeSessionRuns.get(sessionId);

    const cancelResult = await cancelHandler?.({}, sessionId, { runId: run?.runId }) as {
      success: boolean;
      state: string;
    };

    expect(cancelResult).toEqual({
      success: true,
      state: "canceling",
    });
    expect(["canceling", "canceled"]).toContain(ctx.state.siliconPersons[0]?.status);
    expect(["canceling", "canceled"]).toContain(ctx.state.siliconPersons[0]?.sessions[0]?.status);

    // 等待后台队列完成（cancel 结束后 drain 会 settle）
    await vi.waitFor(() => {
      expect(ctx.state.siliconPersons[0]?.status).toBe("canceled");
    });

    expect(ctx.state.siliconPersons[0]?.sessions[0]).toMatchObject({
      id: sessionId,
      status: "canceled",
    });
  });

  it("marks the silicon person as needs_approval while a shared tool approval is pending", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const ctx = buildContext({
      siliconPersons: [buildSiliconPerson()],
    });

    resolveSessionRuntimeIntentMock.mockReturnValue({
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      runtimeVersion: 1,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
      degradationReason: null,
      planSource: "capability",
      fallbackAdapterIds: ["openai-compatible"],
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "请写入一个文件" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "",
        reasoning: "",
        toolCalls: [{
          id: "tool-1",
          name: "fs.write",
          argumentsJson: "{\"path\":\"todo.txt\",\"content\":\"hello\"}",
          input: {
            path: "todo.txt",
            content: "hello",
          },
        }],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "审批结果已处理。",
        reasoning: "",
        toolCalls: [],
        finishReason: "stop",
      });

    registerSessionHandlers(ctx);
    registerSiliconPersonHandlers(ctx);

    const sendMessageHandler = ipcHandleRegistry.get("silicon-person:send-message");
    const resolveApprovalHandler = ipcHandleRegistry.get("session:resolve-approval");

    expect(sendMessageHandler).toBeTypeOf("function");
    expect(resolveApprovalHandler).toBeTypeOf("function");

    // fire-and-forget
    await sendMessageHandler?.({}, "sp-1", {
      content: "请写入一个文件",
    });

    await vi.waitFor(() => {
      expect(ctx.state.getApprovalRequests()).toHaveLength(1);
    });

    const approvalRequest = ctx.state.getApprovalRequests()[0] as { id: string; sessionId: string };

    expect(ctx.state.siliconPersons[0]).toMatchObject({
      status: "needs_approval",
      needsApproval: true,
    });
    expect(ctx.state.siliconPersons[0]?.sessions[0]).toMatchObject({
      id: approvalRequest.sessionId,
      status: "needs_approval",
      needsApproval: true,
    });

    await resolveApprovalHandler?.({}, approvalRequest.id, "deny");

    // 等待后台队列完成
    await vi.waitFor(() => {
      expect(ctx.state.siliconPersons[0]?.needsApproval).toBe(false);
    });

    expect(ctx.state.siliconPersons[0]?.status).not.toBe("needs_approval");
  });

  it("bypasses shared approval prompts when the silicon person approvalMode is auto_approve", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const ctx = buildContext({
      siliconPersons: [{
        ...buildSiliconPerson(),
        approvalMode: "auto_approve",
      }],
    });

    resolveSessionRuntimeIntentMock.mockReturnValue({
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
    });
    resolveModelCapabilityMock.mockReturnValue({
      effective: {
        supportsReasoning: false,
        source: "registry",
      },
    });
    buildExecutionPlanMock.mockReturnValue({
      runtimeVersion: 1,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      reasoningEnabled: false,
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn",
      toolStrategy: "auto",
      degradationReason: null,
      planSource: "capability",
      fallbackAdapterIds: ["openai-compatible"],
    });
    assembleContextMock.mockReturnValue({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "请直接写入一个文件，不要再问我" },
      ],
      budgetUsed: 10,
      wasCompacted: false,
      compactionReason: null,
      removedCount: 0,
    });
    callModelMock
      .mockResolvedValueOnce({
        content: "",
        reasoning: "",
        toolCalls: [{
          id: "tool-1",
          name: "fs.write",
          argumentsJson: "{\"path\":\"todo.txt\",\"content\":\"hello\"}",
          input: {
            path: "todo.txt",
            content: "hello",
          },
        }],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "已经自动完成写入。",
        reasoning: "",
        toolCalls: [],
        finishReason: "stop",
      });

    registerSessionHandlers(ctx);
    registerSiliconPersonHandlers(ctx);

    const sendMessageHandler = ipcHandleRegistry.get("silicon-person:send-message");

    expect(sendMessageHandler).toBeTypeOf("function");

    // fire-and-forget
    await sendMessageHandler?.({}, "sp-1", {
      content: "请直接写入一个文件，不要再问我",
    });

    // 等待后台队列完成
    await vi.waitFor(() => {
      expect(["done", "idle"]).toContain(ctx.state.siliconPersons[0]?.status);
    });

    expect(ctx.state.getApprovalRequests()).toHaveLength(0);
    expect(ctx.state.siliconPersons[0]?.needsApproval).toBe(false);
    if (ctx.state.siliconPersons[0]?.sessions[0]) {
      expect(ctx.state.siliconPersons[0]?.sessions[0]?.needsApproval).not.toBe(true);
    }
  });

  it("marks a silicon person session as read without changing currentSession", async () => {
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const session1: ChatSession = {
      id: "session-1",
      title: "默认会话",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      siliconPersonId: "sp-1",
      createdAt: "2026-04-08T00:00:00.000Z",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "这是最新回复",
          createdAt: "2026-04-08T00:10:00.000Z",
        },
      ],
    };
    const session2: ChatSession = {
      ...session1,
      id: "session-2",
      title: "复盘会话",
      messages: [],
      createdAt: "2026-04-08T01:00:00.000Z",
    };
    const ctx = buildContext({
      sessions: [session1, session2],
      siliconPersons: [{
        ...buildSiliconPerson(),
        currentSessionId: "session-1",
        unreadCount: 3,
        hasUnread: true,
        sessions: [
          {
            id: "session-1",
            title: "默认会话",
            status: "done",
            unreadCount: 2,
            hasUnread: true,
            needsApproval: false,
            updatedAt: "2026-04-08T00:10:00.000Z",
          },
          {
            id: "session-2",
            title: "复盘会话",
            status: "running",
            unreadCount: 1,
            hasUnread: true,
            needsApproval: false,
            updatedAt: "2026-04-08T01:00:00.000Z",
          },
        ],
      }],
    });

    registerSiliconPersonHandlers(ctx);

    const markReadHandler = ipcHandleRegistry.get("silicon-person:mark-session-read");

    expect(markReadHandler).toBeTypeOf("function");

    const payload = await markReadHandler?.({}, "sp-1", "session-1") as {
      siliconPerson: SiliconPerson;
      session: ChatSession;
    };

    expect(payload.siliconPerson.currentSessionId).toBe("session-1");
    expect(payload.siliconPerson.unreadCount).toBe(1);
    expect(payload.siliconPerson.hasUnread).toBe(true);
    expect(payload.siliconPerson.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-1",
        unreadCount: 0,
        hasUnread: false,
      }),
      expect.objectContaining({
        id: "session-2",
        unreadCount: 1,
        hasUnread: true,
      }),
    ]));
  });

  it("starts a bound workflow run from the silicon person current session and reuses the shared workflow runtime", async () => {
    const { registerSiliconPersonHandlers } = await import("../src/main/ipc/silicon-persons");
    const ctx = buildContext({
      siliconPersons: [{
        ...buildSiliconPerson(),
        workflowIds: ["workflow-1"],
      }],
    });

    invokeRegisteredWorkflowStartRunMock.mockResolvedValue({
      runId: "workflow-run-1",
    });

    registerSiliconPersonHandlers(ctx);

    const startWorkflowHandler = ipcHandleRegistry.get("silicon-person:start-workflow-run");

    expect(startWorkflowHandler).toBeTypeOf("function");

    const payload = await startWorkflowHandler?.({}, "sp-1", "workflow-1") as {
      siliconPerson: SiliconPerson;
      session: ChatSession;
      runId: string;
    };

    expect(invokeRegisteredWorkflowStartRunMock).toHaveBeenCalledWith({
      workflowId: "workflow-1",
      initialState: expect.objectContaining({
        siliconPersonId: "sp-1",
        sessionId: payload.session.id,
      }),
    });
    expect(payload.runId).toBe("workflow-run-1");
    expect(payload.siliconPerson.currentSessionId).toBe(payload.session.id);
    expect(payload.session.siliconPersonId).toBe("sp-1");
  });
});
