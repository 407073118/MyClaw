/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import type { PlanState } from "@shared/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const CHAT_PAGE_UI_TIMEOUT_MS = 20000;

const mocks = vi.hoisted(() => {
  const basePlanState: PlanState = {
    updatedAt: "2026-04-06T00:10:00.000Z",
    tasks: [
      {
        id: "collect-context",
        title: "收集上下文",
        status: "in_progress",
        detail: "正在读取目标文件",
      },
      {
        id: "apply-ui",
        title: "补充最小调试面板",
        status: "blocked",
        blocker: "等待上一步完成",
      },
    ],
  };

  const session: {
    id: string;
    title: string;
    modelProfileId: string;
    attachedDirectory: null;
    createdAt: string;
    planState: PlanState | null;
    planModeState?: Record<string, unknown> | null;
    messages: unknown[];
  } = {
    id: "chat-session-plan",
    title: "Planner Session",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    createdAt: "2026-04-06T00:00:00.000Z",
    planState: null,
    planModeState: null,
    messages: [],
  };

  const workspace = {
    currentSession: session,
    sessions: [session],
    approvalRequests: [],
    skills: [],
    selectSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    pushAssistantMessage: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    approvePlan: vi.fn(),
    resolveApproval: vi.fn(),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  return {
    basePlanState,
    session,
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("Phase 3 plan mode UI", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.selectSession.mockReset();
    mocks.workspace.deleteSession.mockReset();
    mocks.workspace.pushAssistantMessage.mockReset();
    mocks.workspace.createSession.mockReset();
    mocks.workspace.sendMessage.mockReset();
    mocks.workspace.approvePlan.mockReset();
    mocks.workspace.resolveApproval.mockReset();
    mocks.session.planState = null;
    mocks.session.planModeState = null;
    mocks.session.messages = [];
    Reflect.deleteProperty(window, "myClawAPI");
  });

  it("shows explicit approval actions when the session is waiting for plan approval", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.getByRole("button", { name: "批准执行" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "完善" })).toBeTruthy();
  }, CHAT_PAGE_UI_TIMEOUT_MS);

  it("sends the current feedback back into the planner when revising a plan", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "请把计划拆成分析、实现、验证三步" } });
    fireEvent.click(screen.getByRole("button", { name: "完善" }));

    await waitFor(() => expect(composer.value).toBe(""));
    expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请把计划拆成分析、实现、验证三步");
  }, CHAT_PAGE_UI_TIMEOUT_MS);

  it("uses the default refinement prompt when the composer is empty", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    fireEvent.click(screen.getByRole("button", { name: "完善" }));

    await waitFor(() => expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe(""));
    expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请根据最新补充继续完善当前计划。");
  }, CHAT_PAGE_UI_TIMEOUT_MS);

  it("approves and immediately starts execution with the current composer draft", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "请按计划开始执行" } });
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }));

    await waitFor(() => expect(composer.value).toBe(""));
    expect(mocks.workspace.approvePlan).toHaveBeenCalledTimes(1);
    expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请按计划开始执行");
  }, CHAT_PAGE_UI_TIMEOUT_MS);

  it("uses the default execution prompt when approving an empty composer", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    fireEvent.click(screen.getByRole("button", { name: "批准执行" }));

    await waitFor(() => expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe(""));
    expect(mocks.workspace.approvePlan).toHaveBeenCalledTimes(1);
    expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请开始执行当前计划。");
  }, CHAT_PAGE_UI_TIMEOUT_MS);

  it("keeps the composer draft when approval succeeds but the execution kickoff fails", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };
    mocks.workspace.sendMessage.mockRejectedValueOnce(new Error("kickoff failed"));

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "请先执行第一步" } });
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }));

    await waitFor(() => expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请先执行第一步"));
    expect(mocks.workspace.approvePlan).toHaveBeenCalledTimes(1);
    expect(composer.value).toBe("请先执行第一步");
  }, CHAT_PAGE_UI_TIMEOUT_MS);

  it("clears whitespace-only composer content after falling back to the default refinement prompt", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "awaiting_approval",
      approvalStatus: "pending",
      structuredPlan: {
        goal: "Ship visible plan mode",
      },
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "完善" }));

    await waitFor(() => expect(composer.value).toBe(""));
    expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请根据最新补充继续完善当前计划。");
  }, CHAT_PAGE_UI_TIMEOUT_MS);
});

describe("Phase 3 plan UI", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.selectSession.mockReset();
    mocks.workspace.deleteSession.mockReset();
    mocks.workspace.pushAssistantMessage.mockReset();
    mocks.workspace.createSession.mockReset();
    mocks.workspace.sendMessage.mockReset();
    mocks.workspace.approvePlan.mockReset();
    mocks.workspace.resolveApproval.mockReset();
    mocks.session.planState = null;
    mocks.session.planModeState = null;
    mocks.session.messages = [];
    Reflect.deleteProperty(window, "myClawAPI");
  });

  it("formats known plan statuses locally and keeps raw fallback for unknown future statuses", async () => {
    const { PlanSidePanel } = await import("../src/renderer/components/PlanSidePanel");
    const futurePlanState: PlanState = {
      updatedAt: mocks.basePlanState.updatedAt,
      tasks: [
        ...mocks.basePlanState.tasks,
        {
          id: "future-task",
          title: "等待未来状态",
          status: "queued",
        },
      ],
    };

    render(React.createElement(PlanSidePanel, {
      planState: futurePlanState,
      planModeState: { mode: "executing" },
    }));

    const panel = screen.getByTestId("plan-side-panel");
    expect(within(panel).getByText("收集上下文")).toBeTruthy();
    expect(within(panel).getByText("补充最小调试面板")).toBeTruthy();
    // 侧边面板用图标表示状态，进行中 = ◐, 已阻塞 = ✕
    expect(within(panel).getByTestId("plan-task-status-collect-context").getAttribute("data-status")).toBe("in_progress");
    expect(within(panel).getByTestId("plan-task-status-apply-ui").getAttribute("data-status")).toBe("blocked");
    // 未知状态应保留原值作为 data-status
    expect(within(panel).getByTestId("plan-task-status-future-task").getAttribute("data-status")).toBe("queued");
  });

  it("does not render when planState is absent or has no tasks", async () => {
    const { PlanSidePanel } = await import("../src/renderer/components/PlanSidePanel");
    const { rerender } = render(React.createElement(PlanSidePanel, {
      planState: undefined as never,
      planModeState: { mode: "executing" },
    }));

    expect(screen.queryByTestId("plan-side-panel")).toBeNull();

    rerender(React.createElement(PlanSidePanel, {
      planState: {
        updatedAt: "2026-04-06T00:11:00.000Z",
        tasks: [],
      },
      planModeState: { mode: "executing" },
    }));

    expect(screen.queryByTestId("plan-side-panel")).toBeNull();
  });

  it("mounts the plan side panel through ChatPage when the session has planState and planModeState", async () => {
    mocks.session.planState = mocks.basePlanState;
    mocks.session.planModeState = {
      mode: "executing",
      approvalStatus: "approved",
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const panel = screen.getByTestId("plan-side-panel");
    expect(within(panel).getByText("收集上下文")).toBeTruthy();
    expect(within(panel).getByTestId("plan-task-status-collect-context").getAttribute("data-status")).toBe("in_progress");
  });
});
