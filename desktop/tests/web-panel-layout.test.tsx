/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    fireEvent.click(screen.getByTestId("web-panel-fullscreen-exit"));
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });

  it("keeps a floating exit button available after fullscreening an HTML panel", () => {
    const { container } = render(<WebPanel />);
    const panel = container.querySelector(".web-panel");

    fireEvent.click(screen.getByRole("button", { name: "全屏展示" }));
    const floatingExit = screen.getByTestId("web-panel-floating-fullscreen-exit");
    const iframe = container.querySelector(".wp-iframe");

    expect(floatingExit.textContent).toContain("退出全屏");
    expect(Boolean(iframe?.compareDocumentPosition(floatingExit) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    fireEvent.click(floatingExit);
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });

  it("pushes updated skill data into an already loaded iframe", () => {
    const postMessage = vi.fn();
    const contentWindowSpy = vi
      .spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
      .mockReturnValue({ postMessage } as unknown as Window);

    try {
      const { container } = render(<WebPanel />);
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;

      fireEvent.load(iframe);
      expect(postMessage).toHaveBeenCalledWith({ type: "skill-data", payload: null }, "*");

      act(() => {
        useWorkspaceStore.getState().openWebPanel("F:/MyClaw/preview.html", "Preview", {
          diagnosis: { matchScore: 35 },
        });
      });

      expect(postMessage).toHaveBeenCalledWith(
        { type: "skill-data", payload: { diagnosis: { matchScore: 35 } } },
        "*",
      );
    } finally {
      contentWindowSpy.mockRestore();
    }
  });

  it("lets an HTML panel request a local dataRef through the host bridge", async () => {
    const iframeWindow = { postMessage: vi.fn() } as unknown as Window;
    const contentWindowSpy = vi
      .spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
      .mockReturnValue(iframeWindow);
    Object.defineProperty(window, "myClawAPI", {
      value: {
        webPanelReadSkillDataRef: vi.fn().mockResolvedValue({
          success: true,
          data: { diagnosis: { matchScore: 35 } },
        }),
      },
      configurable: true,
    });

    try {
      render(<WebPanel />);
      window.dispatchEvent(new MessageEvent("message", {
        source: iframeWindow,
        data: {
          type: "skill-callback",
          action: "read-data-ref",
          requestId: "req-1",
          skillId: "skill-br-interview",
          dataRef: "payload.json",
        },
      }));

      await waitFor(() => {
        expect(window.myClawAPI.webPanelReadSkillDataRef).toHaveBeenCalledWith(
          "skill-br-interview",
          "payload.json",
        );
      });
      expect(iframeWindow.postMessage).toHaveBeenCalledWith(
        {
          type: "skill-data-ref-result",
          requestId: "req-1",
          success: true,
          payload: { diagnosis: { matchScore: 35 } },
        },
        "*",
      );
    } finally {
      contentWindowSpy.mockRestore();
      delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
    }
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
    const exitButton = screen.getByTestId("file-viewer-fullscreen-exit");
    expect(exitButton.textContent).toContain("退出全屏");
    expect(screen.queryByTestId("web-panel-floating-fullscreen-exit")).toBeNull();

    fireEvent.click(exitButton);
    expect(panel?.classList.contains("fullscreen")).toBe(false);
  });
});
