/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    addModelAndClearSetup: vi.fn(),
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

describe("SetupPage BR MiniMax onboarding", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.addModelAndClearSetup.mockReset();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("uses managed BR MiniMax onboarding and only asks for API key", async () => {
    const createModelProfile = vi.fn(async (input) => ({ profile: { id: "br-profile", ...input } }));

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        createModelProfile,
      },
    });

    const { default: SetupPage } = await import("../src/renderer/pages/SetupPage");
    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SetupPage),
      ),
    );

    // 第一步：选择供应商 — 点击 BR MiniMax 卡片
    expect(screen.getByRole("heading", { name: "选择你的 AI 模型供应商" })).toBeTruthy();
    fireEvent.click(screen.getByText("BR MiniMax"));

    // 第二步：配置表单 — 只要求 API Key
    expect(screen.getByRole("heading", { name: "配置 BR MiniMax" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "br-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成配置，开始使用" }));

    await waitFor(() => expect(createModelProfile).toHaveBeenCalledTimes(1));
    expect(createModelProfile.mock.calls[0]?.[0]).toMatchObject({
      name: "BR MiniMax",
      providerFlavor: "br-minimax",
      baseUrl: "http://api-cybotforge-pre.brapp.com",
      model: "minimax-m2-5",
      apiKey: "br-key",
    });
  });
});
