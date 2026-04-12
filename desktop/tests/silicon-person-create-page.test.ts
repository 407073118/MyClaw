/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    siliconPersons: [] as Array<{
      id: string;
      name: string;
      title: string;
      description: string;
      soul?: string;
      approvalMode?: string;
      modelProfileId?: string;
      reasoningEffort?: "low" | "medium" | "high";
    }>,
    models: [
      {
        id: "model-1",
        name: "GPT-5.4",
      },
      {
        id: "model-2",
        name: "Claude Sonnet",
      },
    ],
    defaultModelProfileId: "model-1",
    loadSiliconPersons: vi.fn().mockResolvedValue([]),
    createSiliconPerson: vi.fn().mockResolvedValue({ id: "sp-new" }),
    updateSiliconPerson: vi.fn().mockResolvedValue({ id: "sp-new" }),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : { ...workspace }),
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

describe("SiliconPersonCreatePage", () => {
  beforeEach(() => {
    mocks.workspace.siliconPersons = [];
    mocks.workspace.loadSiliconPersons.mockClear();
    mocks.workspace.createSiliconPerson.mockClear();
    mocks.workspace.updateSiliconPerson.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a simplified desktop creation form with all key configuration fields", async () => {
    const { default: SiliconPersonCreatePage } = await import("../src/renderer/pages/SiliconPersonCreatePage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonCreatePage),
      ),
    );

    expect(screen.getByTestId("silicon-person-create-view")).toBeTruthy();
    expect(screen.getByText("新建硅基员工")).toBeTruthy();
    expect(screen.getByText("名称")).toBeTruthy();
    expect(screen.getByText("身份与人格")).toBeTruthy();
    expect(screen.queryByText("工作流绑定")).toBeNull();
    expect(screen.getByTestId("silicon-person-create-model")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-create-approval-mode")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-create-soul")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-create-reasoning-effort")).toBeTruthy();
    expect(screen.queryByTestId("silicon-person-create-title")).toBeNull();
    expect(screen.queryByTestId("silicon-person-create-description")).toBeNull();
    expect(mocks.workspace.loadSiliconPersons).toHaveBeenCalled();
  });

  it("does not repeatedly reload silicon persons when the store object identity changes", async () => {
    const { default: SiliconPersonCreatePage } = await import("../src/renderer/pages/SiliconPersonCreatePage");

    const view = render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonCreatePage),
      ),
    );

    expect(mocks.workspace.loadSiliconPersons).toHaveBeenCalledTimes(1);

    view.rerender(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonCreatePage),
      ),
    );

    expect(mocks.workspace.loadSiliconPersons).toHaveBeenCalledTimes(1);
  });

  it("submits base info and extended configuration from the same page", async () => {
    const { default: SiliconPersonCreatePage } = await import("../src/renderer/pages/SiliconPersonCreatePage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SiliconPersonCreatePage),
      ),
    );

    fireEvent.change(screen.getByTestId("silicon-person-create-name"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByTestId("silicon-person-create-soul"), {
      target: { value: "擅长结构化分析，沟通直接，优先给结论。" },
    });
    fireEvent.change(screen.getByTestId("silicon-person-create-model"), {
      target: { value: "model-2" },
    });
    fireEvent.change(screen.getByTestId("silicon-person-create-approval-mode"), {
      target: { value: "auto_approve" },
    });
    fireEvent.click(screen.getByRole("button", { name: "深度" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(mocks.workspace.createSiliconPerson).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Ada",
          title: "Ada",
          description: "擅长结构化分析，沟通直接，优先给结论。",
          soul: "擅长结构化分析，沟通直接，优先给结论。",
        }),
      );
    });

    await waitFor(() => {
      expect(mocks.workspace.updateSiliconPerson).toHaveBeenCalledWith(
        "sp-new",
        expect.objectContaining({
          approvalMode: "auto_approve",
          modelProfileId: "model-2",
          reasoningEffort: "high",
        }),
      );
    });
  });
});
