/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();

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
    setActiveSiliconPersonId: vi.fn(),
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("Silicon person entry page", () => {
  afterEach(() => {
    cleanup();
    navigateMock.mockReset();
    mocks.workspace.loadSiliconPersons.mockClear();
    mocks.workspace.createSiliconPerson.mockClear();
    mocks.workspace.setActiveSiliconPersonId.mockClear();
  });

  it("renders card grid layout with silicon person cards", async () => {
    const { default: SiliconPersonEntryPage } = await import("../src/renderer/pages/SiliconPersonEntryPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonEntryPage),
      ),
    );

    expect(screen.getByTestId("silicon-person-entry-view")).toBeTruthy();
    expect(screen.getByText("硅基员工")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-create-btn")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-card-sp-1")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-open-sp-1")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-manage-sp-1")).toBeTruthy();
  });

  it("opens shared chat when the dialog entry action is clicked", async () => {
    const { default: SiliconPersonEntryPage } = await import("../src/renderer/pages/SiliconPersonEntryPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonEntryPage),
      ),
    );

    fireEvent.click(screen.getByTestId("silicon-person-open-sp-1"));

    expect(mocks.workspace.setActiveSiliconPersonId).toHaveBeenCalledWith("sp-1");
    expect(navigateMock).toHaveBeenCalledWith("/");
  });

  it("opens the silicon person studio without changing the active chat object", async () => {
    const { default: SiliconPersonEntryPage } = await import("../src/renderer/pages/SiliconPersonEntryPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonEntryPage),
      ),
    );

    fireEvent.click(screen.getByTestId("silicon-person-manage-sp-1"));

    expect(mocks.workspace.setActiveSiliconPersonId).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/employees/sp-1/studio");
  });
});
