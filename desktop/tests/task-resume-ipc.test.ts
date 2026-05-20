import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession } from "../shared/contracts";
import type { RuntimeContext } from "../src/main/services/runtime-context";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const sentStreamEvents: Array<{ channel: string; payload: unknown }> = [];
const saveSessionMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandleRegistry.set(channel, handler);
    }),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  webContents: {
    getAllWebContents: () => [{
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sentStreamEvents.push({ channel, payload: JSON.parse(JSON.stringify(payload)) });
      },
    }],
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveSession: saveSessionMock,
  saveSiliconPerson: vi.fn(),
  saveWorkflowRun: vi.fn(),
  deleteWorkflowRunFile: vi.fn(),
  deleteSessionFiles: vi.fn(),
  saveSettings: vi.fn(),
}));

/** 构造最小 runtime context，专注验证 task:resume IPC 状态回写。 */
function buildContext(session: ChatSession): RuntimeContext {
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
      sessions: [session],
      models: [],
      employees: [],
      workflowRuns: [],
      activeWorkflowRuns: new Map(),
      skills: [],
      workflowDefinitions: {},
      getDefaultModelProfileId: () => "model-1",
      setDefaultModelProfileId: () => {},
      getWorkflows: () => [],
      getApprovals: () => ({
        mode: "auto-read-only",
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
  } as unknown as RuntimeContext;
}

/** 构造一个处于 waiting_user 的 Task V2 会话。 */
function waitingSession(): ChatSession {
  return {
    id: "session-1",
    title: "Task resume",
    modelProfileId: "model-1",
    attachedDirectory: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    messages: [],
    tasks: [{
      id: "task-1",
      subject: "确认发布窗口",
      description: "等待用户确认",
      status: "waiting_user",
      blocks: [],
      blockedBy: [],
      metadata: {
        awaitingUser: true,
        interruptRequestId: "req-1",
      },
    }],
    taskInterrupts: [{
      requestId: "req-1",
      taskId: "task-1",
      status: "active",
      reason: "需要确认发布窗口",
      question: "今晚发布吗？",
      resumeToken: "token-1",
      schemaVersion: 1,
      createdAt: "2026-05-19T00:00:00.000Z",
    }],
  };
}

describe("task resume IPC", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ipcHandleRegistry.clear();
    sentStreamEvents.length = 0;
    saveSessionMock.mockReset().mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("resumes a waiting task only with a valid token", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const session = waitingSession();
    const ctx = buildContext(session);
    registerSessionHandlers(ctx);

    const resumeHandler = ipcHandleRegistry.get("task:resume");
    await expect(resumeHandler?.({}, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "wrong",
      action: "approve",
    })).rejects.toThrow("Invalid task resume token");

    const result = await resumeHandler?.({}, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "approve",
      payload: { choice: "yes" },
    }) as { task: { status: string }; request: { status: string } };

    expect(result.task.status).toBe("in_progress");
    expect(result.request.status).toBe("resolved");
    expect(session.tasks?.[0]?.status).toBe("in_progress");
    expect(session.taskInterrupts?.[0]?.status).toBe("resolved");
    expect(session.messages.at(-1)?.content).toContain("task_resume");
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    expect(sentStreamEvents.some((event) => Array.isArray((event.payload as { tasks?: unknown[] }).tasks))).toBe(true);
  }, 15_000);

  it("persists expired requests before rejecting resume", async () => {
    const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
    const session = waitingSession();
    session.taskInterrupts![0] = {
      ...session.taskInterrupts![0]!,
      expiresAt: "2000-01-01T00:00:00.000Z",
    };
    const ctx = buildContext(session);
    registerSessionHandlers(ctx);

    const resumeHandler = ipcHandleRegistry.get("task:resume");
    await expect(resumeHandler?.({}, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "approve",
    })).rejects.toThrow("Task interrupt request expired");

    expect(session.taskInterrupts?.[0]?.status).toBe("expired");
    expect(session.tasks?.[0]?.status).toBe("blocked");
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
  }, 15_000);
});
