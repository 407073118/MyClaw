/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const definition = {
    id: "workflow-1",
    name: "Autosave Workflow",
    description: "Graph inspector autosave coverage.",
    version: 1,
    status: "draft",
    source: "personal",
    entryNodeId: "node-start",
    nodes: [
      { id: "node-start", kind: "start", label: "Start" },
      {
        id: "node-llm",
        kind: "llm",
        label: "Draft LLM",
        llm: { prompt: "Say hello.", outputKey: "answer" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        fromNodeId: "node-start",
        toNodeId: "node-llm",
        kind: "normal",
      },
    ],
    stateSchema: [],
    editor: {
      canvas: {
        viewport: { offsetX: 0, offsetY: 0 },
        nodes: [],
      },
    },
    defaults: {},
    updatedAt: "2026-05-09T00:00:00.000Z",
  };

  const workspace = {
    builtinTools: [],
    mcpTools: [],
    workflowSummaries: {},
    updateWorkflow: vi.fn().mockResolvedValue(undefined),
  };

  return { definition, workspace };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: () => mocks.workspace,
}));

describe("WorkflowGraphInspector autosave", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.updateWorkflow.mockClear();
  });

  it("auto-saves node edits and removes the unclear manual save button", async () => {
    const { default: WorkflowGraphInspector } = await import("../src/renderer/components/workflow/WorkflowGraphInspector");
    render(
      React.createElement(WorkflowGraphInspector, {
        workflowId: "workflow-1",
        definition: mocks.definition,
        selectedNodeId: "node-llm",
        selectedEdgeId: null,
        compact: true,
      }),
    );

    expect(screen.queryByTestId("workflow-graph-inspector-save")).toBeNull();

    const labelInput = await screen.findByTestId("workflow-node-editor-label");
    fireEvent.change(labelInput, { target: { value: "Auto Saved LLM" } });

    await waitFor(() => expect(mocks.workspace.updateWorkflow).toHaveBeenCalled());
    const [, payload] = mocks.workspace.updateWorkflow.mock.calls.at(-1) ?? [];
    expect(payload.nodes.find((node: { id: string }) => node.id === "node-llm")?.label).toBe("Auto Saved LLM");
    expect(screen.getByTestId("workflow-graph-inspector-save-state").textContent).toContain("自动保存");
  });

  it("does not expose synthetic system variables on a new workflow", async () => {
    const { default: WorkflowGraphInspector } = await import("../src/renderer/components/workflow/WorkflowGraphInspector");
    render(
      React.createElement(WorkflowGraphInspector, {
        workflowId: "workflow-1",
        definition: mocks.definition,
        selectedNodeId: "node-llm",
        selectedEdgeId: null,
        compact: true,
      }),
    );

    await screen.findByTestId("workflow-node-editor-label");

    expect(screen.queryByText("系统变量")).toBeNull();
    expect(screen.queryByText("Run ID")).toBeNull();
    expect(screen.queryByText("Workflow ID")).toBeNull();
    expect(screen.queryByText("Started At")).toBeNull();
  });
});
