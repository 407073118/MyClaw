/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrMiniMaxProfile,
  withBrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";

const mocks = vi.hoisted(() => {
  const workspace = {
    models: [
      withBrMiniMaxRuntimeDiagnostics(
        createBrMiniMaxProfile({
          id: "br-profile",
          apiKey: "br-key",
        }),
        {
          reasoningSplitSupported: false,
          thinkingPath: "reasoning_content",
          lastCheckedAt: "2026-04-04T12:00:00.000Z",
        },
      ),
    ],
    deleteModelProfile: vi.fn(),
    createModelProfile: vi.fn(),
    updateModelProfile: vi.fn(),
    setDefaultModelProfile: vi.fn(),
    fetchAvailableModelIds: vi.fn(),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) =>
      (typeof selector === "function" ? selector(workspace) : workspace),
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

describe("ModelDetailPage BR MiniMax diagnostics", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the persisted thinking path and verification status", async () => {
    const { default: ModelDetailPage } = await import("../src/renderer/pages/ModelDetailPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/settings/models/br-profile"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(Route, {
            path: "/settings/models/:id",
            element: React.createElement(ModelDetailPage),
          }),
        ),
      ),
    );

    expect(screen.getByText("托管参数")).toBeTruthy();
    expect(screen.getByText(/Thinking 路径：/)).toBeTruthy();
    expect(screen.getByText(/reasoning_content/)).toBeTruthy();
    expect(screen.getByText(/已验证/)).toBeTruthy();
  });
});
