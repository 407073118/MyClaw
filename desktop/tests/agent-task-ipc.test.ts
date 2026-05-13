import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession, SiliconPerson } from "@shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const sentEvents: Array<{ channel: string; payload: unknown }> = [];
const createSiliconPersonSessionMock = vi.fn();
const syncSiliconPersonExecutionResultMock = vi.fn();
const invokeRegisteredSessionSendMessageMock = vi.fn();
const cancelRegisteredSessionRunMock = vi.fn();
const releasePendingApprovalsForRunMock = vi.fn((ctx: RuntimeContext, run: { pendingApprovalIds?: string[] }) => {
  const pendingIds = run.pendingApprovalIds ?? [];
  ctx.state.setApprovalRequests(ctx.state.getApprovalRequests().filter((request) => !pendingIds.includes(request.id)));
  run.pendingApprovalIds = [];
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandleRegistry.set(channel, handler);
    }),
  },
  webContents: {
    getAllWebContents: () => [
      {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          sentEvents.push({ channel, payload });
        },
      },
    ],
  },
}));

vi.mock("../src/main/services/silicon-person-session", () => ({
  createSiliconPersonSession: createSiliconPersonSessionMock,
  syncSiliconPersonExecutionResult: syncSiliconPersonExecutionResultMock,
}));

vi.mock("../src/main/ipc/sessions", () => ({
  invokeRegisteredSessionSendMessage: invokeRegisteredSessionSendMessageMock,
  cancelRegisteredSessionRun: cancelRegisteredSessionRunMock,
  releasePendingApprovalsForRun: releasePendingApprovalsForRunMock,
}));

function buildSession(id = "main-session-1"): ChatSession {
  return {
    id,
    title: "主聊天",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    createdAt: "2026-05-12T00:00:00.000Z",
    messages: [],
  };
}

function buildSiliconPerson(id = "sp-1"): SiliconPerson {
  return {
    id,
    name: id === "sp-1" ? "Ada" : "Bob",
    title: "研究员",
    description: "处理主聊天派单",
    status: "idle",
    source: "personal",
    approvalMode: "inherit",
    currentSessionId: "existing-current-session",
    sessions: [],
    unreadCount: 0,
    hasUnread: false,
    needsApproval: false,
    workflowIds: [],
    modelProfileId: "profile-1",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function buildContext(rootDir: string, input?: {
  sessions?: ChatSession[];
  siliconPersons?: SiliconPerson[];
}): RuntimeContext {
  return {
    runtime: {
      myClawRootPath: rootDir,
      skillsRootPath: join(rootDir, "skills"),
      sessionsRootPath: join(rootDir, "sessions"),
      paths: {
        rootDir,
        myClawDir: rootDir,
        skillsDir: join(rootDir, "skills"),
        sessionsDir: join(rootDir, "sessions"),
        modelsDir: join(rootDir, "models"),
        settingsFile: join(rootDir, "settings.json"),
      },
    },
    state: {
      models: [],
      sessions: input?.sessions ?? [buildSession()],
      siliconPersons: input?.siliconPersons ?? [buildSiliconPerson()],
      skills: [],
      workflowDefinitions: {},
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
      activeSessionRuns: new Map(),
      getDefaultModelProfileId: () => "profile-1",
      setDefaultModelProfileId: () => {},
      getWorkflows: () => [],
      getApprovals: () => null,
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

describe("agent task ipc", () => {
  let rootDir = "";

  beforeEach(() => {
    vi.resetModules();
    ipcHandleRegistry.clear();
    sentEvents.length = 0;
    createSiliconPersonSessionMock.mockReset();
    syncSiliconPersonExecutionResultMock.mockReset();
    invokeRegisteredSessionSendMessageMock.mockReset();
    cancelRegisteredSessionRunMock.mockReset();
    releasePendingApprovalsForRunMock.mockClear();
    rootDir = mkdtempSync(join(tmpdir(), "myclaw-agent-task-"));
  });

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("runs an agent task in isolated child sessions and writes a result summary", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir, {
      siliconPersons: [buildSiliconPerson("sp-1"), buildSiliconPerson("sp-2")],
    });

    createSiliconPersonSessionMock
      .mockResolvedValueOnce({
        siliconPerson: ctx.state.siliconPersons[0],
        session: { ...buildSession("child-session-1"), siliconPersonId: "sp-1" },
      })
      .mockResolvedValueOnce({
        siliconPerson: ctx.state.siliconPersons[1],
        session: { ...buildSession("child-session-2"), siliconPersonId: "sp-2" },
      });
    invokeRegisteredSessionSendMessageMock
      .mockImplementation(async (sessionId: string) => sessionId === "child-session-1" ? {
        session: {
          ...buildSession("child-session-1"),
          siliconPersonId: "sp-1",
          chatRunState: { status: "completed" },
          messages: [
            { id: "a1", role: "assistant", content: "Ada 输出了风险清单", createdAt: "2026-05-12T00:01:00.000Z" },
          ],
        },
      } : {
        session: {
          ...buildSession("child-session-2"),
          siliconPersonId: "sp-2",
          chatRunState: { status: "completed" },
          messages: [
            { id: "b1", role: "assistant", content: "Bob 补充了发布建议", createdAt: "2026-05-12T00:02:00.000Z" },
          ],
        },
      });
    syncSiliconPersonExecutionResultMock.mockImplementation(async (_ctx, input) => {
      const person = ctx.state.siliconPersons.find((item) => item.id === input.siliconPersonId)!;
      return person;
    });

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    await createHandler({}, {
      sourceSessionId: "main-session-1",
      sourceMessageId: "main-message-1",
      instruction: "整理发布风险",
      mode: "delegate",
      assigneeIds: ["sp-1", "sp-2"],
    });

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as unknown[];
      expect(tasks[0]).toMatchObject({
        status: "succeeded",
        resultSummary: "Ada 输出了风险清单\n\nBob 补充了发布建议",
        childSessionIds: {
          "sp-1": "child-session-1",
          "sp-2": "child-session-2",
        },
        assigneeStatuses: {
          "sp-1": "succeeded",
          "sp-2": "succeeded",
        },
      });
    });

    expect(createSiliconPersonSessionMock).toHaveBeenCalledWith(ctx, expect.objectContaining({
      siliconPersonId: "sp-1",
      preserveCurrentSession: true,
    }));
    expect(sentEvents.some((event) => event.channel === "agent-task:changed")).toBe(true);
  });

  it("appends a completed task result to the source main session once", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const sourceSession = buildSession("main-session-1");
    const ctx = buildContext(rootDir, { sessions: [sourceSession] });

    createSiliconPersonSessionMock.mockResolvedValue({
      siliconPerson: ctx.state.siliconPersons[0],
      session: { ...buildSession("child-session-append"), siliconPersonId: "sp-1" },
    });
    invokeRegisteredSessionSendMessageMock.mockResolvedValue({
      session: {
        ...buildSession("child-session-append"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "completed" },
        messages: [
          { id: "result-1", role: "assistant", content: "可以灰度发布，风险较低。", createdAt: "2026-05-12T00:03:00.000Z" },
        ],
      },
    });
    syncSiliconPersonExecutionResultMock.mockResolvedValue(ctx.state.siliconPersons[0]);

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const appendHandler = ipcHandleRegistry.get("agent-task:append-result-to-source")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    const created = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "评估发布风险",
      assigneeIds: ["sp-1"],
    }) as { task: { id: string } };

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as Array<{ status: string; resultSummary?: string }>;
      expect(tasks[0]).toMatchObject({
        status: "succeeded",
        resultSummary: "可以灰度发布，风险较低。",
      });
    });

    const first = await appendHandler({}, created.task.id) as { task: { appendedMessageId?: string } };
    const second = await appendHandler({}, created.task.id) as { task: { appendedMessageId?: string } };

    expect(ctx.state.sessions[0]?.messages).toHaveLength(1);
    expect(ctx.state.sessions[0]?.messages[0]).toMatchObject({
      id: first.task.appendedMessageId,
      role: "assistant",
      content: expect.stringContaining("Agent Task 完成：评估发布风险"),
    });
    expect(ctx.state.sessions[0]?.messages[0]?.content).toContain("可以灰度发布，风险较低。");
    expect(second.task.appendedMessageId).toBe(first.task.appendedMessageId);
    expect(sentEvents.some((event) => event.channel === "session:stream")).toBe(true);
  });

  it("marks a task as waiting_user when the worker session waits for approval", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);

    createSiliconPersonSessionMock.mockResolvedValue({
      siliconPerson: ctx.state.siliconPersons[0],
      session: { ...buildSession("child-session-approval"), siliconPersonId: "sp-1" },
    });
    invokeRegisteredSessionSendMessageMock.mockResolvedValue({
      session: {
        ...buildSession("child-session-approval"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "running" },
        messages: [],
      },
    });
    syncSiliconPersonExecutionResultMock.mockResolvedValue(ctx.state.siliconPersons[0]);
    ctx.state.getApprovalRequests = () => [{ id: "approval-1", sessionId: "child-session-approval" } as never];

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "需要审批的任务",
      assigneeIds: ["sp-1"],
    });

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as unknown[];
      expect(tasks[0]).toMatchObject({
        status: "waiting_user",
        approvalIds: ["approval-1"],
        assigneeStatuses: {
          "sp-1": "waiting_user",
        },
      });
    });
  });

  it("keeps a visible failed task instead of leaving a queued orphan when child session creation fails", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);

    createSiliconPersonSessionMock.mockRejectedValue(new Error("model missing"));

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    const payload = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "无法创建会话的任务",
      assigneeIds: ["sp-1"],
    }) as { task: { status: string; error?: string } };

    expect(payload.task).toMatchObject({
      status: "failed",
      error: "model missing",
    });
    const tasks = await listHandler({}) as Array<{ status: string }>;
    expect(tasks[0]?.status).toBe("failed");
  });

  it("rejects tasks whose source session does not exist", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;

    await expect(createHandler({}, {
      sourceSessionId: "missing-session",
      instruction: "主聊天不存在",
      assigneeIds: ["sp-1"],
    })).rejects.toThrow("Agent task source session not found");
  });

  it("cancels a queued or running task and clears pending worker queue entries", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);
    let releaseRun: ((value: unknown) => void) | null = null;

    createSiliconPersonSessionMock.mockResolvedValue({
      siliconPerson: ctx.state.siliconPersons[0],
      session: { ...buildSession("child-session-cancel"), siliconPersonId: "sp-1" },
    });
    invokeRegisteredSessionSendMessageMock.mockReturnValue(new Promise((resolve) => {
      releaseRun = resolve;
    }));

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const cancelHandler = ipcHandleRegistry.get("agent-task:cancel")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    const payload = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "需要取消的任务",
      assigneeIds: ["sp-1"],
    }) as { task: { id: string } };

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as Array<{ status: string }>;
      expect(tasks[0]?.status).toBe("running");
    });

    const cancelled = await cancelHandler({}, payload.task.id) as { task: { status: string } };
    expect(cancelled.task.status).toBe("cancelled");

    const tasks = await listHandler({}) as Array<{ status: string; assigneeStatuses: Record<string, string> }>;
    expect(tasks[0]).toMatchObject({
      status: "cancelled",
      assigneeStatuses: { "sp-1": "cancelled" },
    });

    releaseRun?.({
      session: {
        ...buildSession("child-session-cancel"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "completed" },
        messages: [{ id: "late", role: "assistant", content: "迟到结果", createdAt: "2026-05-12T00:03:00.000Z" }],
      },
    });
  });

  it("releases pending approvals when cancelling a task", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);
    let releaseRun: ((value: unknown) => void) | null = null;
    let approvalRequests = [{
      id: "approval-1",
      sessionId: "child-session-cancel-approval",
      source: "builtin-tool",
      toolId: "shell",
      label: "运行命令",
      risk: "medium",
      detail: "需要确认",
      status: "running",
      phase: "approval",
      createdAt: "2026-05-12T00:03:00.000Z",
    }];
    ctx.state.getApprovalRequests = () => approvalRequests as any;
    ctx.state.setApprovalRequests = (next) => {
      approvalRequests = next as any;
    };

    createSiliconPersonSessionMock.mockResolvedValue({
      siliconPerson: ctx.state.siliconPersons[0],
      session: { ...buildSession("child-session-cancel-approval"), siliconPersonId: "sp-1" },
    });
    invokeRegisteredSessionSendMessageMock.mockReturnValue(new Promise((resolve) => {
      releaseRun = resolve;
    }));

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const cancelHandler = ipcHandleRegistry.get("agent-task:cancel")!;

    const payload = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "等待审批后取消",
      assigneeIds: ["sp-1"],
    }) as { task: { id: string } };

    await vi.waitFor(async () => {
      const listHandler = ipcHandleRegistry.get("agent-task:list")!;
      const tasks = await listHandler({}) as Array<{ status: string }>;
      expect(tasks[0]?.status).toBe("running");
    });

    ctx.state.activeSessionRuns.set("child-session-cancel-approval", {
      runId: "run-approval",
      abortController: new AbortController(),
      status: "running",
      phase: "approval",
      currentMessageId: "message-1",
      pendingApprovalIds: ["approval-1"],
      cancelRequested: false,
    });

    await cancelHandler({}, payload.task.id);

    expect(releasePendingApprovalsForRunMock).toHaveBeenCalled();
    expect(approvalRequests).toHaveLength(0);
    expect(ctx.state.activeSessionRuns.get("child-session-cancel-approval")?.pendingApprovalIds).toEqual([]);

    releaseRun?.({
      session: {
        ...buildSession("child-session-cancel-approval"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "completed" },
        messages: [{ id: "cancelled", role: "assistant", content: "取消后返回", createdAt: "2026-05-12T00:04:00.000Z" }],
      },
    });
    await vi.waitFor(() => expect(syncSiliconPersonExecutionResultMock).toHaveBeenCalled());
  });

  it("ignores stale results when a cancelled task is retried immediately", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);
    let releaseOldRun: ((value: unknown) => void) | null = null;

    createSiliconPersonSessionMock
      .mockResolvedValueOnce({
        siliconPerson: ctx.state.siliconPersons[0],
        session: { ...buildSession("child-session-old"), siliconPersonId: "sp-1" },
      })
      .mockResolvedValueOnce({
        siliconPerson: ctx.state.siliconPersons[0],
        session: { ...buildSession("child-session-new"), siliconPersonId: "sp-1" },
      });
    invokeRegisteredSessionSendMessageMock
      .mockReturnValueOnce(new Promise((resolve) => {
        releaseOldRun = resolve;
      }))
      .mockResolvedValueOnce({
        session: {
          ...buildSession("child-session-new"),
          siliconPersonId: "sp-1",
          chatRunState: { status: "completed" },
          messages: [{ id: "new", role: "assistant", content: "新一轮结果", createdAt: "2026-05-12T00:04:00.000Z" }],
        },
      });
    syncSiliconPersonExecutionResultMock.mockResolvedValue(ctx.state.siliconPersons[0]);

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const cancelHandler = ipcHandleRegistry.get("agent-task:cancel")!;
    const retryHandler = ipcHandleRegistry.get("agent-task:retry")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    const payload = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "取消后立即重试",
      assigneeIds: ["sp-1"],
    }) as { task: { id: string } };

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as Array<{ status: string }>;
      expect(tasks[0]?.status).toBe("running");
    });

    await cancelHandler({}, payload.task.id);
    await retryHandler({}, payload.task.id);
    releaseOldRun?.({
      session: {
        ...buildSession("child-session-old"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "completed" },
        messages: [{ id: "old", role: "assistant", content: "旧一轮迟到结果", createdAt: "2026-05-12T00:05:00.000Z" }],
      },
    });

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as Array<{ status: string; resultSummary?: string; childSessionIds: Record<string, string> }>;
      expect(tasks[0]).toMatchObject({
        status: "succeeded",
        resultSummary: "新一轮结果",
        childSessionIds: { "sp-1": "child-session-new" },
      });
    });
  });

  it("retries a failed task using fresh child sessions", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);

    createSiliconPersonSessionMock
      .mockRejectedValueOnce(new Error("model missing"))
      .mockResolvedValueOnce({
        siliconPerson: ctx.state.siliconPersons[0],
        session: { ...buildSession("child-session-retry"), siliconPersonId: "sp-1" },
      });
    invokeRegisteredSessionSendMessageMock.mockResolvedValue({
      session: {
        ...buildSession("child-session-retry"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "completed" },
        messages: [{ id: "retry", role: "assistant", content: "重试成功", createdAt: "2026-05-12T00:04:00.000Z" }],
      },
    });
    syncSiliconPersonExecutionResultMock.mockResolvedValue(ctx.state.siliconPersons[0]);

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const retryHandler = ipcHandleRegistry.get("agent-task:retry")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    const failed = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "需要重试的任务",
      assigneeIds: ["sp-1"],
    }) as { task: { id: string; status: string } };
    expect(failed.task.status).toBe("failed");

    await retryHandler({}, failed.task.id);

    await vi.waitFor(async () => {
      const tasks = await listHandler({}) as Array<{ status: string; resultSummary?: string }>;
      expect(tasks[0]).toMatchObject({
        status: "succeeded",
        resultSummary: "重试成功",
      });
    });
  });

  it("creates a child follow-up task linked to the original task", async () => {
    const { registerAgentTaskHandlers } = await import("../src/main/ipc/agent-tasks");
    const ctx = buildContext(rootDir);

    createSiliconPersonSessionMock.mockResolvedValue({
      siliconPerson: ctx.state.siliconPersons[0],
      session: { ...buildSession("child-session-follow-up"), siliconPersonId: "sp-1" },
    });
    invokeRegisteredSessionSendMessageMock.mockResolvedValue({
      session: {
        ...buildSession("child-session-follow-up"),
        siliconPersonId: "sp-1",
        chatRunState: { status: "completed" },
        messages: [{ id: "follow", role: "assistant", content: "追问完成", createdAt: "2026-05-12T00:05:00.000Z" }],
      },
    });
    syncSiliconPersonExecutionResultMock.mockResolvedValue(ctx.state.siliconPersons[0]);

    registerAgentTaskHandlers(ctx);
    const createHandler = ipcHandleRegistry.get("agent-task:create")!;
    const followUpHandler = ipcHandleRegistry.get("agent-task:follow-up")!;
    const listHandler = ipcHandleRegistry.get("agent-task:list")!;

    const original = await createHandler({}, {
      sourceSessionId: "main-session-1",
      instruction: "原任务",
      assigneeIds: ["sp-1"],
    }) as { task: { id: string } };

    const followUp = await followUpHandler({}, {
      taskId: original.task.id,
      instruction: "补充说明",
    }) as { task: { parentTaskId?: string; sourceSessionId: string; instruction: string } };

    expect(followUp.task).toMatchObject({
      parentTaskId: original.task.id,
      sourceSessionId: "main-session-1",
      instruction: "补充说明",
    });
    const tasks = await listHandler({}) as Array<{ id: string; parentTaskId?: string }>;
    expect(tasks.some((task) => task.parentTaskId === original.task.id)).toBe(true);

    await vi.waitFor(async () => {
      const settledTasks = await listHandler({}) as Array<{ status: string }>;
      expect(settledTasks.every((task) => task.status === "succeeded")).toBe(true);
    });
  });
});
