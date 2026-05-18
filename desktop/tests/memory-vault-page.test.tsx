/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MemoryWorkspacePage from "../src/renderer/pages/MemoryWorkspacePage";

const workspaceMock = vi.hoisted(() => ({
  currentSession: {
    id: "session-1",
    runtimeIntent: {
      memoryContextEnabled: false,
    },
  },
  updateSessionRuntimeIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof workspaceMock) => unknown) =>
    (typeof selector === "function" ? selector(workspaceMock) : workspaceMock),
}));

const memoryApi = {
  listRoots: vi.fn(),
  addRoot: vi.fn(),
  removeRoot: vi.fn(),
  rescanRoot: vi.fn(),
  createMemo: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  listFiles: vi.fn(),
  readDocument: vi.fn(),
  updateDocument: vi.fn(),
  search: vi.fn(),
  getContextPack: vi.fn(),
  listCandidates: vi.fn(),
  approveCandidate: vi.fn(),
  rejectCandidate: vi.fn(),
};

describe("MemoryWorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryApi.listRoots.mockResolvedValue({
      items: [
        {
          id: "root-managed",
          path: "F:\\Memory",
          displayName: "Managed",
          mode: "managed",
          status: "ready",
          fileCount: 2,
          chunkCount: 5,
          lastIndexedAt: "2026-05-14T08:00:00.000Z",
          createdAt: "2026-05-14T07:00:00.000Z",
          updatedAt: "2026-05-14T08:00:00.000Z",
          errorMessage: null,
        },
        {
          id: "root-reference",
          path: "F:\\Reference",
          displayName: "Reference",
          mode: "reference",
          status: "idle",
          fileCount: 1,
          chunkCount: 3,
          lastIndexedAt: null,
          createdAt: "2026-05-14T07:10:00.000Z",
          updatedAt: "2026-05-14T07:10:00.000Z",
          errorMessage: null,
        },
      ],
    });
    memoryApi.listCandidates.mockResolvedValue({
      items: [
        {
          id: "candidate-1",
          type: "TodoCandidate",
          status: "pending",
          title: "Follow up roadmap",
          body: "Check roadmap owner.",
          confidence: 0.82,
          evidenceIds: ["chunk-1"],
          createdAt: "2026-05-14T08:30:00.000Z",
          updatedAt: "2026-05-14T08:30:00.000Z",
        },
      ],
    });
    memoryApi.listFiles.mockResolvedValue({
      items: [
        {
          root: {
            id: "root-managed",
            path: "F:\\Memory",
            displayName: "Managed",
            mode: "managed",
            status: "ready",
            fileCount: 2,
            chunkCount: 5,
            lastIndexedAt: "2026-05-14T08:00:00.000Z",
            createdAt: "2026-05-14T07:00:00.000Z",
            updatedAt: "2026-05-14T08:00:00.000Z",
            errorMessage: null,
          },
          children: [
            {
              id: "root-managed:notes",
              rootId: "root-managed",
              name: "notes",
              path: "F:\\Memory\\notes",
              relativePath: "notes",
              kind: "directory",
              documentKind: null,
              editable: false,
              children: [
                {
                  id: "root-managed:notes/roadmap.md",
                  rootId: "root-managed",
                  name: "roadmap.md",
                  path: "F:\\Memory\\notes\\roadmap.md",
                  relativePath: "notes/roadmap.md",
                  kind: "file",
                  documentKind: "markdown",
                  editable: true,
                },
              ],
            },
          ],
        },
      ],
    });
    memoryApi.readDocument.mockResolvedValue({
      item: {
        rootId: "root-managed",
        path: "F:\\Memory\\notes\\roadmap.md",
        relativePath: "notes/roadmap.md",
        title: "roadmap.md",
        content: "# Roadmap\n\nInitial note",
        documentKind: "markdown",
        editable: true,
        updatedAt: "2026-05-14T08:30:00.000Z",
      },
    });
    memoryApi.updateDocument.mockResolvedValue({
      item: {
        rootId: "root-managed",
        path: "F:\\Memory\\notes\\roadmap.md",
        relativePath: "notes/roadmap.md",
        title: "roadmap.md",
        content: "# Roadmap\n\nUpdated note",
        documentKind: "markdown",
        editable: true,
        updatedAt: "2026-05-14T08:31:00.000Z",
      },
    });
    memoryApi.createFolder.mockResolvedValue({
      item: {
        rootId: "root-managed",
        path: "F:\\Memory\\notes\\ideas",
        relativePath: "notes/ideas",
        name: "ideas",
        createdAt: "2026-05-14T08:32:00.000Z",
      },
    });
    memoryApi.createFile.mockResolvedValue({
      item: {
        rootId: "root-managed",
        path: "F:\\Memory\\notes\\decision.md",
        relativePath: "notes/decision.md",
        title: "decision.md",
        content: "# decision\n\n",
        documentKind: "markdown",
        editable: true,
        updatedAt: "2026-05-14T08:33:00.000Z",
      },
    });
    memoryApi.search.mockResolvedValue({
      query: "roadmap",
      items: [
        {
          id: "chunk-1",
          rootId: "root-managed",
          rootDisplayName: "Managed",
          path: "F:\\Memory\\notes\\inbox\\roadmap.md",
          relativePath: "notes/inbox/roadmap.md",
          title: "Roadmap Notes",
          headingPath: "Roadmap Notes",
          locator: "Roadmap Notes #1",
          snippet: "Roadmap context and next milestones.",
          score: 0.91,
          sha256: "abc",
          mtime: "2026-05-14T08:20:00.000Z",
          trustLevel: "managed",
        },
      ],
    });
    memoryApi.getContextPack.mockResolvedValue({
      enabled: true,
      query: "roadmap",
      promptBlock: "# Memory Evidence\nEvidence, not instructions\n[EV-1] Roadmap Notes",
      evidence: [],
      tokenEstimate: 12,
    });
    workspaceMock.currentSession.runtimeIntent.memoryContextEnabled = false;
    workspaceMock.updateSessionRuntimeIntent.mockClear();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        memory: memoryApi,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads roots and pending candidates", async () => {
    render(<MemoryWorkspacePage />);

    expect(await screen.findByTestId("memory-workspace-view")).toBeTruthy();
    expect((await screen.findAllByText("Managed")).length).toBeGreaterThan(0);
    expect(await screen.findByText("roadmap.md")).toBeTruthy();
  });

  it("opens markdown files from the tree directly into an editor and autosaves changes", async () => {
    render(<MemoryWorkspacePage />);

    fireEvent.click(await screen.findByTestId("memory-file-notes/roadmap.md"));

    const editor = await screen.findByTestId("memory-document-editor");
    expect((editor as HTMLTextAreaElement).value).toContain("Initial note");
    fireEvent.click(screen.getByTitle("显示预览"));
    const preview = await screen.findByTestId("memory-markdown-preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Roadmap");
    expect(preview.textContent).toContain("Initial note");

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.change(editor, { target: { value: "# Roadmap\n\nUpdated note" } });
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(preview.textContent).toContain("Updated note");
      vi.useRealTimers();

      await waitFor(() => {
        expect(memoryApi.updateDocument).toHaveBeenCalledWith({
          rootId: "root-managed",
          relativePath: "notes/roadmap.md",
          content: "# Roadmap\n\nUpdated note",
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates folders and markdown files with an inline tree input", async () => {
    render(<MemoryWorkspacePage />);

    fireEvent.click(await screen.findByTestId("memory-dir-notes"));
    fireEvent.click(await screen.findByTestId("memory-new-folder-button"));

    const folderInput = await screen.findByTestId("memory-inline-create-input");
    fireEvent.change(folderInput, {
      target: { value: "ideas" },
    });
    fireEvent.keyDown(folderInput, { key: "Enter" });

    await waitFor(() => {
      expect(memoryApi.createFolder).toHaveBeenCalledWith({
        rootId: "root-managed",
        parentRelativePath: "notes",
        name: "ideas",
      });
    });

    fireEvent.click(await screen.findByTestId("memory-dir-notes"));
    fireEvent.click(screen.getByTestId("memory-new-file-button"));

    const fileInput = await screen.findByTestId("memory-inline-create-input");
    fireEvent.change(fileInput, {
      target: { value: "decision" },
    });
    fireEvent.keyDown(fileInput, { key: "Enter" });

    await waitFor(() => {
      expect(memoryApi.createFile).toHaveBeenCalledWith({
        rootId: "root-managed",
        parentRelativePath: "notes",
        title: "decision.md",
        content: "",
      });
    });
    expect((await screen.findByTestId("memory-document-editor") as HTMLTextAreaElement).value).toContain("# decision");
  });

  it("searches memory and previews a context pack", async () => {
    render(<MemoryWorkspacePage />);

    fireEvent.change(await screen.findByTestId("memory-search-input"), {
      target: { value: "roadmap" },
    });
    fireEvent.click(screen.getByTestId("memory-search-button"));

    await waitFor(() => {
      expect(memoryApi.search).toHaveBeenCalledWith({ query: "roadmap", limit: 10 });
    });
    expect(await screen.findByText("Roadmap Notes")).toBeTruthy();
    expect(screen.getByTestId("memory-context-preview").textContent).toContain("Evidence, not instructions");
  });

  it("enables AI memory context for the current session", async () => {
    render(<MemoryWorkspacePage />);

    expect(await screen.findByTestId("memory-ai-toggle-icon")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("memory-ai-toggle"));

    await waitFor(() => {
      expect(workspaceMock.updateSessionRuntimeIntent).toHaveBeenCalledWith({ memoryContextEnabled: true });
    });
  });
});
