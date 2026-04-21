/** @vitest-environment jsdom */

import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    ready: true,
    loading: false,
    error: null,
    requiresInitialSetup: false,
    models: [],
    defaultModelProfileId: null,
    loadBootstrap: vi.fn(),
    activeSiliconPersonId: null,
    setActiveSiliconPersonId: vi.fn(),
    time: {
      calendarEvents: [
        {
          id: "event-1",
          kind: "calendar_event",
          title: "产品评审",
          startsAt: "2026-04-20T02:15:00.000Z",
          endsAt: "2026-04-20T03:00:00.000Z",
          timezone: "Asia/Shanghai",
          ownerScope: "personal",
          status: "confirmed",
          source: "manual",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
      taskCommitments: [],
      reminders: [],
      scheduleJobs: [],
      executionRuns: [],
      availabilityPolicy: {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: {
          enabled: false,
          start: "22:00",
          end: "08:00",
        },
        notificationWindows: [],
        focusBlocks: [],
      },
      todayBrief: null,
    },
  };

  const auth = {
    isAuthenticated: true,
    session: {
      user: {
        displayName: "测试用户",
        account: "tester",
      },
    },
    logout: vi.fn().mockResolvedValue(undefined),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  const useAuthStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(auth) : auth),
    {
      getState: () => auth,
    },
  );

  return {
    auth,
    workspace,
    useAuthStoreMock,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/components/WebPanel", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/components/SiliconRail", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/stores/auth", () => ({
  useAuthStore: mocks.useAuthStoreMock,
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

vi.mock("../src/renderer/stores/workflow-runs", () => ({
  useWorkflowRunsStore: {
    getState: () => ({
      handleStreamEvent: vi.fn(),
    }),
  },
}));

describe("AppShell time assistant presence", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.loadBootstrap.mockReset();
    mocks.workspace.setActiveSiliconPersonId.mockReset();
    mocks.auth.logout.mockReset();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("renders a global titlebar time chip without auto-opening the floating capsule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T02:00:00.000Z"));

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        platform: "win32",
        onWorkflowStream: vi.fn(() => vi.fn()),
      },
    });

    const { default: AppShell } = await import("../src/renderer/layouts/AppShell");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        React.createElement(
          Routes,
          null,
          React.createElement(
            Route,
            { element: React.createElement(AppShell) },
            React.createElement(Route, { path: "/", element: React.createElement("div", null, "chat body") }),
          ),
        ),
      ),
    );

    expect(screen.getByTestId("titlebar-time-chip").textContent).toContain("15 分钟后会议");
    expect(screen.queryByTestId("floating-time-capsule")).toBeNull();

    fireEvent.click(screen.getByTestId("titlebar-time-chip"));

    expect(screen.getByTestId("floating-time-capsule").textContent).toContain("产品评审");
    expect(screen.getByRole("button", { name: "打开时间中心" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("titlebar-time-chip"));

    expect(screen.queryByTestId("floating-time-capsule")).toBeNull();

    vi.useRealTimers();
  });
});
