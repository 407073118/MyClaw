/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session = {
    id: "chat-session-1",
    title: "Demo Session",
    messages: [],
  };

  const workspace = {
    currentSession: session,
    sessions: [session],
    approvalRequests: [],
    skills: [],
    selectSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    pushAssistantMessage: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    cancelSessionRun: vi.fn().mockResolvedValue(undefined),
    resolveApproval: vi.fn(),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  return {
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("ChatPage", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.deleteSession.mockReset();
    mocks.workspace.selectSession.mockReset();
    mocks.workspace.pushAssistantMessage.mockReset();
    mocks.workspace.createSession.mockReset();
    mocks.workspace.sendMessage.mockReset();
    mocks.workspace.cancelSessionRun.mockReset();
    mocks.workspace.resolveApproval.mockReset();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("announces delete confirmation as a dialog and restores focus after escape", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => sessionStreamUnsubscribe),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const deleteButton = screen.getByTestId("session-delete-chat-session-1");
    deleteButton.focus();
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();

    const cancelButton = within(dialog).getAllByRole("button")[0] as HTMLButtonElement;
    await waitFor(() => expect(document.activeElement).toBe(cancelButton));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(deleteButton);
  });

  it("calls deleteSession after confirming deletion", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => sessionStreamUnsubscribe),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    fireEvent.click(screen.getByTestId("session-delete-chat-session-1"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getAllByRole("button")[1] as HTMLButtonElement);

    await waitFor(() => expect(mocks.workspace.deleteSession).toHaveBeenCalledWith("chat-session-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a clickable stop button, sends cancel through the store, and restores the composer after a canceled runtime status", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();
    let sessionStreamHandler: ((event: Record<string, unknown>) => void) | undefined;

    mocks.workspace.sendMessage.mockReturnValue(new Promise<void>(() => {}));

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          sessionStreamHandler = callback;
          return sessionStreamUnsubscribe;
        }),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "请先开始分析" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    const stopButton = await screen.findByTestId("composer-stop") as HTMLButtonElement;
    expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("请先开始分析");
    expect(stopButton.disabled).toBe(false);
    expect(getComputedStyle(stopButton).cursor).toBe("pointer");
    expect(composer.disabled).toBe(true);

    fireEvent.click(stopButton);

    await waitFor(() => expect(mocks.workspace.cancelSessionRun).toHaveBeenCalledWith({ reason: "user_stop" }));
    expect((screen.getByTestId("composer-stop") as HTMLButtonElement).disabled).toBe(true);
    expect(getComputedStyle(screen.getByTestId("composer-stop")).cursor).toBe("not-allowed");

    await act(async () => {
      sessionStreamHandler?.({
        type: "runtime.status",
        payload: {
          sessionId: "chat-session-1",
          runId: "run-1",
          status: "canceled",
          phase: "model",
          reason: "user_stop",
        },
      });
    });

    await waitFor(() => {
      expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).disabled).toBe(false);
      expect(screen.getByTestId("composer-submit")).toBeTruthy();
    });
  });
});
