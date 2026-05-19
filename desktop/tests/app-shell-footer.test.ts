// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const auth = {
    isAuthenticated: true,
    session: {
      user: {
        displayName: "1",
        account: "tester@example.com",
        avatarDataUrl: null,
      },
    },
    logout: vi.fn().mockResolvedValue(undefined),
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
    models: [{ id: "qwen-plus", name: "Qwen 3.5 Plus" }],
    defaultModelProfileId: "qwen-plus",
    activeSiliconPersonId: null,
    setActiveSiliconPersonId: vi.fn(),
    personalPrompt: {
      prompt: "我是黑盒测试。",
      summary: "",
      tags: [],
      updatedAt: null,
    },
  };

  return {
    auth,
    workspace,
  };
});

vi.mock("../src/renderer/components/TitleBar", () => ({
  default: () => React.createElement("div", { "data-testid": "mock-title-bar" }),
}));

vi.mock("../src/renderer/components/WebPanel", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/components/SiliconRail", () => ({
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

describe("AppShell footer status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window ??= {};
    (window as any).myClawAPI ??= {};
    (window as any).myClawAPI.onWorkflowStream ??= vi.fn();
  });

  afterEach(() => {
    cleanup();
    mocks.auth.session.user.avatarDataUrl = null;
  });

  it("does not render the always-on glowing model dot once the workspace is ready", async () => {
    const { default: AppShell } = await import("../src/renderer/layouts/AppShell");
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/me/prompt"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(
            Route,
            { path: "/", element: React.createElement(AppShell) },
            React.createElement(Route, {
              path: "me/prompt",
              element: React.createElement("div", { "data-testid": "prompt-route" }),
            }),
          ),
        ),
      ),
    );

    const modelRow = screen.getByText("Qwen 3.5 Plus").closest(".user-model");

    expect(modelRow).not.toBeNull();
    expect(modelRow?.querySelector(".model-dot")).toBeNull();
  });

  it("keeps personal prompt and logout out of the sidebar footer", async () => {
    const { default: AppShell } = await import("../src/renderer/layouts/AppShell");
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/chat"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(
            Route,
            { path: "/", element: React.createElement(AppShell) },
            React.createElement(Route, {
              path: "chat",
              element: React.createElement("div", { "data-testid": "chat-route" }),
            }),
          ),
        ),
      ),
    );

    const settingsLink = screen.getByTestId("nav-settings");

    expect(screen.queryByTestId("nav-personal-prompt")).toBeNull();
    expect(screen.queryByTestId("auth-logout")).toBeNull();
    expect(settingsLink.textContent?.trim()).toBe("");
    expect(settingsLink.getAttribute("aria-label")).toBe("打开设置");
    expect(settingsLink.closest(".user-card-top")).not.toBeNull();
  });

  it("renders the saved personal avatar in the sidebar footer", async () => {
    mocks.auth.session.user.avatarDataUrl = "data:image/png;base64,QUJD";

    const { default: AppShell } = await import("../src/renderer/layouts/AppShell");
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/chat"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(
            Route,
            { path: "/", element: React.createElement(AppShell) },
            React.createElement(Route, {
              path: "chat",
              element: React.createElement("div", { "data-testid": "chat-route" }),
            }),
          ),
        ),
      ),
    );

    const avatar = screen.getByTestId("app-shell-user-avatar");
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,QUJD");
  });
});
