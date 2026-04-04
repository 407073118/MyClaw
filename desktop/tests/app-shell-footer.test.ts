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
    models: [{ id: "qwen-plus", name: "Qwen 3.5 Plus" }],
    defaultModelProfileId: "qwen-plus",
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

vi.mock("../src/renderer/stores/auth", () => ({
  useAuthStore: (selector?: (state: typeof mocks.auth) => unknown) =>
    (typeof selector === "function" ? selector(mocks.auth) : mocks.auth),
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspace) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace),
}));

describe("AppShell footer status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
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
});
