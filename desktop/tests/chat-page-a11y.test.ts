/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    resolveApproval: vi.fn(),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) =>
      (typeof selector === "function" ? selector(workspace) : workspace),
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

    const dialog = await screen.findByRole("dialog", { name: "删除这条对话记录？" });
    expect(dialog).toBeTruthy();

    const cancelButton = within(dialog).getByRole("button", { name: "取消" });
    await waitFor(() => expect(document.activeElement).toBe(cancelButton));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "删除这条对话记录？" })).toBeNull());
    expect(document.activeElement).toBe(deleteButton);
  });
});
