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
    models: [],
    defaultModelProfileId: null,
    approvalRequests: [],
    skills: [],
    siliconPersons: [],
    activeSiliconPersonId: null,
    selectSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    pushAssistantMessage: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    cancelSessionRun: vi.fn().mockResolvedValue(undefined),
    pollBackgroundTask: vi.fn().mockResolvedValue(null),
    cancelBackgroundTask: vi.fn().mockResolvedValue(null),
    updateSessionRuntimeIntent: vi.fn().mockResolvedValue(undefined),
    setActiveSiliconPersonId: vi.fn(),
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
    mocks.workspace.pollBackgroundTask.mockReset();
    mocks.workspace.cancelBackgroundTask.mockReset();
    mocks.workspace.updateSessionRuntimeIntent.mockReset();
    mocks.workspace.setActiveSiliconPersonId.mockReset();
    mocks.workspace.resolveApproval.mockReset();
    mocks.workspace.approvalRequests.splice(0, mocks.workspace.approvalRequests.length);
    delete (mocks.workspace.currentSession as Record<string, unknown>).lastComputerCalls;
    delete (mocks.workspace.currentSession as Record<string, unknown>).backgroundTask;
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

  it("renders without hitting a session initialization crash", async () => {
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

    expect(() => {
      render(React.createElement(ChatPage));
    }).not.toThrow();

    expect(screen.getByTestId("new-chat-button")).toBeTruthy();
  });

  it("keeps the composer editable while a stop button is shown, then restores submit after a canceled runtime status", async () => {
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
    expect(composer.disabled).toBe(false);
    fireEvent.change(composer, { target: { value: "继续补充上下文" } });
    expect(composer.value).toBe("继续补充上下文");

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

  it("restores the composer after completion even if reasoning effort is changed while the turn is running", async () => {
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
    fireEvent.change(composer, { target: { value: "继续执行" } });
    fireEvent.click(screen.getByTestId("composer-submit"));

    await screen.findByTestId("composer-stop");
    fireEvent.click(screen.getByRole("button", { name: "极深" }));

    await waitFor(() => expect(mocks.workspace.updateSessionRuntimeIntent).toHaveBeenCalledWith({
      reasoningEffort: "xhigh",
    }));

    await act(async () => {
      sessionStreamHandler?.({
        type: "runtime.status",
        payload: {
          sessionId: "chat-session-1",
          runId: "run-2",
          status: "completed",
          phase: "model",
        },
      });
    });

    await waitFor(() => {
      expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).disabled).toBe(false);
      expect(screen.getByTestId("composer-submit")).toBeTruthy();
    });
  });

  it("sends on plain Enter in the composer", async () => {
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

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "hello" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(mocks.workspace.sendMessage).toHaveBeenCalledWith("hello"));
  });

  it("does not send on Ctrl+Enter in the composer", async () => {
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

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "hello" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter", ctrlKey: true });

    expect(mocks.workspace.sendMessage).not.toHaveBeenCalled();
    expect(composer.value).toBe("hello");
  });

  it("does not send when Enter is used to confirm IME composition", async () => {
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

    const composer = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "nihao" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter", keyCode: 229, which: 229 });

    expect(mocks.workspace.sendMessage).not.toHaveBeenCalled();
    expect(composer.value).toBe("nihao");
  });

  it("toggles the work files drawer from the chat header instead of keeping it always visible", async () => {
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

    expect(screen.queryByTestId("work-files-panel")).toBeNull();

    const toggleButton = screen.getByTestId("work-files-toggle");
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggleButton);

    expect(await screen.findByTestId("work-files-panel")).toBeTruthy();
    expect(screen.getByTestId("work-files-toggle").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("work-files-toggle"));

    await waitFor(() => expect(screen.queryByTestId("work-files-panel")).toBeNull());
    expect(screen.getByTestId("work-files-toggle").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a background research panel and lets the user refresh or cancel it", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();

    Object.assign(mocks.workspace.currentSession, {
      backgroundTask: {
        id: "resp_background_1",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_background_1",
        status: "in_progress",
        pollAfterMs: 60000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:01:00.000Z",
      },
    });

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => sessionStreamUnsubscribe),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.getByTestId("background-task-panel")).toBeTruthy();
    expect(screen.getByText("后台研究进行中")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "立即刷新" }));
    await waitFor(() => expect(mocks.workspace.pollBackgroundTask).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "取消后台任务" }));
    await waitFor(() => expect(mocks.workspace.cancelBackgroundTask).toHaveBeenCalledTimes(1));
  });

  it("renders last-turn citations and capability trace cards when the session carries native search metadata", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();

    Object.assign(mocks.workspace.currentSession, {
      lastTurnCitations: [
        {
          id: "cite-1",
          url: "https://example.com/news",
          title: "Latest News",
          domain: "example.com",
          snippet: "OpenAI released updates",
          sourceType: "vendor-web-search",
          traceRef: "ws_1",
        },
      ],
      lastCapabilityEvents: [
        {
          type: "web_search_call",
          capabilityId: "search",
          createdAt: "2026-04-14T00:03:00.000Z",
          payload: {
            traceId: "ws_1",
            action: "search",
            queries: ["OpenAI latest updates"],
          },
        },
      ],
    });

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => sessionStreamUnsubscribe),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.getByTestId("citation-list")).toBeTruthy();
    expect(screen.getByText("Latest News")).toBeTruthy();
    expect(screen.getByTestId("capability-trace-timeline")).toBeTruthy();
    expect(screen.getByText("OpenAI latest updates")).toBeTruthy();
  });

  it("renders file-search citations even when the source does not expose a clickable url", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();

    Object.assign(mocks.workspace.currentSession, {
      lastTurnCitations: [
        {
          id: "cite-file-1",
          url: null,
          title: "employee-handbook.pdf",
          fileId: "file_123",
          filename: "employee-handbook.pdf",
          snippet: "The handbook requires manager approval for purchases over $5,000.",
          sourceType: "file-search",
          traceRef: null,
        },
      ],
      lastCapabilityEvents: [
        {
          type: "file_search_call",
          capabilityId: "knowledge-retrieval",
          createdAt: "2026-04-14T00:04:00.000Z",
          payload: {
            traceId: "fs_1",
            queries: ["manager approval purchase limit"],
          },
        },
      ],
    });

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => sessionStreamUnsubscribe),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.getByTestId("citation-list")).toBeTruthy();
    expect(screen.getByText("employee-handbook.pdf")).toBeTruthy();
    expect(screen.getByText("file-search")).toBeTruthy();
    expect(screen.getByText("file_123")).toBeTruthy();
  });

  it("renders native computer action cards and pending computer approvals", async () => {
    const sessionStreamUnsubscribe = vi.fn();
    const webPanelUnsubscribe = vi.fn();

    Object.assign(mocks.workspace.currentSession, {
      lastComputerCalls: [
        {
          id: "cc_1",
          status: "completed",
          actions: [
            { type: "screenshot" },
            { type: "click", x: 420, y: 220 },
            { type: "type", text: "OpenAI" },
          ],
        },
      ],
    });
    mocks.workspace.approvalRequests.push({
      id: "approval-computer-1",
      sessionId: "chat-session-1",
      source: "builtin-tool",
      toolId: "computer.click",
      label: "computer.click",
      risk: "write",
      detail: "{\"x\":420,\"y\":220}",
    } as any);

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => sessionStreamUnsubscribe),
        onWebPanelOpen: vi.fn(() => webPanelUnsubscribe),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(screen.getByTestId("computer-call-list")).toBeTruthy();
    expect(screen.getByText("click")).toBeTruthy();
    expect(screen.getByText("type")).toBeTruthy();
    expect(screen.getByTestId("approval-card-approval-computer-1")).toBeTruthy();
  });
});
