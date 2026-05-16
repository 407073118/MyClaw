/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FILE_VIEWER_PANEL_PATH } from "../shared/contracts";
import WebPanel from "../src/renderer/components/WebPanel";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("WebPanel layout controls", () => {
  const panelOpen = vi.fn(async () => ({ success: true }));
  const panelSetBounds = vi.fn(async () => ({ success: true }));
  const panelClose = vi.fn(async () => ({ success: true }));
  const panelRefresh = vi.fn(async () => ({ success: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        panelOpen,
        panelSetBounds,
        panelClose,
        panelRefresh,
      },
    });
    useWorkspaceStore.setState((state) => ({
      webPanel: {
        ...state.webPanel,
        isOpen: true,
        viewPath: "F:/MyClaw/preview.html",
        title: "Preview",
        data: null,
        panelWidth: 420,
      },
    }));
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
    useWorkspaceStore.setState((state) => ({
      webPanel: {
        ...state.webPanel,
        isOpen: false,
        viewPath: null,
        title: "",
        data: null,
        panelWidth: 420,
      },
    }));
  });

  it("allows dragging the side panel wider than the old compact limit", () => {
    const { container } = render(<WebPanel />);
    const dragHandle = container.querySelector(".wp-drag-handle");
    expect(dragHandle).toBeTruthy();

    fireEvent.mouseDown(dragHandle!, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);

    expect(useWorkspaceStore.getState().webPanel.panelWidth).toBe(1120);
  });

  it("uses a native WebContentsView surface instead of rendering an iframe", async () => {
    const { container } = render(<WebPanel />);

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[data-testid='web-panel-native-surface']")).toBeTruthy();
    await waitFor(() => expect(panelOpen).toHaveBeenCalledWith({
      viewPath: "F:/MyClaw/preview.html",
      title: "Preview",
      data: null,
    }));
  });

  it("reports only the native surface bounds so toolbar controls stay outside WebContentsView", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("wp-native-surface")) {
        return { left: 12, top: 54, width: 408, height: 630, right: 420, bottom: 684, x: 12, y: 54, toJSON: () => ({}) };
      }
      if (this.classList.contains("web-panel")) {
        return { left: 12, top: 12, width: 408, height: 672, right: 420, bottom: 684, x: 12, y: 12, toJSON: () => ({}) };
      }
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    try {
      render(<WebPanel />);
      await waitFor(() => expect(panelSetBounds).toHaveBeenCalledWith({
        x: 12,
        y: 54,
        width: 408,
        height: 630,
      }));
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("toggles a fullscreen preview mode from the toolbar", () => {
    const { container } = render(<WebPanel />);
    const panel = container.querySelector(".web-panel");

    fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
    expect(panel?.classList.contains("fullscreen")).toBe(true);

    fireEvent.click(screen.getByTestId("web-panel-fullscreen-exit"));
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });

  it("keeps fullscreen exit in the dock toolbar outside the native surface", () => {
    const { container } = render(<WebPanel />);
    const panel = container.querySelector(".web-panel");

    fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
    const toolbarExit = screen.getByTestId("web-panel-fullscreen-exit");
    const nativeSurface = container.querySelector(".wp-native-surface");

    expect(toolbarExit.textContent).toContain("退出全屏");
    expect(Boolean(nativeSurface?.compareDocumentPosition(toolbarExit) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true);
    expect(screen.queryByTestId("web-panel-floating-fullscreen-exit")).toBeNull();
    fireEvent.click(toolbarExit);
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });

  it("reopens the native panel surface when panel data changes", async () => {
    render(<WebPanel />);
    await waitFor(() => expect(panelOpen).toHaveBeenCalledTimes(1));

    act(() => {
      useWorkspaceStore.getState().openWebPanel("F:/MyClaw/preview.html", "Preview", {
        diagnosis: { matchScore: 35 },
      });
    });

    await waitFor(() => {
      expect(panelOpen).toHaveBeenLastCalledWith({
        viewPath: "F:/MyClaw/preview.html",
        title: "Preview",
        data: { diagnosis: { matchScore: 35 } },
      });
    });
  });

  it("refreshes the native WebContentsView surface from the toolbar", async () => {
    render(<WebPanel />);

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(panelRefresh).toHaveBeenCalledTimes(1));
  });

  it("keeps the dock fullscreen controls for file previews", () => {
    useWorkspaceStore.setState((state) => ({
      webPanel: {
        ...state.webPanel,
        viewPath: FILE_VIEWER_PANEL_PATH,
        title: "notes.txt",
        data: {
          panelKind: "file-viewer",
          fileName: "notes.txt",
          path: "F:/tmp/notes.txt",
          ext: ".txt",
          sizeBytes: 5,
          viewerKind: "text",
          content: "hello",
          actions: { openExternal: true, reveal: true },
        },
      },
    }));

    const { container } = render(<WebPanel />);
    const panel = container.querySelector(".web-panel");

    fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
    const exitButton = screen.getByTestId("web-panel-fullscreen-exit");
    expect(exitButton.textContent).toContain("退出全屏");
    expect(screen.queryByTestId("web-panel-floating-fullscreen-exit")).toBeNull();

    fireEvent.click(exitButton);
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });
});
