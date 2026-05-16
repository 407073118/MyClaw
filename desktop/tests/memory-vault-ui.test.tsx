/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const auth = {
    isAuthenticated: true,
    session: {
      user: {
        displayName: "Tester",
      },
    },
  };

  const workspace = {
    loadBootstrap: vi.fn().mockResolvedValue(undefined),
    ready: true,
    loading: false,
    error: "",
    requiresInitialSetup: false,
    webPanel: {
      isOpen: false,
      viewPath: null,
      title: "",
      data: null,
      panelWidth: 420,
      tabs: [],
      activeTabId: null,
    },
    createWebPanelTab: vi.fn(),
    closeWebPanel: vi.fn(),
    time: {
      calendarEvents: [],
      reminders: [],
      availabilityPolicy: null,
    },
    models: [{ id: "model-1", name: "Local Model" }],
    defaultModelProfileId: "model-1",
    activeSiliconPersonId: null,
    setActiveSiliconPersonId: vi.fn(),
  };

  return { auth, workspace };
});

vi.mock("../src/renderer/components/WebPanel", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/components/AgentTeamDock", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/components/time/TimeAssistantCapsule", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/stores/auth", () => ({
  useAuthStore: (selector?: (state: typeof mocks.auth) => unknown) =>
    (typeof selector === "function" ? selector(mocks.auth) : mocks.auth),
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspace) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace),
}));

vi.mock("../src/renderer/stores/workflow-runs", () => ({
  useWorkflowRunsStore: Object.assign(
    () => ({}),
    { getState: () => ({ handleStreamEvent: vi.fn() }) },
  ),
}));

describe("memory vault UI wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        platform: "win32",
        onWorkflowStream: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the memory navigation item above Files", async () => {
    const { default: AppShell } = await import("../src/renderer/layouts/AppShell");
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="memory" element={<div data-testid="memory-route" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const nav = screen.getByTestId("app-nav");
    const memory = screen.getByTestId("nav-memory");
    const files = screen.getByTestId("nav-files");

    expect(memory.textContent).toContain("记忆库");
    expect(Array.from(nav.children).indexOf(memory)).toBeLessThan(Array.from(nav.children).indexOf(files));
  });

  it("labels the title bar as memory vault on /memory", async () => {
    const { default: TitleBar } = await import("../src/renderer/components/TitleBar");
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <TitleBar />
      </MemoryRouter>,
    );

    expect(screen.getByText("记忆库")).toBeTruthy();
  });
});
