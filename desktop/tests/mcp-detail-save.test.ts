/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServer } from "@shared/contracts";
import McpDetailPage from "../src/renderer/pages/McpDetailPage";

const mocks = vi.hoisted(() => {
  const workspace = {
    mcpServers: [] as McpServer[],
    loadMcpServers: vi.fn(async () => []),
    createMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    deleteMcpServer: vi.fn(),
    refreshMcpServer: vi.fn(),
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

function renderMcpDetail(route = "/mcp/new") {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [route] },
      React.createElement(
        Routes,
        undefined,
        React.createElement(Route, {
          path: "/mcp/new",
          element: React.createElement(McpDetailPage),
        }),
        React.createElement(Route, {
          path: "/mcp/:id",
          element: React.createElement(McpDetailPage),
        }),
        React.createElement(Route, {
          path: "/mcp",
          element: React.createElement("div", undefined, "mcp-list"),
        }),
      ),
    ),
  );
}

describe("McpDetailPage save flow", () => {
  beforeEach(() => {
    mocks.workspace.mcpServers = [];
  });

  afterEach(() => {
    cleanup();
    mocks.workspace.loadMcpServers.mockReset();
    mocks.workspace.loadMcpServers.mockResolvedValue([]);
    mocks.workspace.createMcpServer.mockReset();
    mocks.workspace.updateMcpServer.mockReset();
    mocks.workspace.deleteMcpServer.mockReset();
    mocks.workspace.refreshMcpServer.mockReset();
  });

  it("disables the submit button and ignores repeated create clicks while saving", async () => {
    let resolveCreate: ((server: McpServer) => void) | null = null;
    const createPromise = new Promise<McpServer>((resolve) => {
      resolveCreate = resolve;
    });

    mocks.workspace.createMcpServer.mockReturnValue(createPromise);

    renderMcpDetail();

    fireEvent.change(screen.getByPlaceholderText("my-server"), {
      target: { value: "playwright" },
    });
    fireEvent.change(screen.getByPlaceholderText("My MCP Server"), {
      target: { value: "Playwright" },
    });
    fireEvent.change(screen.getByPlaceholderText("node server.js"), {
      target: { value: "npx" },
    });
    fireEvent.change(screen.getByPlaceholderText("--port 8080"), {
      target: { value: "@playwright/mcp@latest" },
    });

    const submitButton = screen.getByRole("button", { name: "创建服务" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.workspace.createMcpServer).toHaveBeenCalledTimes(1);
    });

    const savingButton = screen.getByRole("button", { name: "保存中..." }) as HTMLButtonElement;
    expect(savingButton.disabled).toBe(true);

    fireEvent.click(savingButton);
    expect(mocks.workspace.createMcpServer).toHaveBeenCalledTimes(1);

    resolveCreate?.({
      id: "playwright",
      name: "Playwright",
      source: "manual",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
      health: "unknown",
      tools: [],
    });

    await waitFor(() => {
      expect(mocks.workspace.createMcpServer).toHaveBeenCalledTimes(1);
    });
  });
});
