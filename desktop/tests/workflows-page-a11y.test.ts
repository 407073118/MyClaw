/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockWorkspace = vi.hoisted(() => ({
  workflows: [],
  workflowSummaries: {
    "workflow-1": {
      id: "workflow-1",
      name: "Accessible Workflow",
      description: "A workflow card that should respond to keyboard input.",
      status: "draft",
      nodeCount: 3,
      updatedAt: "2026-04-04T00:00:00.000Z",
    },
  },
  loadWorkflows: vi.fn().mockResolvedValue([]),
  startWorkflowRun: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: unknown) =>
    typeof selector === "function" ? selector(mockWorkspace) : mockWorkspace,
}));

import WorkflowsPage from "../src/renderer/pages/WorkflowsPage";

afterEach(() => {
  cleanup();
  mockNavigate.mockReset();
});

describe("WorkflowsPage", () => {
  it("lets keyboard users open a workflow card", () => {
    render(React.createElement(WorkflowsPage));

    const card = screen.getByText("Accessible Workflow").closest(".workflow-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(card, { key: "Enter", code: "Enter" });

    expect(mockNavigate).toHaveBeenCalledWith("/workflows/workflow-1");
  });

  it("moves focus into the create dialog and restores it after escape close", async () => {
    render(React.createElement(WorkflowsPage));

    const trigger = screen.getByRole("button", { name: /新建工作流/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "新建工作流" });
    expect(dialog).toBeTruthy();

    const nameInput = screen.getByTestId("workflow-create-name");
    await waitFor(() => expect(document.activeElement).toBe(nameInput));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建工作流" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
