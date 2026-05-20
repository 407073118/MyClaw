/** @vitest-environment jsdom */

import React from "react";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const definition = {
    id: "workflow-1",
    name: "Canvas Workflow",
    description: "Canvas interaction coverage.",
    version: 1,
    status: "draft",
    source: "personal",
    entryNodeId: "node-start",
    nodes: [
      { id: "node-start", kind: "start", label: "Start" },
      { id: "node-tool", kind: "tool", label: "Tool" },
    ],
    edges: [
      {
        id: "edge-1",
        fromNodeId: "node-start",
        toNodeId: "node-tool",
        kind: "normal",
      },
    ],
    stateSchema: [],
    editor: {
      canvas: {
        viewport: { offsetX: 0, offsetY: 0 },
        nodes: [
          { nodeId: "node-start", position: { x: 80, y: 80 } },
          { nodeId: "node-tool", position: { x: 420, y: 80 } },
        ],
      },
    },
    updatedAt: "2026-05-08T00:00:00.000Z",
  };

  return {
    definition,
    onSelectNode: vi.fn(),
    onSelectEdge: vi.fn(),
    onAddNode: vi.fn(),
    onConnectNode: vi.fn(),
    onDeleteNode: vi.fn(),
    onDeleteEdge: vi.fn(),
    onUpdateEditor: vi.fn(),
  };
});

vi.mock("../src/renderer/components/workflow/workflow-node-factory", () => ({
  WORKFLOW_CREATABLE_NODE_KINDS: ["start", "llm", "tool", "http-request", "human-input", "condition", "join", "end"],
  getWorkflowNodeKindLabel: (kind: string) => kind,
  isGeneratedScopedReference: () => false,
}));

vi.mock("../src/renderer/components/workflow/workflow-canvas-geometry", () => ({
  buildFallbackNodeLayouts: () => [],
  computeEdgeAnchorPoints: (fromRect: { x: number; y: number; width: number; height: number }, toRect: { x: number; y: number; width: number; height: number }) => ({
    start: { x: fromRect.x + fromRect.width / 2, y: fromRect.y + fromRect.height },
    end: { x: toRect.x + toRect.width / 2, y: toRect.y },
  }),
  findNodeLayout: () => undefined,
}));

describe("WorkflowCanvas interactions", () => {
  afterEach(() => {
    cleanup();
    mocks.onSelectNode.mockClear();
    mocks.onSelectEdge.mockClear();
    mocks.onAddNode.mockClear();
    mocks.onConnectNode.mockClear();
    mocks.onDeleteNode.mockClear();
    mocks.onDeleteEdge.mockClear();
    mocks.onUpdateEditor.mockClear();
  });

  it("cancels a pending connection when clicking blank stage or pressing Escape", async () => {
    const { default: WorkflowCanvas } = await import("../src/renderer/components/workflow/WorkflowCanvas");
    render(
      React.createElement(WorkflowCanvas, {
        definition: mocks.definition,
        selectedNodeId: null,
        selectedEdgeId: null,
        feedbackMessage: null,
        onSelectNode: mocks.onSelectNode,
        onSelectEdge: mocks.onSelectEdge,
        onAddNode: mocks.onAddNode,
        onConnectNode: mocks.onConnectNode,
        onDeleteNode: mocks.onDeleteNode,
        onDeleteEdge: mocks.onDeleteEdge,
        onUpdateEditor: mocks.onUpdateEditor,
      }),
    );

    fireEvent.mouseDown(screen.getByTestId("workflow-canvas-source-handle-node-tool"), { button: 0 });
    expect(screen.getByTestId("workflow-canvas-action-hint").textContent).toContain("Esc");

    fireEvent.mouseDown(screen.getByTestId("workflow-canvas"), { button: 0 });
    expect(screen.queryByTestId("workflow-canvas-action-hint")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("workflow-canvas-preview-edge")).toBeNull();
  });

  it("shows delete affordance for selected nodes and edges", async () => {
    const { default: WorkflowCanvas } = await import("../src/renderer/components/workflow/WorkflowCanvas");
    render(
      React.createElement(WorkflowCanvas, {
        definition: mocks.definition,
        selectedNodeId: "node-tool",
        selectedEdgeId: "edge-1",
        feedbackMessage: null,
        onSelectNode: mocks.onSelectNode,
        onSelectEdge: mocks.onSelectEdge,
        onAddNode: mocks.onAddNode,
        onConnectNode: mocks.onConnectNode,
        onDeleteNode: mocks.onDeleteNode,
        onDeleteEdge: mocks.onDeleteEdge,
        onUpdateEditor: mocks.onUpdateEditor,
      }),
    );

    expect(screen.getByTestId("workflow-canvas-node-delete-node-tool")).toBeTruthy();
    expect(screen.getByTestId("workflow-canvas-edge-delete-edge-1")).toBeTruthy();
  });

  it("shows an overview minimap and zooms the canvas with the mouse wheel", async () => {
    const { default: WorkflowCanvas } = await import("../src/renderer/components/workflow/WorkflowCanvas");
    render(
      React.createElement(WorkflowCanvas, {
        definition: mocks.definition,
        selectedNodeId: null,
        selectedEdgeId: null,
        feedbackMessage: null,
        onSelectNode: mocks.onSelectNode,
        onSelectEdge: mocks.onSelectEdge,
        onAddNode: mocks.onAddNode,
        onConnectNode: mocks.onConnectNode,
        onDeleteNode: mocks.onDeleteNode,
        onDeleteEdge: mocks.onDeleteEdge,
        onUpdateEditor: mocks.onUpdateEditor,
      }),
    );

    expect(screen.getByTestId("workflow-canvas-minimap").textContent).toContain("全景视图");

    const stage = screen.getByTestId("workflow-canvas-stage");
    const layer = screen.getByTestId("workflow-canvas-layer");
    const beforeTransform = layer.getAttribute("style") ?? "";

    fireEvent.wheel(stage, { deltaY: -120, clientX: 320, clientY: 240 });

    const afterTransform = layer.getAttribute("style") ?? "";
    expect(afterTransform).not.toBe(beforeTransform);
    expect(afterTransform).toContain("scale(");
    expect(screen.getByTestId("workflow-canvas-zoom-label").textContent).toContain("%");
  });

  it("creates palette nodes only after dragging them onto the canvas", async () => {
    const { default: WorkflowCanvas } = await import("../src/renderer/components/workflow/WorkflowCanvas");
    render(
      React.createElement(WorkflowCanvas, {
        definition: mocks.definition,
        selectedNodeId: null,
        selectedEdgeId: null,
        feedbackMessage: null,
        onSelectNode: mocks.onSelectNode,
        onSelectEdge: mocks.onSelectEdge,
        onAddNode: mocks.onAddNode,
        onConnectNode: mocks.onConnectNode,
        onDeleteNode: mocks.onDeleteNode,
        onDeleteEdge: mocks.onDeleteEdge,
        onUpdateEditor: mocks.onUpdateEditor,
      }),
    );

    const paletteItem = screen.getByTestId("workflow-palette-item-llm");
    fireEvent.click(paletteItem);
    expect(mocks.onAddNode).not.toHaveBeenCalled();

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "",
      dropEffect: "",
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type] ?? "";
      },
    };
    fireEvent.dragStart(paletteItem, { dataTransfer });
    const stage = screen.getByTestId("workflow-canvas-stage");
    fireEvent.dragOver(stage, {
      dataTransfer,
      clientX: 320,
      clientY: 240,
    });
    const dropEvent = createEvent.drop(stage, { dataTransfer });
    Object.defineProperty(dropEvent, "clientX", { value: 320 });
    Object.defineProperty(dropEvent, "clientY", { value: 240 });
    fireEvent(stage, dropEvent);

    expect(mocks.onAddNode).toHaveBeenCalledWith("llm", { x: 320, y: 240 });
  });

  it("describes graph issues with node names instead of raw node ids", async () => {
    const { default: WorkflowCanvas } = await import("../src/renderer/components/workflow/WorkflowCanvas");
    const definition = {
      ...mocks.definition,
      nodes: [
        ...mocks.definition.nodes,
        {
          id: "node-condition",
          kind: "condition",
          label: "判断是否通过",
          condition: { operator: "exists", leftPath: "$.state.result" },
          route: { trueNodeId: "node-missing" },
        },
      ],
      edges: [],
    };

    render(
      React.createElement(WorkflowCanvas, {
        definition,
        selectedNodeId: null,
        selectedEdgeId: null,
        feedbackMessage: null,
        onSelectNode: mocks.onSelectNode,
        onSelectEdge: mocks.onSelectEdge,
        onAddNode: mocks.onAddNode,
        onConnectNode: mocks.onConnectNode,
        onDeleteNode: mocks.onDeleteNode,
        onDeleteEdge: mocks.onDeleteEdge,
        onUpdateEditor: mocks.onUpdateEditor,
      }),
    );

    const issueText = screen.getByTestId("workflow-canvas-graph-issues").textContent ?? "";
    expect(issueText).toContain("判断是否通过");
    expect(issueText).not.toContain("node-missing");
  });
});
