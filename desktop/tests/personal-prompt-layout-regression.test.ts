/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const authState = {
    isAuthenticated: true,
    session: {
      user: {
        displayName: "Prompt User",
        account: "prompt.user",
      },
    },
    logout: vi.fn(),
  };

  const workspaceState = {
    ready: true,
    loading: false,
    error: null,
    requiresInitialSetup: false,
    models: [{ id: "model-1", name: "GPT Desktop" }],
    defaultModelProfileId: "model-1",
    personalPrompt: {
      prompt: "我是测试工程师，希望你先帮我补齐测试思路。",
      summary: "测试工程师，偏好先整理测试思路。",
      tags: ["测试", "黑盒测试"],
      updatedAt: "2026-04-04T10:00:00.000Z",
    },
    webPanel: {
      isOpen: false,
      viewPath: null,
      title: "",
      data: null,
      panelWidth: 420,
    },
    loadBootstrap: vi.fn(),
    loadPersonalPrompt: vi.fn().mockResolvedValue(undefined),
    updatePersonalPrompt: vi.fn().mockResolvedValue(undefined),
    closeWebPanel: vi.fn(),
    setWebPanelWidth: vi.fn(),
  };

  return { authState, workspaceState };
});

vi.mock("../src/renderer/stores/auth", () => ({
  useAuthStore: (selector?: (state: typeof mocks.authState) => unknown) =>
    (typeof selector === "function" ? selector(mocks.authState) : mocks.authState),
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspaceState) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspaceState) : mocks.workspaceState),
}));

import AppShell from "../src/renderer/layouts/AppShell";
import PersonalPromptPage from "../src/renderer/pages/PersonalPromptPage";

describe("personal prompt desktop layout regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        platform: "darwin",
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("does not keep showing the personal prompt dot when the prompt page itself is active", () => {
    const { container } = render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/me/prompt"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(
            Route,
            { element: React.createElement(AppShell) },
            React.createElement(Route, {
              path: "/me/prompt",
              element: React.createElement("div", { "data-testid": "prompt-route-content" }, "Prompt page"),
            }),
          ),
        ),
      ),
    );

    expect(screen.getByTestId("nav-personal-prompt")).toBeTruthy();
    expect(container.querySelector(".prompt-link-dot")).toBeNull();
  });

  it("uses container-aware responsive rules so the shell can collapse the layout before content overlaps", () => {
    const { container } = render(React.createElement(PersonalPromptPage));
    const styleTag = container.querySelector("style");

    expect(styleTag?.textContent).toContain("container-type: inline-size");
    expect(styleTag?.textContent).toContain("@container (max-width: 1180px)");
    expect(styleTag?.textContent).not.toContain("@media (max-width: 1180px)");
  });
});
