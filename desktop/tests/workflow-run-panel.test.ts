/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
