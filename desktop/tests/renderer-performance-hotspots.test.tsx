/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const chatMocks = vi.hoisted(() => {
  const session = {
    id: "chat-session-1",
    title: "Performance Session",
    messages: [
      {
        id: "assistant-msg-1",
        role: "assistant",
        content: "Cached answer",
        createdAt: "2026-05-21T00:00:00.000Z",
      },
    ],
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
    agentTasks: [],
    modelSwitchNotice: null,
    myClawRootPath: "F:/MyClaw",
    workspaceRootPath: "F:/MyClaw",
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    pushAssistantMessage: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    cancelSessionRun: vi.fn(),
    pollBackgroundTask: vi.fn(),
    cancelBackgroundTask: vi.fn(),
    updateSessionRuntimeIntent: vi.fn(),
    applySessionUpdate: vi.fn(),
    applySessionPatch: vi.fn(),
    approvePlan: vi.fn(),
    cancelPlanMode: vi.fn(),
    setActiveSiliconPersonId: vi.fn(),
    dismissModelSwitchNotice: vi.fn(),
    resolveApproval: vi.fn(),
    loadSiliconPersonById: vi.fn(),
    markSiliconPersonSessionRead: vi.fn(),
    createSiliconPersonSession: vi.fn(),
    switchSiliconPersonSession: vi.fn(),
    cancelAgentTask: vi.fn(),
    retryAgentTask: vi.fn(),
    followUpAgentTask: vi.fn(),
    appendAgentTaskResultToSource: vi.fn(),
    createAgentTask: vi.fn(),
    sendSiliconPersonMessage: vi.fn(),
  };

  const siliconWorkspace = {
    approvalRequests: [],
    siliconPersons: [
      {
        id: "sp-1",
        name: "Ada",
        title: "Research Partner",
        description: "Owns private session work.",
        status: "done",
        source: "personal",
        approvalMode: "inherit",
        currentSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "Default Session",
            status: "done",
            unreadCount: 0,
            hasUnread: false,
            needsApproval: false,
            updatedAt: "2026-05-21T00:00:00.000Z",
          },
        ],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        avatarDataUrl: null,
        updatedAt: "2026-05-21T00:00:00.000Z",
        workflowIds: [],
        skillIds: [],
        mcpServerIds: [],
      },
    ],
    sessions: [
      {
        id: "session-1",
        title: "Default Session",
        modelProfileId: "model-1",
        attachedDirectory: null,
        createdAt: "2026-05-21T00:00:00.000Z",
        runtimeVersion: 2,
        siliconPersonId: "sp-1",
        tasks: [],
        messages: [
          {
            id: "rendered-msg-1",
            role: "assistant",
            content: "**raw markdown**",
            renderedHtml: "<p><strong>ready html</strong></p>",
            createdAt: "2026-05-21T00:10:00.000Z",
          },
        ],
      },
    ],
    workflows: [],
    workflowSummaries: {},
    workflowRuns: {},
    skills: [],
    mcpServers: [],
    models: [{ id: "model-1", name: "Qwen Max" }],
    defaultModelProfileId: "model-1",
    time: {
      scheduleJobs: [],
      executionRuns: [],
      availabilityPolicy: { timezone: "Asia/Shanghai", workingHours: [] },
      awarenessSnapshot: { activeSignals: [] },
    },
    webPanel: { isOpen: false, tabs: [], activeTabId: null },
    createWebPanelTab: vi.fn(),
    closeWebPanel: vi.fn(),
    loadSiliconPersonById: vi.fn().mockResolvedValue(null),
    loadWorkflows: vi.fn().mockResolvedValue([]),
    updateSiliconPerson: vi.fn().mockResolvedValue(null),
    createSiliconPersonSession: vi.fn().mockResolvedValue(null),
    switchSiliconPersonSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sendSiliconPersonMessage: vi.fn().mockResolvedValue(null),
    startSiliconPersonWorkflowRun: vi.fn().mockResolvedValue(null),
    markSiliconPersonSessionRead: vi.fn().mockResolvedValue(null),
    resolveApproval: vi.fn().mockResolvedValue({ success: true }),
    acknowledgeAwarenessSignal: vi.fn(),
    updateScheduleJob: vi.fn().mockResolvedValue(null),
    createScheduleJob: vi.fn().mockResolvedValue(null),
    deleteScheduleJob: vi.fn().mockResolvedValue(null),
    executeScheduleJobNow: vi.fn().mockResolvedValue(null),
  };

  return {
    workspace,
    siliconWorkspace,
    inlineRenderMock: vi.fn(() => React.createElement("div", { "data-testid": "inline-message" }, "inline")),
    markdownRenderMock: vi.fn(({ source }: { source: string }) => React.createElement("div", { "data-testid": "markdown-message" }, source)),
    getCachedMarkdownMock: vi.fn((_id: string, content: string, renderMarkdown: (value: string) => string) => renderMarkdown(content)),
    useWorkspaceStoreMock: Object.assign(
      vi.fn((selector?: unknown) => {
        if (typeof selector !== "function") {
          throw new Error("renderer performance test forbids full workspace subscriptions");
        }
        return selector(chatMocks.workspace);
      }),
      { getState: () => workspace },
    ),
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: chatMocks.useWorkspaceStoreMock,
  bufferStreamingDelta: vi.fn(),
  getCachedMarkdown: chatMocks.getCachedMarkdownMock,
  flushStreamingBufferNow: vi.fn(),
}));

vi.mock("../src/renderer/components/InlineFileReferenceContent", () => ({
  default: chatMocks.inlineRenderMock,
}));

vi.mock("../src/renderer/components/MarkdownView", () => ({
  default: chatMocks.markdownRenderMock,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "sp-1" }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize?: (index: number) => number }) => {
    const items = Array.from({ length: count }, (_, index) => {
      const size = estimateSize?.(index) ?? 120;
      return { index, key: index, start: index * size, size };
    });
    return {
      getTotalSize: () => items.reduce((sum, item) => sum + item.size, 0),
      getVirtualItems: () => items,
      measureElement: () => undefined,
    };
  },
}));

describe("renderer performance hotspots", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    chatMocks.inlineRenderMock.mockClear();
    chatMocks.markdownRenderMock.mockClear();
    chatMocks.getCachedMarkdownMock.mockClear();
    chatMocks.useWorkspaceStoreMock.mockImplementation((selector?: unknown) => {
      if (typeof selector !== "function") {
        throw new Error("renderer performance test forbids full workspace subscriptions");
      }
      return selector(chatMocks.workspace);
    });
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("keeps rendered chat message content stable when only the composer draft changes", async () => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
        onTimeReminderDelivered: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    const initialRenderCalls = chatMocks.inlineRenderMock.mock.calls.length;
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "draft" } });

    expect(chatMocks.inlineRenderMock).toHaveBeenCalledTimes(initialRenderCalls);
  });

  it("applies lightweight session patch stream events through the workspace store", async () => {
    const patch = {
      sessionId: "chat-session-1",
      revision: 2,
      kind: "messages.update",
      messageId: "assistant-msg-1",
      fields: { content: "patched" },
    };
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          callback({ type: "session.patched", sessionId: "chat-session-1", patch });
          return vi.fn();
        }),
        onWebPanelOpen: vi.fn(() => vi.fn()),
        onTimeReminderDelivered: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(chatMocks.workspace.applySessionPatch).toHaveBeenCalledWith(patch);
    expect(chatMocks.workspace.applySessionUpdate).not.toHaveBeenCalled();
  });

  it("stores only preview metadata for active tool.started arguments", async () => {
    chatMocks.workspace.currentSession = {
      ...chatMocks.workspace.currentSession,
      messages: [
        {
          id: "assistant-tool-call",
          role: "assistant",
          content: "",
          createdAt: "2026-05-21T00:00:00.000Z",
          tool_calls: [
            {
              id: "tool-call-1",
              function: { name: "fs_read", arguments: "{}" },
            },
          ],
        },
      ],
    };
    chatMocks.workspace.sessions = [chatMocks.workspace.currentSession];
    const fullArguments = { path: "F:/MyClaw/large.md", content: "x".repeat(4096) };
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn((callback: (event: Record<string, unknown>) => void) => {
          setTimeout(() => callback({
            type: "tool.started",
            sessionId: "chat-session-1",
            toolCallId: "tool-call-1",
            toolId: "fs.read",
            toolName: "fs_read",
            arguments: fullArguments,
            inputPreview: "{\"path\":\"F:/MyClaw/large.md\"}",
            inputBytes: 4200,
            inputHash: "hash-123",
          }), 0);
          return vi.fn();
        }),
        onWebPanelOpen: vi.fn(() => vi.fn()),
        onTimeReminderDelivered: vi.fn(() => vi.fn()),
      },
    });

    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(React.createElement(ChatPage));

    expect(await screen.findByText(/hash-123/)).toBeTruthy();
    expect(screen.getByText(/4200/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("x".repeat(512));
  });

  it("uses narrow silicon workspace selectors and does not parse pre-rendered html as markdown", async () => {
    chatMocks.useWorkspaceStoreMock.mockImplementation((selector?: unknown) => {
      if (typeof selector !== "function") {
        throw new Error("renderer performance test forbids full workspace subscriptions");
      }
      return selector(chatMocks.siliconWorkspace);
    });
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        listSiliconPersonSkills: vi.fn().mockResolvedValue({ items: [] }),
        listSiliconPersonMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
        getSiliconPersonPaths: vi.fn().mockResolvedValue({ personDir: "", skillsDir: "", sessionsDir: "" }),
        fileViewerOpenExternal: vi.fn().mockResolvedValue({ success: true }),
      },
    });

    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");
    await act(async () => {
      render(React.createElement(SiliconPersonWorkspacePage));
    });

    expect(chatMocks.inlineRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<p><strong>ready html</strong></p>" }),
      expect.anything(),
    );
    expect(chatMocks.markdownRenderMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: "<p><strong>ready html</strong></p>" }),
      expect.anything(),
    );
  });

  it("keeps raw html-like silicon messages on the Markdown path", async () => {
    const originalSessions = chatMocks.siliconWorkspace.sessions;
    chatMocks.siliconWorkspace.sessions = [
      {
        ...originalSessions[0],
        messages: [
          {
            id: "raw-html-msg-1",
            role: "assistant",
            content: "<img src=x onerror=alert(1)>",
            createdAt: "2026-05-21T00:10:00.000Z",
          },
        ],
      },
    ];
    chatMocks.useWorkspaceStoreMock.mockImplementation((selector?: unknown) => {
      if (typeof selector !== "function") {
        throw new Error("renderer performance test forbids full workspace subscriptions");
      }
      return selector(chatMocks.siliconWorkspace);
    });
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        listSiliconPersonSkills: vi.fn().mockResolvedValue({ items: [] }),
        listSiliconPersonMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
        getSiliconPersonPaths: vi.fn().mockResolvedValue({ personDir: "", skillsDir: "", sessionsDir: "" }),
        fileViewerOpenExternal: vi.fn().mockResolvedValue({ success: true }),
      },
    });

    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");
    await act(async () => {
      render(React.createElement(SiliconPersonWorkspacePage));
    });

    expect(chatMocks.inlineRenderMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ html: "<img src=x onerror=alert(1)>" }),
      expect.anything(),
    );
    expect(chatMocks.markdownRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "<img src=x onerror=alert(1)>" }),
      expect.anything(),
    );
    chatMocks.siliconWorkspace.sessions = originalSessions;
  });
});
