/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mainSession = {
    id: "main-session-1",
    title: "Main Session",
    modelProfileId: "model-main",
    attachedDirectory: null,
    createdAt: "2026-04-15T00:00:00.000Z",
    runtimeVersion: 2,
    messages: [
      { id: "main-msg-1", role: "assistant" as const, content: "这是主聊天里的消息。", createdAt: "2026-04-15T00:01:00.000Z" },
    ],
  };
  const siliconSession = {
    id: "silicon-session-1",
    title: "Ada Current Session",
    modelProfileId: "model-silicon",
    attachedDirectory: null,
    createdAt: "2026-04-15T00:02:00.000Z",
    runtimeVersion: 2,
    siliconPersonId: "sp-1",
    messages: [
      { id: "silicon-msg-1", role: "assistant" as const, content: "这是 Ada 的私有会话消息。", createdAt: "2026-04-15T00:03:00.000Z" },
    ],
  };

  const workspace = {
    currentSession: mainSession,
    sessions: [mainSession, siliconSession],
    models: [],
    defaultModelProfileId: null,
    approvalRequests: [],
    skills: [],
    siliconPersons: [
      {
        id: "sp-1",
        name: "Ada",
        title: "研究搭档",
        description: "负责承接被选中的私有会话。",
        status: "idle" as const,
        source: "personal" as const,
        approvalMode: "inherit" as const,
        currentSessionId: "silicon-session-1",
        sessions: [
          {
            id: "silicon-session-1",
            title: "Ada Current Session",
            status: "idle" as const,
            unreadCount: 1,
            hasUnread: true,
            needsApproval: false,
            updatedAt: "2026-04-15T00:03:00.000Z",
          },
        ],
        unreadCount: 1,
        hasUnread: true,
        needsApproval: false,
        updatedAt: "2026-04-15T00:03:00.000Z",
        workflowIds: [],
      },
    ],
    activeSiliconPersonId: "sp-1",
    selectSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    pushAssistantMessage: vi.fn(),
    createSession: vi.fn(),
    createSiliconPersonSession: vi.fn().mockResolvedValue({
      id: "silicon-session-2",
      title: "Ada Follow-up",
      modelProfileId: "model-silicon",
      attachedDirectory: null,
      createdAt: "2026-04-15T00:04:00.000Z",
      runtimeVersion: 2,
      siliconPersonId: "sp-1",
      messages: [],
    }),
    switchSiliconPersonSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    sendSiliconPersonMessage: vi.fn().mockResolvedValue(undefined),
    cancelSessionRun: vi.fn().mockResolvedValue(undefined),
    pollBackgroundTask: vi.fn().mockResolvedValue(null),
    cancelBackgroundTask: vi.fn().mockResolvedValue(null),
    updateSessionRuntimeIntent: vi.fn().mockResolvedValue(undefined),
    setActiveSiliconPersonId: vi.fn(),
    markSiliconPersonSessionRead: vi.fn().mockResolvedValue(undefined),
    loadSiliconPersonById: vi.fn().mockResolvedValue(undefined),
    applySessionUpdate: vi.fn(),
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

describe("ChatPage silicon person mode", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.selectSession.mockReset();
    mocks.workspace.deleteSession.mockReset();
    mocks.workspace.pushAssistantMessage.mockReset();
    mocks.workspace.createSession.mockReset();
    mocks.workspace.createSiliconPersonSession.mockReset();
    mocks.workspace.switchSiliconPersonSession.mockReset();
    mocks.workspace.sendMessage.mockReset();
    mocks.workspace.sendSiliconPersonMessage.mockReset();
    mocks.workspace.cancelSessionRun.mockReset();
    mocks.workspace.pollBackgroundTask.mockReset();
    mocks.workspace.cancelBackgroundTask.mockReset();
    mocks.workspace.updateSessionRuntimeIntent.mockReset();
    mocks.workspace.setActiveSiliconPersonId.mockReset();
    mocks.workspace.markSiliconPersonSessionRead.mockReset();
    mocks.workspace.loadSiliconPersonById.mockReset();
    mocks.workspace.applySessionUpdate.mockReset();
    mocks.workspace.resolveApproval.mockReset();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("reuses ChatPage for the selected silicon person session instead of the main chat session", async () => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.getAllByText("这是 Ada 的私有会话消息。").length).toBeGreaterThan(0);
    expect(screen.queryByText("这是主聊天里的消息。")).toBeNull();
    expect(screen.getByTestId("session-item-silicon-session-1")).toBeTruthy();
    expect(screen.queryByTestId("session-item-main-session-1")).toBeNull();
    expect(screen.queryByTestId("mention-target-indicator")).toBeNull();

    fireEvent.change(screen.getByTestId("composer-input"), {
      target: { value: "继续处理这个私有任务" },
    });
    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(mocks.workspace.sendSiliconPersonMessage).toHaveBeenCalledWith("sp-1", "继续处理这个私有任务");
    });
    expect(mocks.workspace.sendMessage).not.toHaveBeenCalled();
    expect(mocks.workspace.setActiveSiliconPersonId).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("new-chat-button"));

    await waitFor(() => {
      expect(mocks.workspace.createSiliconPersonSession).toHaveBeenCalledWith("sp-1");
    });
    expect(mocks.workspace.createSession).not.toHaveBeenCalled();
  });

  it("shows a return-to-main-chat action in silicon person mode", async () => {
    mocks.workspace.loadSiliconPersonById.mockResolvedValue(undefined);
    mocks.workspace.markSiliconPersonSessionRead.mockResolvedValue(undefined);

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    fireEvent.click(screen.getByTestId("return-main-chat-button"));

    expect(mocks.workspace.setActiveSiliconPersonId).toHaveBeenCalledWith(null);
  });

  it("hides the reasoning-effort selector in silicon person mode", async () => {
    mocks.workspace.loadSiliconPersonById.mockResolvedValue(undefined);
    mocks.workspace.markSiliconPersonSessionRead.mockResolvedValue(undefined);

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.queryByTestId("effort-selector")).toBeNull();
  });

  it("refreshes the active silicon person summary after receiving a session update for that person", async () => {
    const originalCurrentSessionId = mocks.workspace.siliconPersons[0]?.currentSessionId ?? null;
    const originalSessions = mocks.workspace.siliconPersons[0]?.sessions ?? [];
    const streamHandlers: Array<(event: Record<string, unknown>) => void> = [];

    if (mocks.workspace.siliconPersons[0]) {
      mocks.workspace.siliconPersons[0].currentSessionId = null;
      mocks.workspace.siliconPersons[0].sessions = [];
    }

    mocks.workspace.loadSiliconPersonById.mockImplementation(async () => {
      if (mocks.workspace.siliconPersons[0]) {
        mocks.workspace.siliconPersons[0].currentSessionId = "silicon-session-2";
        mocks.workspace.siliconPersons[0].sessions = [
          {
            id: "silicon-session-2",
            title: "Ada Follow-up",
            status: "running",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: "2026-04-15T00:05:00.000Z",
          },
        ];
      }
      return mocks.workspace.siliconPersons[0];
    });

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          streamHandlers.push(callback);
          return vi.fn();
        }),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    await act(async () => {
      streamHandlers[0]?.({
        type: "session.updated",
        session: {
          id: "silicon-session-2",
          title: "Ada Follow-up",
          modelProfileId: "model-silicon",
          attachedDirectory: null,
          createdAt: "2026-04-15T00:04:00.000Z",
          runtimeVersion: 2,
          siliconPersonId: "sp-1",
          messages: [
            { id: "silicon-msg-2", role: "assistant", content: "Fresh session reply", createdAt: "2026-04-15T00:05:00.000Z" },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(mocks.workspace.loadSiliconPersonById).toHaveBeenCalledWith("sp-1");
    });

    if (mocks.workspace.siliconPersons[0]) {
      mocks.workspace.siliconPersons[0].currentSessionId = originalCurrentSessionId;
      mocks.workspace.siliconPersons[0].sessions = originalSessions;
    }
  });

  it("keeps @ dispatch as a local composer action instead of reusing the selected chat object state", async () => {
    const originalActiveSiliconPersonId = mocks.workspace.activeSiliconPersonId;
    mocks.workspace.activeSiliconPersonId = null;

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const composer = screen.getByTestId("composer-input");
    fireEvent.change(composer, {
      target: { value: "@Ada" },
    });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(screen.getByTestId("mention-target-indicator")).toBeTruthy();
    expect(mocks.workspace.setActiveSiliconPersonId).not.toHaveBeenCalled();

    fireEvent.change(composer, {
      target: { value: "dispatch this task" },
    });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(mocks.workspace.sendSiliconPersonMessage).toHaveBeenCalledWith("sp-1", "dispatch this task");
    });
    expect(mocks.workspace.sendMessage).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("mention-target-indicator")).toBeNull();
    });

    mocks.workspace.activeSiliconPersonId = originalActiveSiliconPersonId;
  });
});
