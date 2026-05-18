/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const workspace = {
    siliconPersons: [
      {
        id: "sp-1",
        name: "Ada",
        title: "研究搭档",
        description: "负责处理主聊天分发。",
        status: "running" as const,
        source: "personal" as const,
        approvalMode: "inherit" as const,
        currentSessionId: "session-1",
        sessions: [],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        updatedAt: "2026-04-14T00:00:00.000Z",
        workflowIds: [],
      },
      {
        id: "sp-2",
        name: "Lin",
        title: "验证搭档",
        description: "负责复核输出。",
        status: "idle" as const,
        source: "personal" as const,
        approvalMode: "inherit" as const,
        currentSessionId: "session-2",
        sessions: [],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        updatedAt: "2026-04-14T00:00:00.000Z",
        workflowIds: [],
      },
    ],
    agentTasks: [
      {
        id: "task-waiting",
        sourceSessionId: "main-session-1",
        title: "确认发布窗口",
        instruction: "确认发布窗口",
        mode: "delegate" as const,
        status: "waiting_user" as const,
        assigneeIds: ["sp-1"],
        leadAssigneeId: "sp-1",
        childSessionIds: { "sp-1": "session-1" },
        resultSummary: "需要用户确认是否今晚发布。",
        createdAt: "2026-04-15T00:08:00.000Z",
        updatedAt: "2026-04-15T00:09:00.000Z",
      },
      {
        id: "task-running",
        sourceSessionId: "main-session-1",
        title: "整理风险清单",
        instruction: "整理风险清单",
        mode: "delegate" as const,
        status: "running" as const,
        assigneeIds: ["sp-2"],
        leadAssigneeId: "sp-2",
        childSessionIds: { "sp-2": "session-2" },
        createdAt: "2026-04-15T00:06:00.000Z",
        updatedAt: "2026-04-15T00:07:00.000Z",
      },
      {
        id: "task-done",
        sourceSessionId: "main-session-1",
        title: "输出回归结论",
        instruction: "输出回归结论",
        mode: "delegate" as const,
        status: "succeeded" as const,
        assigneeIds: ["sp-1"],
        childSessionIds: { "sp-1": "session-1" },
        resultSummary: "回归通过，可以合入。",
        createdAt: "2026-04-15T00:03:00.000Z",
        updatedAt: "2026-04-15T00:04:00.000Z",
      },
    ],
    time: {
      awarenessSnapshot: {
        activeSignals: [],
      },
    },
    webPanel: { isOpen: false },
    setActiveSiliconPersonId: vi.fn(),
    switchSiliconPersonSession: vi.fn().mockResolvedValue(undefined),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    { getState: () => workspace },
  );

  return {
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

function LocationProbe() {
  const location = useLocation();
  return React.createElement("div", { "data-testid": "location-probe" }, location.pathname);
}

describe("AgentTeamDock task queue", () => {
  beforeEach(() => {
    mocks.workspace.setActiveSiliconPersonId.mockClear();
    mocks.workspace.switchSiliconPersonSession.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a unified task queue with status counters and rich rows", async () => {
    const { default: AgentTeamDock } = await import("../src/renderer/components/AgentTeamDock");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees"] },
        React.createElement(
          React.Fragment,
          undefined,
          React.createElement(AgentTeamDock),
          React.createElement(LocationProbe),
        ),
      ),
    );

    expect(screen.getByTestId("agent-team-dock").className).toContain("agent-team-dock--collapsed");
    expect(screen.queryByTestId("agent-team-task-board")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开 Agent Team" }));

    expect(screen.getByTestId("agent-team-task-board")).toBeTruthy();
    expect(screen.getByTestId("agent-team-task-count-attention").textContent).toBe("1");
    expect(screen.getByTestId("agent-team-task-count-running").textContent).toBe("1");
    expect(screen.getByTestId("agent-team-task-count-done").textContent).toBe("1");

    expect(screen.getByTestId("agent-team-task-row-task-waiting")).toBeTruthy();
    expect(screen.getByTestId("agent-team-task-status-task-waiting").textContent).toBe("待我处理");
    expect(screen.getByTestId("agent-team-task-assignees-task-waiting").textContent).toContain("Ada");
    expect(screen.getByTestId("agent-team-task-summary-task-waiting").textContent).toContain("需要用户确认");

    fireEvent.click(screen.getByTestId("agent-team-task-row-task-waiting"));

    expect(mocks.workspace.setActiveSiliconPersonId).toHaveBeenCalledWith("sp-1");
    expect(mocks.workspace.switchSiliconPersonSession).toHaveBeenCalledWith("sp-1", "session-1");
    expect(screen.getByTestId("location-probe").textContent).toBe("/");
  });
});
