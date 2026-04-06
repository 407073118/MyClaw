/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PlanState } from "@shared/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session: {
    id: string;
    title: string;
    modelProfileId: string;
    attachedDirectory: null;
    createdAt: string;
    planState: PlanState | null;
    messages: unknown[];
  } = {
    id: "chat-session-plan",
    title: "Planner Session",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    createdAt: "2026-04-06T00:00:00.000Z",
    planState: {
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
    },
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
    resolveApproval: vi.fn(),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  return {
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("Phase 3 plan UI", () => {
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

  afterEach(() => {
    cleanup();
    mocks.workspace.selectSession.mockReset();
    mocks.workspace.deleteSession.mockReset();
    mocks.workspace.pushAssistantMessage.mockReset();
    mocks.workspace.createSession.mockReset();
    mocks.workspace.sendMessage.mockReset();
    mocks.workspace.resolveApproval.mockReset();
    Reflect.deleteProperty(window, "myClawAPI");
  });

  it("formats known plan statuses locally and keeps raw fallback for unknown future statuses", async () => {
    const { PlanStatePanel } = await import("../src/renderer/components/plan-state-panel");
    const futurePlanState: PlanState = {
      updatedAt: basePlanState.updatedAt,
      tasks: [
        ...basePlanState.tasks,
        {
          id: "future-task",
          title: "等待未来状态",
          status: "queued",
        },
      ],
    };

    render(React.createElement(PlanStatePanel, { planState: futurePlanState }));

    const panel = screen.getByTestId("plan-state-panel");
    expect(within(panel).getByText("计划状态")).toBeTruthy();
    expect(within(panel).getByText("收集上下文")).toBeTruthy();
    expect(within(panel).getByText("补充最小调试面板")).toBeTruthy();
    expect(within(panel).getByTestId("plan-task-status-collect-context").textContent).toContain("进行中");
    expect(within(panel).queryByText("in_progress")).toBeNull();
    expect(within(panel).getByTestId("plan-task-status-apply-ui").textContent).toContain("阻塞");
    expect(within(panel).getByTestId("plan-task-status-future-task").textContent).toContain("queued");
    expect(within(panel).queryAllByRole("button")).toHaveLength(0);
  });

  it("does not render when planState is absent or has no tasks", async () => {
    const { PlanStatePanel } = await import("../src/renderer/components/plan-state-panel");
    const { rerender } = render(React.createElement(PlanStatePanel, { planState: undefined as never }));

    expect(screen.queryByTestId("plan-state-panel")).toBeNull();

    rerender(React.createElement(PlanStatePanel, {
      planState: {
        updatedAt: "2026-04-06T00:11:00.000Z",
        tasks: [],
      },
    }));

    expect(screen.queryByTestId("plan-state-panel")).toBeNull();
  });

  it("mounts the minimal plan panel through ChatPage when the session has planState", async () => {
    mocks.workspace.currentSession.planState = basePlanState;
    mocks.workspace.sessions[0].planState = basePlanState;

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const panel = screen.getByTestId("plan-state-panel");
    expect(within(panel).getByText("计划状态")).toBeTruthy();
    expect(within(panel).getByTestId("plan-task-status-collect-context").textContent).toContain("进行中");
  });
});
