/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const workspace = {
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
        ],
        unreadCount: 2,
        hasUnread: true,
        needsApproval: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
        workflowIds: [],
      },
    ],
    loadSiliconPersons: vi.fn().mockResolvedValue([]),
    createSiliconPerson: vi.fn().mockResolvedValue(null),
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

describe("Silicon person entry page", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.loadSiliconPersons.mockClear();
    mocks.workspace.createSiliconPerson.mockClear();
  });

  it("renders the rewritten silicon person entry instead of the old employees library wording", async () => {
    const { default: EmployeesPage } = await import("../src/renderer/pages/EmployeesPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(EmployeesPage),
      ),
    );

    expect(screen.getByTestId("silicon-person-entry-view")).toBeTruthy();
    expect(screen.getByText("硅基员工")).toBeTruthy();
    expect(screen.queryByText(/^Employees$/)).toBeNull();
    expect(screen.getByTestId("silicon-person-card-sp-1")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-open-sp-1")).toBeTruthy();
  });
});
