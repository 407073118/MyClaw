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
});
