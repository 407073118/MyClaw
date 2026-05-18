/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    models: [
      {
        id: "br-profile",
        name: "BR MiniMax",
        provider: "openai-compatible",
        providerFlavor: "br-minimax",
        vendorFamily: "minimax",
        deploymentProfile: "br-private",
        baseUrl: "http://api-cybotforge-pre.brapp.com",
        baseUrlMode: "provider-root",
        apiKey: "br-key",
        model: "minimax-m2-5",
        headers: {},
        requestBody: {
          temperature: 1.0,
          top_p: 0.95,
          top_k: 40,
          chat_template_kwargs: {
            enable_thinking: true,
          },
        },
        discoveredCapabilities: {
          source: "provider-detail",
          lastValidatedAt: "2026-04-04T12:00:00.000Z",
          raw: {
            brMiniMaxRuntime: {
              reasoningSplitSupported: false,
              thinkingPath: "reasoning_content",
              lastCheckedAt: "2026-04-04T12:00:00.000Z",
            },
          },
        },
        runtimeDiagnostics: {
          reasoningSplitSupported: false,
          thinkingPath: "reasoning_content",
          lastCheckedAt: "2026-04-04T12:00:00.000Z",
        },
      },
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
    expect(screen.getByText("Thinking 路径")).toBeTruthy();
    expect(screen.getByText(/reasoning_content/)).toBeTruthy();
    expect(screen.getByText(/已验证/)).toBeTruthy();
  });
});
