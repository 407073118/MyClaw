/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FileViewerPanel from "../src/renderer/components/FileViewerPanel";

describe("FileViewerPanel", () => {
  const openExternal = vi.fn(async () => ({ success: true }));
  const reveal = vi.fn(async () => ({ success: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        fileViewerOpenExternal: openExternal,
        fileViewerReveal: reveal,
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("renders markdown preview and does not expose raw script tags", () => {
    render(
      <FileViewerPanel
        data={{
          panelKind: "file-viewer",
          fileName: "README.md",
          path: "F:/tmp/README.md",
          ext: ".md",
          sizeBytes: 42,
          viewerKind: "markdown",
          content: "# Hello\n\n<script>alert(1)</script>\n\nWorld",
          actions: { openExternal: true, reveal: true },
        }}
      />,
    );

    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("World")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("<script>");
  });

  it("opens markdown web links outside the current preview instead of navigating in place", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    try {
      render(
        <FileViewerPanel
          data={{
            panelKind: "file-viewer",
            fileName: "README.md",
            path: "F:/tmp/README.md",
            ext: ".md",
            sizeBytes: 42,
            viewerKind: "markdown",
            content: "[OpenClaw](https://github.com/openclaw/openclaw)",
            actions: { openExternal: true, reveal: true },
          }}
        />,
      );

      const link = screen.getByRole("link", { name: "OpenClaw" });
      fireEvent.click(link);

      expect(openSpy).toHaveBeenCalledWith(
        "https://github.com/openclaw/openclaw",
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      openSpy.mockRestore();
    }
  });

  it("calls local file actions from the panel", () => {
    render(
      <FileViewerPanel
        data={{
          panelKind: "file-viewer",
          fileName: "notes.txt",
          path: "F:/tmp/notes.txt",
          ext: ".txt",
          sizeBytes: 5,
          viewerKind: "text",
          content: "hello",
          actions: { openExternal: true, reveal: true },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "用本地应用打开" }));
    fireEvent.click(screen.getByRole("button", { name: "定位文件" }));

    expect(openExternal).toHaveBeenCalledWith("F:/tmp/notes.txt");
    expect(reveal).toHaveBeenCalledWith("F:/tmp/notes.txt");
  });

  it("places the fullscreen exit action next to the reveal-file action", () => {
    const exitFullscreen = vi.fn();

    render(
      <FileViewerPanel
        data={{
          panelKind: "file-viewer",
          fileName: "notes.txt",
          path: "F:/tmp/notes.txt",
          ext: ".txt",
          sizeBytes: 5,
          viewerKind: "text",
          content: "hello",
          actions: { openExternal: true, reveal: true },
        }}
        isFullscreen
        onExitFullscreen={exitFullscreen}
      />,
    );

    const revealButton = screen.getByRole("button", { name: "定位文件" });
    const exitButton = screen.getByTestId("file-viewer-fullscreen-exit");

    expect(revealButton.nextElementSibling).toBe(exitButton);
    fireEvent.click(exitButton);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
