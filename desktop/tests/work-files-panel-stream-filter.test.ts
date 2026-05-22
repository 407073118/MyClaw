/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventType, FILE_VIEWER_PANEL_PATH, type ArtifactRecord } from "../shared/contracts";

const mocks = vi.hoisted(() => {
  const loadArtifactsByScope = vi.fn().mockResolvedValue([]);
  const applyArtifactEvent = vi.fn();
  const openWebPanel = vi.fn();
  const markdownArtifact: ArtifactRecord = {
    id: "artifact-md-1",
    title: "report.md",
    kind: "doc",
    mimeType: "text/markdown",
    storageClass: "workspace",
    lifecycle: "ready",
    status: "ready",
    relativePath: "silicon-persons/sp-1/workspace/report.md",
    sizeBytes: 128,
    sha256: null,
    metadata: null,
    createdAt: "2026-05-09T09:00:00.000Z",
    updatedAt: "2026-05-09T09:00:00.000Z",
    lastOpenedAt: null,
    openCount: 0,
  };
  const workspace = {
    myClawRootPath: "F:/MyClaw",
    artifactsByScope: {
      "session:session-1": [markdownArtifact],
    },
    loadArtifactsByScope,
    applyArtifactEvent,
    openWebPanel,
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    { getState: () => workspace },
  );

  return {
    workspace,
    markdownArtifact,
    loadArtifactsByScope,
    applyArtifactEvent,
    openWebPanel,
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
    mocks.workspace.artifactsByScope = {
      "session:session-1": [mocks.markdownArtifact],
    };

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        fileViewerPreview: vi.fn(async () => ({
          success: true,
          resolvedPath: "F:/MyClaw/silicon-persons/sp-1/workspace/report.md",
          viewMeta: {
            viewPath: FILE_VIEWER_PANEL_PATH,
            title: "report.md",
            data: {
              panelKind: "file-viewer",
              fileName: "report.md",
              path: "F:/MyClaw/silicon-persons/sp-1/workspace/report.md",
              ext: ".md",
              sizeBytes: 128,
              viewerKind: "markdown",
              content: "# 报告",
              actions: { openExternal: true, reveal: true },
            },
          },
        })),
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

  it("reloads session-scoped artifacts only for artifact stream events", async () => {
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

    expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(1);

    await act(async () => {
      sessionStreamHandler?.({
        type: EventType.ArtifactCompleted,
        scopeKind: "session",
        scopeId: "session-other",
        artifact: mocks.markdownArtifact,
      });
    });

    expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(1);
    expect(mocks.applyArtifactEvent).not.toHaveBeenCalled();

    await act(async () => {
      sessionStreamHandler?.({
        type: EventType.ArtifactCompleted,
        scopeKind: "session",
        scopeId: "session-1",
        artifact: mocks.markdownArtifact,
      });
    });

    await waitFor(() => expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(2));
    expect(mocks.applyArtifactEvent).toHaveBeenCalledWith({
      type: EventType.ArtifactCompleted,
      scopeKind: "session",
      scopeId: "session-1",
      artifact: mocks.markdownArtifact,
    });
    expect(workflowStreamHandler).toBeTypeOf("function");
  });

  it("ignores noisy workflow events and debounces artifact workflow reloads", async () => {
    const { default: WorkFilesPanel } = await import("../src/renderer/components/WorkFilesPanel");

    render(
      React.createElement(WorkFilesPanel, {
        scope: { scopeKind: "workflowRun", scopeId: "run-1" },
      }),
    );

    await waitFor(() =>
      expect(mocks.loadArtifactsByScope).toHaveBeenCalledWith({ scopeKind: "workflowRun", scopeId: "run-1" }),
    );
    mocks.loadArtifactsByScope.mockClear();

    await act(async () => {
      workflowStreamHandler?.({ type: "checkpoint-saved", runId: "run-1" });
      workflowStreamHandler?.({ type: "state-updated", runId: "run-1", value: { huge: true } });
    });

    expect(mocks.loadArtifactsByScope).not.toHaveBeenCalled();

    await act(async () => {
      workflowStreamHandler?.({ type: EventType.ArtifactCompleted, scopeKind: "workflowRun", scopeId: "run-other", artifactId: "a1" });
    });

    expect(mocks.loadArtifactsByScope).not.toHaveBeenCalled();

    await act(async () => {
      workflowStreamHandler?.({ type: EventType.ArtifactCompleted, scopeKind: "workflowRun", scopeId: "run-1", artifactId: "a1" });
      workflowStreamHandler?.({ type: EventType.ArtifactCompleted, scopeKind: "workflowRun", scopeId: "run-1", artifactId: "a1" });
    });

    await waitFor(() => expect(mocks.loadArtifactsByScope).toHaveBeenCalledTimes(1));
    expect(mocks.loadArtifactsByScope).toHaveBeenCalledWith({ scopeKind: "workflowRun", scopeId: "run-1" });
    expect(workflowStreamHandler).toBeTypeOf("function");
  });

  it("opens markdown artifacts in the right file preview panel", async () => {
    const { default: WorkFilesPanel } = await import("../src/renderer/components/WorkFilesPanel");

    render(
      React.createElement(WorkFilesPanel, {
        scope: { scopeKind: "session", scopeId: "session-1" },
        title: "会话文件",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    await waitFor(() =>
      expect(window.myClawAPI.fileViewerPreview).toHaveBeenCalledWith({
        path: "silicon-persons/sp-1/workspace/report.md",
        baseDirectory: "F:/MyClaw",
        candidateBaseDirectories: ["F:/MyClaw"],
      }),
    );
    expect(mocks.openWebPanel).toHaveBeenCalledWith(
      FILE_VIEWER_PANEL_PATH,
      "report.md",
      expect.objectContaining({
        panelKind: "file-viewer",
        viewerKind: "markdown",
        fileName: "report.md",
      }),
    );
  });

  it("opens the right preview panel when the markdown file name is clicked", async () => {
    const { default: WorkFilesPanel } = await import("../src/renderer/components/WorkFilesPanel");

    render(
      React.createElement(WorkFilesPanel, {
        scope: { scopeKind: "session", scopeId: "session-1" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "report.md" }));

    await waitFor(() => expect(mocks.openWebPanel).toHaveBeenCalledTimes(1));
    expect(window.myClawAPI.fileViewerPreview).toHaveBeenCalledWith({
      path: "silicon-persons/sp-1/workspace/report.md",
      baseDirectory: "F:/MyClaw",
      candidateBaseDirectories: ["F:/MyClaw"],
    });
  });
});
