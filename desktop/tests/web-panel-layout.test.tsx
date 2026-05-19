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
  const panelUpdateData = vi.fn(async () => ({ success: true }));
  const panelClose = vi.fn(async () => ({ success: true }));
  const panelRefresh = vi.fn(async () => ({ success: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        panelOpen,
        panelSetBounds,
        panelUpdateData,
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
        tabs: [],
        activeTabId: null,
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
        tabs: [],
        activeTabId: null,
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

  it("keeps the resize hit target outside the native WebContentsView", async () => {
    const { container } = render(<WebPanel />);

    const dragHandle = screen.getByRole("separator", { name: "调整右侧 WebPanel 宽度" });
    const cssText = container.querySelector("style")?.textContent ?? "";

    expect(dragHandle.getAttribute("aria-orientation")).toBe("vertical");
    expect(dragHandle.getAttribute("data-testid")).toBe("web-panel-resize-handle");
    expect(cssText).toContain("overflow: visible;");
    expect(cssText).toContain("left: -12px;");
    expect(cssText).toContain("width: 16px;");
    expect(cssText).toContain("z-index: 2300;");
    await waitFor(() => expect(container.querySelector(".web-panel")?.classList.contains("is-ready")).toBe(true));
  });

  it("converts zoomed renderer coordinates before reporting native surface bounds", async () => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        panelOpen,
        panelSetBounds,
        panelUpdateData,
        panelClose,
        panelRefresh,
        rendererZoomFactor: 0.85,
      },
    });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("wp-native-surface")) {
        return { left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50, toJSON: () => ({}) };
      }
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    try {
      render(<WebPanel />);
      await waitFor(() => expect(panelSetBounds).toHaveBeenCalledWith({
        x: 85,
        y: 42.5,
        width: 680,
        height: 510,
      }));
    } finally {
      rectSpy.mockRestore();
    }
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

  it("keeps the blank WebPanel workspace compact and uses an icon-only add tab action", () => {
    useWorkspaceStore.setState((state) => ({
      webPanel: {
        ...state.webPanel,
        isOpen: true,
        viewPath: null,
        title: "新面板",
        data: null,
        panelWidth: 420,
        tabs: [{
          id: "empty-tab-1",
          viewPath: null,
          title: "新面板",
          data: null,
          createdAt: "2026-05-18T00:00:00.000Z",
        }],
        activeTabId: "empty-tab-1",
      },
    }));

    render(<WebPanel />);

    const addTabButton = screen.getByTestId("web-panel-tab-add");
    const refreshButton = screen.getByRole("button", { name: "刷新" }) as HTMLButtonElement;
    expect(addTabButton.textContent).toBe("");
    expect(refreshButton.disabled).toBe(true);
    expect(screen.getByTestId("web-panel-empty-state").textContent).toContain("右侧 WebPanel");

    fireEvent.click(addTabButton);

    expect(useWorkspaceStore.getState().webPanel.tabs).toHaveLength(2);
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

  it("keeps fullscreen fallback bounds below the app titlebar and WebPanel toolbar while layout settles", async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      render(<WebPanel />);
      fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
      await waitFor(() => expect(panelSetBounds).toHaveBeenLastCalledWith({
        x: 0,
        y: 80,
        width: 1280,
        height: 640,
      }));
    } finally {
      rectSpy.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
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

  it("shows the fullscreen toolbar exit below the app titlebar and above the native surface", () => {
    const { container } = render(<WebPanel />);
    const panel = container.querySelector(".web-panel");

    fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
    const toolbarExit = screen.getByTestId("web-panel-fullscreen-exit");
    const nativeSurface = container.querySelector(".wp-native-surface");
    const cssText = container.querySelector("style")?.textContent ?? "";

    expect(toolbarExit.textContent).toContain("退出全屏");
    expect(Boolean(nativeSurface?.compareDocumentPosition(toolbarExit) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true);
    expect(screen.queryByTestId("web-panel-floating-fullscreen-exit")).toBeNull();
    expect(cssText).toContain("top: 36px;");
    expect(cssText).toContain(".web-panel.fullscreen .wp-empty-panel");
    expect(cssText).toContain("top: 44px;");

    fireEvent.click(toolbarExit);
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });

  it("updates the native panel data without reopening the surface", async () => {
    render(<WebPanel />);
    await waitFor(() => expect(panelOpen).toHaveBeenCalledTimes(1));

    act(() => {
      useWorkspaceStore.getState().openWebPanel("F:/MyClaw/preview.html", "Preview", {
        diagnosis: { matchScore: 35 },
      });
    });

    await waitFor(() => expect(panelUpdateData).toHaveBeenCalledWith({
      diagnosis: { matchScore: 35 },
    }));
    expect(panelOpen).toHaveBeenCalledTimes(1);
  });

  it("refreshes the native WebContentsView surface from the toolbar", async () => {
    render(<WebPanel />);

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(panelRefresh).toHaveBeenCalledTimes(1));
  });

  it("keeps reachable fullscreen controls for file previews", () => {
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

    fireEvent.click(exitButton);
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });
});
