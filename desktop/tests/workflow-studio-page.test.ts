/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workflowDefinition = {
    id: "workflow-1",
    name: "Studio Workflow",
    description: "Workflow used for studio layout coverage.",
    version: 1,
    status: "draft",
    source: "personal",
    entryNodeId: "node-start",
    nodes: [
      {
        id: "node-start",
        kind: "start",
        label: "Start",
      },
    ],
    edges: [],
    stateSchema: [],
    variables: [
      {
        id: "input-topic",
        key: "topic",
        label: "主题",
        scope: "input",
        valueType: "string",
        required: true,
      },
      {
        id: "run-limit",
        key: "limit",
        label: "条数限制",
        scope: "run",
        valueType: "number",
        defaultValue: 5,
      },
    ],
    outputs: [
      {
        id: "output-summary",
        key: "summary",
        label: "总结",
        scope: "output",
        valueType: "string",
      },
    ],
    editor: {
      canvas: {
        viewport: { offsetX: 0, offsetY: 0 },
        nodes: [],
      },
    },
    updatedAt: "2026-05-08T00:00:00.000Z",
  };

  const workspace = {
    workflows: [
      {
        id: "workflow-1",
        name: "Studio Workflow",
        description: "Workflow used for studio layout coverage.",
        status: "draft",
        source: "personal",
      },
    ],
    workflowDefinitions: {
      "workflow-1": workflowDefinition,
    },
    workflowRuns: {
      "run-1": {
        id: "run-1",
        workflowId: "workflow-1",
        status: "running",
        currentNodeIds: ["node-start"],
        updatedAt: "2026-05-08T00:01:00.000Z",
      },
    },
    builtinTools: [
      { id: "tool-1", name: "Builtin Tool", enabled: true, group: "core" },
    ],
    mcpTools: [
      { id: "mcp-1", name: "MCP Tool", enabled: true, serverId: "server-a" },
    ],
    loadWorkflowById: vi.fn().mockResolvedValue(workflowDefinition),
    updateWorkflow: vi.fn().mockResolvedValue(undefined),
    loadWorkflowRuns: vi.fn().mockResolvedValue([]),
    startWorkflowRun: vi.fn().mockResolvedValue({ runId: "run-2" }),
    resumeWorkflowRun: vi.fn().mockResolvedValue({ success: true }),
    cancelWorkflowRun: vi.fn().mockResolvedValue({ success: true }),
    openArtifact: vi.fn().mockResolvedValue(undefined),
    revealArtifact: vi.fn().mockResolvedValue(undefined),
  };

  const liveRuns = new Map<string, {
    status: string;
    currentStep: number;
    nodeStatuses: Map<string, { phase: string; content?: string }>;
    state: Record<string, unknown>;
    events: Array<{ type: string; timestamp: number }>;
  }>();

  const workflowRunsStore = {
    liveRuns,
    startRun: vi.fn().mockResolvedValue("run-3"),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    resumeRun: vi.fn().mockResolvedValue(undefined),
    clearLiveRun: vi.fn(),
  };

  return { workspace, workflowRunsStore };
});

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => React.createElement("a", { href: to, ...rest }, children),
  useParams: () => ({ id: "workflow-1" }),
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: unknown) =>
    typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace,
}));

vi.mock("../src/renderer/stores/workflow-runs", () => ({
  useWorkflowRunsStore: (selector?: unknown) =>
    typeof selector === "function" ? selector(mocks.workflowRunsStore) : mocks.workflowRunsStore,
}));

vi.mock("../src/renderer/components/workflow/WorkflowCanvas", () => ({
  default: ({ headerLeading }: { headerLeading?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "workflow-canvas" }, headerLeading),
}));

vi.mock("../src/renderer/components/workflow/WorkflowGraphInspector", () => ({
  default: () => React.createElement("div", { "data-testid": "workflow-graph-inspector" }),
}));

vi.mock("../src/renderer/components/workflow/WorkflowRunPanel", () => ({
  default: () => React.createElement("div", { "data-testid": "workflow-run-panel" }),
}));

vi.mock("../src/renderer/components/workflow/WorkflowDebugPanel", () => ({
  WorkflowDebugPanel: () => React.createElement("div", { "data-testid": "workflow-debug-panel" }),
}));

vi.mock("../src/renderer/components/WorkFilesPanel", () => ({
  default: (props: { title?: string; description?: string; emptyHint?: string }) =>
    React.createElement(
      "div",
      { "data-testid": "work-files-panel" },
      React.createElement("h3", null, props.title),
      React.createElement("p", null, props.description),
      React.createElement("p", null, props.emptyHint),
    ),
}));

describe("WorkflowStudioPage", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.loadWorkflowById.mockClear();
    mocks.workspace.updateWorkflow.mockClear();
    mocks.workspace.loadWorkflowRuns.mockClear();
    mocks.workspace.startWorkflowRun.mockClear();
    mocks.workspace.resumeWorkflowRun.mockClear();
    mocks.workspace.cancelWorkflowRun.mockClear();
    mocks.workspace.openArtifact.mockClear();
    mocks.workspace.revealArtifact.mockClear();
    mocks.workflowRunsStore.startRun.mockClear();
    mocks.workflowRunsStore.cancelRun.mockClear();
    mocks.workflowRunsStore.resumeRun.mockClear();
    mocks.workflowRunsStore.clearLiveRun.mockClear();
  });

  it("uses a single dock and keeps artifacts behind dock tabs instead of a standalone Run Files sidebar", async () => {
    const { default: WorkflowStudioPage } = await import("../src/renderer/pages/WorkflowStudioPage");

    render(React.createElement(WorkflowStudioPage));

    expect(screen.queryByText("Run Files")).toBeNull();
    expect(screen.getByTestId("workflow-studio-dock")).toBeTruthy();
    expect(screen.getByTestId("workflow-studio-tab-artifacts").textContent).toContain("运行产物");
    expect(screen.queryByText("Artifacts")).toBeNull();

    fireEvent.click(screen.getByTestId("workflow-studio-tab-artifacts"));

    expect(await screen.findByTestId("work-files-panel")).toBeTruthy();
    expect(screen.getByText("查看本次工作流运行生成的输出文件、日志和交付物。")).toBeTruthy();
    expect(screen.getByText("本次工作流运行还没有产物。")).toBeTruthy();
    expect(screen.queryByText("Workflow run outputs, logs, and deliverables.")).toBeNull();
    expect(screen.queryByText("No artifacts for this workflow run yet.")).toBeNull();
    expect(mocks.workspace.loadWorkflowById).toHaveBeenCalledWith("workflow-1");
  });

  it("opens workflow variables from the canvas header instead of the right dock", async () => {
    const { default: WorkflowStudioPage } = await import("../src/renderer/pages/WorkflowStudioPage");

    render(React.createElement(WorkflowStudioPage));

    expect(screen.queryByTestId("workflow-studio-tab-variables")).toBeNull();
    fireEvent.click(await screen.findByTestId("workflow-canvas-variables-button"));

    expect(screen.getByTestId("workflow-variables-dialog")).toBeTruthy();
    expect(await screen.findByTestId("workflow-variables-panel")).toBeTruthy();
    expect(screen.getByText("启动输入")).toBeTruthy();
    expect(screen.getByText("全局变量")).toBeTruthy();
    expect(screen.getByText("最终输出")).toBeTruthy();
    expect(screen.getByText("inputs.topic")).toBeTruthy();
    expect(screen.getByText("vars.limit")).toBeTruthy();
    expect(screen.getByText("outputs.summary")).toBeTruthy();
  });

  it("can create a run variable from the workflow variables dialog", async () => {
    const { default: WorkflowStudioPage } = await import("../src/renderer/pages/WorkflowStudioPage");

    render(React.createElement(WorkflowStudioPage));

    fireEvent.click(await screen.findByTestId("workflow-canvas-variables-button"));
    fireEvent.click(await screen.findByTestId("workflow-variables-add-run"));

    expect(mocks.workspace.updateWorkflow).toHaveBeenCalledWith(
      "workflow-1",
      expect.objectContaining({
        variables: expect.arrayContaining([
          expect.objectContaining({
            scope: "run",
            key: expect.stringMatching(/^var_/),
          }),
        ]),
      }),
    );
  });
});
