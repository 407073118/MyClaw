/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const workspace = {
    siliconPersons: [
      {
        id: "sp-1",
        name: "Ada",
        title: "研究员",
        description: "处理后台任务",
        status: "running" as const,
        source: "personal" as const,
        approvalMode: "inherit" as const,
        currentSessionId: "session-1",
        sessions: [],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        updatedAt: "2026-05-16T10:00:00.000Z",
        workflowIds: [],
      },
    ],
    agentTasks: [],
    webPanel: { isOpen: false },
    time: {
      awarenessSnapshot: {
        activeSignals: [
          {
            id: "signal-1",
            scope: { kind: "silicon_person", ownerId: "sp-1" },
            severity: "critical",
            status: "active",
          },
        ],
      },
    },
    setActiveSiliconPersonId: vi.fn(),
    switchSiliconPersonSession: vi.fn().mockResolvedValue(undefined),
  };
  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    { getState: () => workspace },
  );
  return { workspace, useWorkspaceStoreMock };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

afterEach(() => {
  cleanup();
});

describe("silicon person awareness UI", () => {
  it("shows silicon-person scoped awareness badge in the team dock", async () => {
    const { default: AgentTeamDock } = await import("../src/renderer/components/AgentTeamDock");

    render(
      <MemoryRouter initialEntries={["/employees"]}>
        <AgentTeamDock />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Agent Team/ }));

    expect(screen.getByLabelText("1 个值守信号")).toBeTruthy();
  });
});
