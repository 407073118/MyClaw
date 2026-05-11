/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FILE_VIEWER_PANEL_PATH } from "../shared/contracts";
import WebPanel from "../src/renderer/components/WebPanel";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("WebPanel layout controls", () => {
  beforeEach(() => {
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

  it("toggles a fullscreen preview mode from the toolbar", () => {
    const { container } = render(<WebPanel />);
    const panel = container.querySelector(".web-panel");

    fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
    expect(panel?.classList.contains("fullscreen")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });

  it("shows a visible fullscreen exit button for file previews", () => {
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
