/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("Follow up roadmap")).toBeTruthy();
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

    fireEvent.click(await screen.findByTestId("memory-ai-toggle"));

    await waitFor(() => {
      expect(workspaceMock.updateSessionRuntimeIntent).toHaveBeenCalledWith({ memoryContextEnabled: true });
    });
  });
});
