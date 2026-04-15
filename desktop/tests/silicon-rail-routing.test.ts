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
        status: "idle" as const,
        source: "personal" as const,
        approvalMode: "inherit" as const,
        currentSessionId: null,
        sessions: [],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        updatedAt: "2026-04-14T00:00:00.000Z",
        workflowIds: [],
      },
    ],
    setActiveSiliconPersonId: vi.fn(),
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

describe("SiliconRail routing", () => {
  beforeEach(() => {
    mocks.workspace.setActiveSiliconPersonId.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("selects the silicon person and routes avatar clicks back into the shared chat container", async () => {
    const { default: SiliconRail } = await import("../src/renderer/components/SiliconRail");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees"] },
        React.createElement(
          React.Fragment,
          undefined,
          React.createElement(SiliconRail),
          React.createElement(LocationProbe),
        ),
      ),
    );

    fireEvent.click(screen.getByTestId("silicon-rail-avatar-sp-1"));

    expect(mocks.workspace.setActiveSiliconPersonId).toHaveBeenCalledWith("sp-1");
    expect(screen.getByTestId("location-probe").textContent).toBe("/");
  });
});
