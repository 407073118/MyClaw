/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const loadArtifactsByScope = vi.fn().mockResolvedValue([]);
  const applyArtifactEvent = vi.fn();
  const workspace = {
    artifactsByScope: {},
    loadArtifactsByScope,
    applyArtifactEvent,
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    { getState: () => workspace },
  );

  return {
    workspace,
    loadArtifactsByScope,
    applyArtifactEvent,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("WorkFilesPanel stream filtering", () => {
  let sessionStreamHandler: ((event: Record<string, unknown>) => void) | undefined;
  let workflowStreamHandler: ((event: Record<string, unknown>) => void) | undefined;
  const unsubscribeSession = vi.fn();
  const unsubscribeWorkflow = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStreamHandler = undefined;
    workflowStreamHandler = undefined;

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          sessionStreamHandler = callback;
          return unsubscribeSession;
        }),
        onWorkflowStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          workflowStreamHandler = callback;
          return unsubscribeWorkflow;
        }),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("reloads session-scoped artifacts only for matching session stream events", async () => {
    const { default: WorkFilesPanel } = await import("../src/renderer/components/WorkFilesPanel");

    render(
      React.createElement(WorkFilesPanel, {
        scope: { scopeKind: "session", scopeId: "session-1" },
        allowGlobalJump: false,
      }),
    );

    await waitFor(() =>
      expect(mocks.loadArtifactsByScope).toHaveBeenCalledWith({ scopeKind: "session", scopeId: "session-1" }),
    );
    expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(1);

    await act(async () => {
      sessionStreamHandler?.({
        type: "session.updated",
        sessionId: "session-2",
      });
    });

    expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(1);

    await act(async () => {
      sessionStreamHandler?.({
        type: "approval.requested",
        approvalRequest: {
          id: "approval-1",
          sessionId: "session-3",
        },
      });
    });

    expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(1);

    await act(async () => {
      sessionStreamHandler?.({
        type: "tasks.updated",
        sessionId: "session-1",
        tasks: [],
      });
    });

    expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(2);
    expect(workflowStreamHandler).toBeTypeOf("function");
  });
});
