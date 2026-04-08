/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => {
  function createSiliconPersons() {
    return [
      {
        id: "sp-1",
        name: "Ada",
        title: "研究搭档",
        description: "负责把主聊天意图沉淀到私域工作空间。",
        status: "done",
        source: "personal",
        approvalMode: "inherit",
        currentSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "默认会话",
            status: "done",
            unreadCount: 2,
            hasUnread: true,
            needsApproval: false,
            updatedAt: "2026-04-08T00:00:00.000Z",
          },
          {
            id: "session-2",
            title: "复盘会话",
            status: "running",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: true,
            updatedAt: "2026-04-08T01:00:00.000Z",
          },
        ],
        unreadCount: 2,
        hasUnread: true,
        needsApproval: true,
        updatedAt: "2026-04-08T01:00:00.000Z",
        workflowIds: ["workflow-1"],
      },
    ];
  }

  function createSessions() {
    return [
      {
        id: "session-1",
        title: "默认会话",
        modelProfileId: "model-1",
        attachedDirectory: null,
        createdAt: "2026-04-08T00:00:00.000Z",
        runtimeVersion: 2,
        siliconPersonId: "sp-1",
        tasks: [
          {
            id: "task-1",
            subject: "拆解任务",
            description: "先列出两个可执行步骤。",
            status: "pending",
            blocks: [],
            blockedBy: [],
          },
          {
            id: "task-2",
            subject: "收集资料",
            description: "直接从私域会话和文档里取上下文。",
            status: "in_progress",
            blocks: ["task-3"],
            blockedBy: [],
          },
        ],
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "先把问题拆解成三个动作。",
            createdAt: "2026-04-08T00:10:00.000Z",
          },
        ],
      },
      {
        id: "session-2",
        title: "复盘会话",
        modelProfileId: "model-1",
        attachedDirectory: null,
        createdAt: "2026-04-08T01:00:00.000Z",
        runtimeVersion: 2,
        siliconPersonId: "sp-1",
        messages: [],
      },
    ];
  }

  function createWorkflows() {
    return [
      {
        id: "workflow-1",
        name: "调研 SOP",
      },
    ];
  }

  function createWorkflowRuns() {
    return {
      "run-1": {
        id: "run-1",
        workflowId: "workflow-1",
        workflowVersion: 3,
        status: "running",
        currentNodeIds: ["node-a"],
        startedAt: "2026-04-08T00:20:00.000Z",
        updatedAt: "2026-04-08T00:30:00.000Z",
      },
      "run-2": {
        id: "run-2",
        workflowId: "workflow-1",
        workflowVersion: 3,
        status: "waiting-input",
        currentNodeIds: ["node-b"],
        startedAt: "2026-04-08T00:40:00.000Z",
        updatedAt: "2026-04-08T00:50:00.000Z",
        totalSteps: 5,
      },
    };
  }

  const workspace = {
    approvalRequests: [] as Array<{
      id: string;
      sessionId: string;
      source: string;
      toolId: string;
      label: string;
      risk: string;
      detail: string;
      resumeConversation?: boolean;
      serverId?: string;
      toolName?: string;
      arguments?: Record<string, unknown>;
    }>,
    siliconPersons: createSiliconPersons(),
    sessions: createSessions(),
    workflows: createWorkflows(),
    workflowRuns: createWorkflowRuns(),
    loadSiliconPersonById: vi.fn().mockResolvedValue(null),
    loadWorkflows: vi.fn().mockResolvedValue([]),
    updateSiliconPerson: vi.fn((siliconPersonId: string, input: Record<string, unknown>) => {
      const target = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!target) return Promise.resolve(null);
      Object.assign(target, input);
      return Promise.resolve(target);
    }),
    createSiliconPersonSession: vi.fn((siliconPersonId: string) => {
      const target = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!target) return Promise.resolve(null);
      const nextSessionId = `session-${workspace.sessions.length + 1}`;
      const session = {
        id: nextSessionId,
        title: "新建会话",
        modelProfileId: "model-1",
        attachedDirectory: null,
        createdAt: "2026-04-08T02:30:00.000Z",
        runtimeVersion: 2,
        siliconPersonId,
        messages: [],
        tasks: [],
      };
      workspace.sessions = [...workspace.sessions, session as never];
      target.sessions = [
        ...target.sessions,
        {
          id: nextSessionId,
          title: session.title,
          status: "idle",
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          updatedAt: session.createdAt,
        },
      ];
      target.currentSessionId = nextSessionId;
      return Promise.resolve(session);
    }),
    switchSiliconPersonSession: vi.fn((siliconPersonId: string, sessionId: string) => {
      const target = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!target) return Promise.resolve(null);
      target.currentSessionId = sessionId;
      return Promise.resolve(workspace.sessions.find((item) => item.id === sessionId) ?? null);
    }),
    sendSiliconPersonMessage: vi.fn((siliconPersonId: string, content: string) => {
      const target = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!target) return Promise.resolve(null);
      const session = workspace.sessions.find((item) => item.id === target.currentSessionId);
      if (session) {
        session.messages = [
          ...session.messages,
          {
            id: `msg-${session.messages.length + 2}`,
            role: "user",
            content,
            createdAt: "2026-04-08T02:15:00.000Z",
          },
        ];
      }
      return Promise.resolve(session ?? null);
    }),
    startSiliconPersonWorkflowRun: vi.fn().mockResolvedValue(null),
    applySessionUpdate: vi.fn((session: Record<string, unknown>) => {
      const nextSession = session as {
        id?: string;
        title?: string;
        status?: string;
        unreadCount?: number;
        hasUnread?: boolean;
        needsApproval?: boolean;
        updatedAt?: string;
        tasks?: Array<Record<string, unknown>>;
      };
      const target = workspace.sessions.find((item) => item.id === nextSession.id);
      if (target && typeof nextSession.id === "string") {
        Object.assign(target, nextSession);
        const siliconPerson = workspace.siliconPersons.find((item) => item.sessions.some((summary) => summary.id === nextSession.id));
        if (siliconPerson) {
          const summary = siliconPerson.sessions.find((item) => item.id === nextSession.id);
          if (summary) {
            Object.assign(summary, {
              title: nextSession.title ?? summary.title,
              status: nextSession.status ?? summary.status,
              unreadCount: nextSession.unreadCount ?? summary.unreadCount,
              hasUnread: nextSession.hasUnread ?? summary.hasUnread,
              needsApproval: nextSession.needsApproval ?? summary.needsApproval,
              updatedAt: nextSession.updatedAt ?? summary.updatedAt,
            });
          }
          Object.assign(siliconPerson, {
            currentSessionId: siliconPerson.currentSessionId ?? nextSession.id,
            unreadCount: typeof nextSession.unreadCount === "number" ? nextSession.unreadCount : siliconPerson.unreadCount,
            hasUnread: typeof nextSession.hasUnread === "boolean" ? nextSession.hasUnread : siliconPerson.hasUnread,
            needsApproval: typeof nextSession.needsApproval === "boolean" ? nextSession.needsApproval : siliconPerson.needsApproval,
            updatedAt: nextSession.updatedAt ?? siliconPerson.updatedAt,
          });
        }
      }
      return nextSession;
    }),
    patchSessionTasks: vi.fn((sessionId: string, tasks: Array<Record<string, unknown>>) => {
      const target = workspace.sessions.find((item) => item.id === sessionId);
      if (target) {
        target.tasks = tasks as never;
      }
    }),
    addApprovalRequest: vi.fn((request: Record<string, unknown>) => {
      workspace.approvalRequests = [...workspace.approvalRequests, request as never];
    }),
    markSiliconPersonSessionRead: vi.fn((siliconPersonId: string, sessionId: string) => {
      const siliconPerson = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!siliconPerson) return;
      const summary = siliconPerson.sessions.find((item) => item.id === sessionId);
      if (summary) {
        summary.unreadCount = 0;
        summary.hasUnread = false;
      }
      siliconPerson.unreadCount = siliconPerson.sessions.reduce((total, item) => total + item.unreadCount, 0);
      siliconPerson.hasUnread = siliconPerson.sessions.some((item) => item.hasUnread);
      return Promise.resolve(null);
    }),
    resolveApproval: vi.fn().mockResolvedValue(null),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  return {
    createSiliconPersons,
    createSessions,
    createWorkflows,
    createWorkflowRuns,
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("Silicon person studio page", () => {
  beforeEach(() => {
    Object.assign(mocks.workspace, {
      approvalRequests: [],
      siliconPersons: [
        {
          id: "sp-1",
          name: "Ada",
          title: "研究搭档",
          description: "负责把主聊天意图沉淀到私域工作空间。",
          status: "done",
          source: "personal",
          approvalMode: "inherit",
          currentSessionId: "session-1",
          sessions: [
            {
              id: "session-1",
              title: "默认会话",
              status: "done",
              unreadCount: 2,
              hasUnread: true,
              needsApproval: false,
              updatedAt: "2026-04-08T00:00:00.000Z",
            },
            {
              id: "session-2",
              title: "复盘会话",
              status: "running",
              unreadCount: 0,
              hasUnread: false,
              needsApproval: true,
              updatedAt: "2026-04-08T01:00:00.000Z",
            },
          ],
          unreadCount: 2,
          hasUnread: true,
          needsApproval: true,
          updatedAt: "2026-04-08T01:00:00.000Z",
          workflowIds: ["workflow-1"],
        },
      ],
      sessions: [
        {
          id: "session-1",
          title: "默认会话",
          modelProfileId: "model-1",
          attachedDirectory: null,
          createdAt: "2026-04-08T00:00:00.000Z",
          runtimeVersion: 2,
          siliconPersonId: "sp-1",
          tasks: [
            {
              id: "task-1",
              subject: "拆解任务",
              description: "先列出两个可执行步骤。",
              status: "pending",
              blocks: [],
              blockedBy: [],
            },
            {
              id: "task-2",
              subject: "收集资料",
              description: "直接从私域会话和文档里取上下文。",
              status: "in_progress",
              blocks: ["task-3"],
              blockedBy: [],
            },
          ],
          messages: [
            {
              id: "msg-1",
              role: "assistant",
              content: "先把问题拆解成三个动作。",
              createdAt: "2026-04-08T00:10:00.000Z",
            },
          ],
        },
        {
          id: "session-2",
          title: "复盘会话",
          modelProfileId: "model-1",
          attachedDirectory: null,
          createdAt: "2026-04-08T01:00:00.000Z",
          runtimeVersion: 2,
          siliconPersonId: "sp-1",
          messages: [],
        },
      ],
      workflows: [
        {
          id: "workflow-1",
          name: "调研 SOP",
        },
      ],
      workflowRuns: {
        "run-1": {
          id: "run-1",
          workflowId: "workflow-1",
          workflowVersion: 3,
          status: "running",
          currentNodeIds: ["node-a"],
          startedAt: "2026-04-08T00:20:00.000Z",
          updatedAt: "2026-04-08T00:30:00.000Z",
        },
        "run-2": {
          id: "run-2",
          workflowId: "workflow-1",
          workflowVersion: 3,
          status: "waiting-input",
          currentNodeIds: ["node-b"],
          startedAt: "2026-04-08T00:40:00.000Z",
          updatedAt: "2026-04-08T00:50:00.000Z",
          totalSteps: 5,
        },
      },
    });
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
      },
    });
  });

  afterEach(() => {
    cleanup();
    mocks.workspace.loadSiliconPersonById.mockClear();
    mocks.workspace.loadWorkflows.mockClear();
    mocks.workspace.updateSiliconPerson.mockClear();
    mocks.workspace.createSiliconPersonSession.mockClear();
    mocks.workspace.switchSiliconPersonSession.mockClear();
    mocks.workspace.sendSiliconPersonMessage.mockClear();
    mocks.workspace.startSiliconPersonWorkflowRun.mockClear();
    mocks.workspace.applySessionUpdate.mockClear();
    mocks.workspace.patchSessionTasks.mockClear();
    mocks.workspace.addApprovalRequest.mockClear();
    mocks.workspace.markSiliconPersonSessionRead.mockClear();
    mocks.workspace.resolveApproval.mockClear();
    mocks.workspace.approvalRequests = [];
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("renders the current silicon person session thread instead of the old placeholder-only studio", async () => {
    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    expect(screen.getByTestId("silicon-person-studio-view")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-session-tab-session-1")).toBeTruthy();
    expect(screen.getByText("先把问题拆解成三个动作。")).toBeTruthy();
    expect(screen.queryByText("Pending work summary")).toBeNull();
  });

  it("lets the studio create sessions, switch currentSession, and send routed messages", async () => {
    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByTestId("silicon-person-session-create"));
    expect(mocks.workspace.createSiliconPersonSession).toHaveBeenCalledWith("sp-1");

    fireEvent.click(screen.getByTestId("silicon-person-session-tab-session-2"));
    expect(mocks.workspace.switchSiliconPersonSession).toHaveBeenCalledWith("sp-1", "session-2");

    fireEvent.change(screen.getByTestId("silicon-person-composer-input"), {
      target: { value: "请先拆解任务" },
    });
    fireEvent.click(screen.getByTestId("silicon-person-composer-submit"));

    await waitFor(() => {
      expect(mocks.workspace.sendSiliconPersonMessage).toHaveBeenCalledWith("sp-1", "请先拆解任务");
    });
  });

  it("supports editing approval mode and saving it with the silicon person card", async () => {
    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    fireEvent.change(screen.getByTestId("employee-studio-approval-mode"), {
      target: { value: "auto_approve" },
    });
    fireEvent.click(screen.getByText("保存硅基员工"));

    await waitFor(() => {
      expect(mocks.workspace.updateSiliconPerson).toHaveBeenCalledWith(
        "sp-1",
        expect.objectContaining({
          approvalMode: "auto_approve",
        }),
      );
    });
  });

  it("marks the current session as read on mount and when switching sessions", async () => {
    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    await waitFor(() => {
      expect(mocks.workspace.markSiliconPersonSessionRead).toHaveBeenCalledWith("sp-1", "session-1");
    });

    fireEvent.click(screen.getByTestId("silicon-person-session-tab-session-2"));

    await waitFor(() => {
      expect(mocks.workspace.markSiliconPersonSessionRead).toHaveBeenCalledWith("sp-1", "session-2");
    });
  });

  it("listens to session stream events and updates the current session, task list, and approval queue", async () => {
    let sessionStreamHandler: ((event: Record<string, unknown>) => void) | undefined;
    const sessionStreamUnsubscribe = vi.fn();

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          sessionStreamHandler = callback;
          return sessionStreamUnsubscribe;
        }),
      },
    });

    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    await act(async () => {
      sessionStreamHandler?.({
        type: "session.updated",
        session: {
          ...mocks.workspace.sessions[0],
          title: "默认会话（已更新）",
          updatedAt: "2026-04-08T02:00:00.000Z",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "默认会话（已更新）" })).toBeTruthy();
    });

    await act(async () => {
      sessionStreamHandler?.({
        type: "tasks.updated",
        sessionId: "session-1",
        tasks: [
          {
            id: "task-3",
            subject: "新增任务",
            description: "stream 事件写入的新任务。",
            status: "pending",
            blocks: [],
            blockedBy: [],
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("新增任务")).toBeTruthy();
      expect(mocks.workspace.patchSessionTasks).toHaveBeenCalledWith(
        "session-1",
        expect.arrayContaining([
          expect.objectContaining({ id: "task-3" }),
        ]),
      );
    });

    await act(async () => {
      sessionStreamHandler?.({
        type: "approval.requested",
        approvalRequest: {
          id: "approval-1",
          sessionId: "session-1",
          source: "shell-command",
          toolId: "shell",
          label: "列出目录",
          risk: "write",
          detail: "需要先确认一次。",
          resumeConversation: true,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("silicon-person-approval-request-approval-1")).toBeTruthy();
      expect(mocks.workspace.addApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining({ id: "approval-1", sessionId: "session-1" }),
      );
    });
  });

  it("lets the studio resolve approval requests from the current session", async () => {
    mocks.workspace.approvalRequests = [
      {
        id: "approval-1",
        sessionId: "session-1",
        source: "shell-command",
        toolId: "shell",
        label: "列出目录",
        risk: "write",
        detail: "需要确认一次。",
        resumeConversation: true,
      },
    ];

    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByTestId("silicon-person-approval-allow-once-approval-1"));

    await waitFor(() => {
      expect(mocks.workspace.resolveApproval).toHaveBeenCalledWith("approval-1", "allow-once");
    });

    fireEvent.click(screen.getByTestId("silicon-person-approval-deny-approval-1"));

    await waitFor(() => {
      expect(mocks.workspace.resolveApproval).toHaveBeenCalledWith("approval-1", "deny");
    });
  });

  it("shows the current session tasklist and workflow binding/run state", async () => {
    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    expect(screen.getByTestId("silicon-person-tasklist")).toBeTruthy();
    expect(screen.getByText("拆解任务")).toBeTruthy();
    expect(screen.getByText("收集资料")).toBeTruthy();
    expect(screen.getByText("待办")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-workflow-binding-workflow-1").textContent).toContain("调研 SOP");
    expect(screen.getByTestId("silicon-person-workflow-run-run-1")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-workflow-run-run-2")).toBeTruthy();
  });

  it("starts a bound workflow run from the studio workflow card", async () => {
    const { default: EmployeeStudioPage } = await import("../src/renderer/pages/EmployeeStudioPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(EmployeeStudioPage),
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByTestId("silicon-person-workflow-start-workflow-1"));

    expect(mocks.workspace.startSiliconPersonWorkflowRun).toHaveBeenCalledWith("sp-1", "workflow-1");
  });
});
