// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const workspace = {
    loadRecentArtifacts: vi.fn().mockResolvedValue(undefined),
    openArtifact: vi.fn().mockResolvedValue(undefined),
    revealArtifact: vi.fn().mockResolvedValue(undefined),
    updateArtifactsRootPath: vi.fn().mockResolvedValue("F:/MyClaw/custom-artifacts"),
    recentArtifacts: [
      {
        id: "artifact-1",
        title: "回归报告",
        kind: "doc",
        mimeType: "text/markdown",
        storageClass: "artifact",
        lifecycle: "final",
        status: "ready",
        relativePath: "reports/regression.md",
        sizeBytes: 1024,
        sha256: null,
        metadata: null,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:10:00.000Z",
        lastOpenedAt: null,
        openCount: 0,
      },
    ],
    workspaceRootPath: "F:/MyClaw/workspace",
    artifactsRootPath: "F:/MyClaw/artifacts",
    cacheRootPath: "F:/MyClaw/cache",
  };

  return { workspace };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspace) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace),
}));

describe("FilesWorkspacePage layout contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens each local root directory from Files", async () => {
    const openLocalDirectory = vi.fn().mockResolvedValue({ success: true });
    window.myClawAPI = {
      onSessionStream: vi.fn().mockReturnValue(vi.fn()),
      openLocalDirectory,
    } as unknown as typeof window.myClawAPI;

    const { default: FilesWorkspacePage } = await import("../src/renderer/pages/FilesWorkspacePage");
    render(React.createElement(FilesWorkspacePage));

    fireEvent.click(screen.getByRole("button", { name: "打开工作区目录文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "打开产物目录文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "打开缓存目录文件夹" }));

    await waitFor(() => {
      expect(openLocalDirectory).toHaveBeenNthCalledWith(1, "F:/MyClaw/workspace");
      expect(openLocalDirectory).toHaveBeenNthCalledWith(2, "F:/MyClaw/artifacts");
      expect(openLocalDirectory).toHaveBeenNthCalledWith(3, "F:/MyClaw/cache");
    });
  });

  it("uses the shared page shell and dense list row layout", async () => {
    window.myClawAPI = {
      onSessionStream: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as typeof window.myClawAPI;

    const { default: FilesWorkspacePage } = await import("../src/renderer/pages/FilesWorkspacePage");
    const { container } = render(React.createElement(FilesWorkspacePage));

    const view = screen.getByTestId("files-workspace-view");
    const styleText = Array.from(container.querySelectorAll("style"))
      .map((styleNode) => styleNode.textContent ?? "")
      .join("\n");

    expect(view.className).toContain("page-shell");
    expect(view.className).not.toContain("page-container");
    expect(container.querySelector(".page-header--sticky")).not.toBeNull();
    expect(container.querySelector(".page-content")).not.toBeNull();
    expect(container.querySelector(".list-rows")).not.toBeNull();
    expect(container.querySelector(".list-row")).not.toBeNull();
    expect(styleText).not.toContain(".files-workspace {");
  });

  it("lets the user edit the artifacts root path from Files", async () => {
    window.myClawAPI = {
      onSessionStream: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as typeof window.myClawAPI;

    const { default: FilesWorkspacePage } = await import("../src/renderer/pages/FilesWorkspacePage");
    render(React.createElement(FilesWorkspacePage));

    fireEvent.click(screen.getByRole("button", { name: "修改产物目录" }));
    const input = screen.getByLabelText("产物目录路径");
    fireEvent.change(input, { target: { value: "F:/MyClaw/custom-artifacts" } });
    fireEvent.click(screen.getByRole("button", { name: "保存产物目录" }));

    await waitFor(() => {
      expect(mocks.workspace.updateArtifactsRootPath).toHaveBeenCalledWith("F:/MyClaw/custom-artifacts");
    });
  });
});
