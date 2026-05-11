/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    workflowRuns: {} as Record<string, unknown>,
    loadWorkflowRuns: vi.fn().mockResolvedValue([]),
    startWorkflowRun: vi.fn(),
    resumeWorkflowRun: vi.fn(),
  };
  const shell = {
    runtimeBaseUrl: "http://runtime.test",
  };
  const getWorkflowRunMock = vi.fn();
  return {
    workspace,
    shell,
    getWorkflowRunMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspace) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace),
}));

vi.mock("../src/renderer/stores/shell", () => ({
  useShellStore: (selector?: (state: typeof mocks.shell) => unknown) =>
    (typeof selector === "function" ? selector(mocks.shell) : mocks.shell),
}));

vi.mock("../src/renderer/services/runtime-client", () => ({
  getWorkflowRun: mocks.getWorkflowRunMock,
}));

vi.mock("../src/renderer/components/workflow/WorkflowCheckpointTimeline", () => ({
  default: () => null,
}));

describe("WorkflowRunPanel", () => {
  const definition = {
    id: "workflow-1",
    name: "Visible Workflow",
    description: "workflow",
    version: 1,
    status: "draft",
    source: "personal",
    nodes: [],
    edges: [],
    stateSchema: [],
    updatedAt: "2026-04-06T00:00:00.000Z",
  } as const;

  afterEach(() => {
    cleanup();
    mocks.workspace.workflowRuns = {};
    mocks.workspace.loadWorkflowRuns.mockClear();
    mocks.workspace.startWorkflowRun.mockClear();
    mocks.workspace.resumeWorkflowRun.mockClear();
    mocks.getWorkflowRunMock.mockReset();
  });

  it("does not show the resume action when only the checkpoint requests human input", async () => {
    mocks.workspace.workflowRuns = {
      "run-1": {
        id: "run-1",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "running",
        currentNodeIds: ["node-a"],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:01:00.000Z",
      },
    };
    mocks.getWorkflowRunMock.mockResolvedValue({
      run: {
        id: "run-1",
        workflowId: "workflow-1",
        status: "running",
        createdAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:01:00.000Z",
        currentNodeIds: ["node-a"],
        state: {},
      },
      checkpoints: [
        {
          id: "checkpoint-1",
          runId: "run-1",
          createdAt: "2026-04-06T00:01:00.000Z",
          nodeId: "node-a",
          status: "waiting-human-input",
          state: {},
          attempts: {},
        },
      ],
    });

    const { default: WorkflowRunPanel } = await import("../src/renderer/components/workflow/WorkflowRunPanel");
    render(React.createElement(WorkflowRunPanel, { workflowId: "workflow-1", definition }));

    await waitFor(() => {
      expect(mocks.getWorkflowRunMock).toHaveBeenCalledWith("http://runtime.test", "run-1");
    });
    expect(screen.queryByTestId("workflow-run-resume")).toBeNull();
  });

  it("shows the resume action when the selected run is retry-scheduled", async () => {
    mocks.workspace.workflowRuns = {
      "run-2": {
        id: "run-2",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "retry-scheduled",
        currentNodeIds: ["node-b"],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:02:00.000Z",
      },
    };
    mocks.getWorkflowRunMock.mockResolvedValue({
      run: {
        id: "run-2",
        workflowId: "workflow-1",
        status: "retry-scheduled",
        createdAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:02:00.000Z",
        currentNodeIds: ["node-b"],
        state: {},
      },
      checkpoints: [
        {
          id: "checkpoint-2",
          runId: "run-2",
          createdAt: "2026-04-06T00:02:00.000Z",
          nodeId: "node-b",
          status: "retry-scheduled",
          state: {},
          attempts: {},
        },
      ],
    });

    const { default: WorkflowRunPanel } = await import("../src/renderer/components/workflow/WorkflowRunPanel");
    render(React.createElement(WorkflowRunPanel, { workflowId: "workflow-1", definition }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-run-resume")).toBeTruthy();
    });
  });

  it("shows node returns as the primary run detail and hides raw state preview", async () => {
    mocks.workspace.workflowRuns = {
      "run-3": {
        id: "run-3",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "succeeded",
        currentNodeIds: [],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:03:00.000Z",
      },
    };
    mocks.getWorkflowRunMock.mockResolvedValue({
      run: {
        id: "run-3",
        workflowId: "workflow-1",
        status: "succeeded",
        createdAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:03:00.000Z",
        currentNodeIds: [],
        state: {
          title: "Ready",
          nodes: {
            "node-llm": { content: "节点返回内容" },
          },
        },
      },
      checkpoints: [],
    });
    const outputDefinition = {
      ...definition,
      nodes: [
        { id: "node-llm", kind: "llm", label: "生成回复", llm: { prompt: "回答" } },
      ],
    } as const;

    const { default: WorkflowRunPanel } = await import("../src/renderer/components/workflow/WorkflowRunPanel");
    render(React.createElement(WorkflowRunPanel, { workflowId: "workflow-1", definition: outputDefinition }));

    await waitFor(() => {
      expect(screen.getByText("节点返回")).toBeTruthy();
    });
    expect(screen.getByText("生成回复")).toBeTruthy();
    expect(screen.getByText("节点返回内容")).toBeTruthy();
    expect(screen.queryByText("当前状态预览")).toBeNull();
    expect(screen.getByText("技术状态")).toBeTruthy();
  });

  it("uses user-facing run labels instead of exposing run ids as the main title", async () => {
    mocks.workspace.workflowRuns = {
      "run-visible-id": {
        id: "run-visible-id",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "succeeded",
        currentNodeIds: [],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:03:00.000Z",
      },
    };
    mocks.getWorkflowRunMock.mockResolvedValue({
      run: {
        id: "run-visible-id",
        workflowId: "workflow-1",
        status: "succeeded",
        createdAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:03:00.000Z",
        currentNodeIds: [],
        state: {},
      },
      checkpoints: [],
    });

    const { default: WorkflowRunPanel } = await import("../src/renderer/components/workflow/WorkflowRunPanel");
    render(React.createElement(WorkflowRunPanel, { workflowId: "workflow-1", definition }));

    await waitFor(() => {
      expect(screen.getByText("第 1 次运行")).toBeTruthy();
    });
    expect(screen.queryByText(/ID:/)).toBeNull();
    expect(screen.getByText("已成功")).toBeTruthy();
  });

  it("passes configured start input variables when launching a run", async () => {
    mocks.workspace.workflowRuns = {};
    mocks.workspace.startWorkflowRun.mockResolvedValue({ runId: "run-inputs" });
    mocks.getWorkflowRunMock.mockResolvedValue({
      run: {
        id: "run-inputs",
        workflowId: "workflow-1",
        status: "running",
        currentNodeIds: [],
        state: {},
      },
      checkpoints: [],
    });
    const inputDefinition = {
      ...definition,
      variables: [
        {
          id: "input-topic",
          key: "topic",
          label: "主题",
          scope: "input",
          valueType: "string",
          required: true,
        },
      ],
    } as const;

    const { default: WorkflowRunPanel } = await import("../src/renderer/components/workflow/WorkflowRunPanel");
    render(React.createElement(WorkflowRunPanel, { workflowId: "workflow-1", definition: inputDefinition }));

    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "季度复盘" } });
    fireEvent.click(screen.getByTestId("workflow-run-start"));

    await waitFor(() => {
      expect(mocks.workspace.startWorkflowRun).toHaveBeenCalledWith("workflow-1", { topic: "季度复盘" });
    });
  });

  it("treats required state schema fields without producers as start inputs", async () => {
    mocks.workspace.workflowRuns = {};
    mocks.workspace.startWorkflowRun.mockResolvedValue({ runId: "run-schema-inputs" });
    mocks.getWorkflowRunMock.mockResolvedValue({
      run: {
        id: "run-schema-inputs",
        workflowId: "workflow-1",
        status: "running",
        currentNodeIds: [],
        state: {},
      },
      checkpoints: [],
    });
    const schemaDefinition = {
      ...definition,
      stateSchema: [
        {
          key: "topic",
          label: "主题",
          description: "启动主题",
          valueType: "string",
          mergeStrategy: "replace",
          required: true,
          producerNodeIds: [],
          consumerNodeIds: ["llm-1"],
        },
      ],
    } as const;

    const { default: WorkflowRunPanel } = await import("../src/renderer/components/workflow/WorkflowRunPanel");
    render(React.createElement(WorkflowRunPanel, { workflowId: "workflow-1", definition: schemaDefinition }));

    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "周报" } });
    fireEvent.click(screen.getByTestId("workflow-run-start"));

    await waitFor(() => {
      expect(mocks.workspace.startWorkflowRun).toHaveBeenCalledWith("workflow-1", { topic: "周报" });
    });
  });
});
