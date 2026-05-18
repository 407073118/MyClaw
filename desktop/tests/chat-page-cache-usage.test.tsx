/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session = {
    id: "chat-session-1",
    title: "Cache Session",
    messages: [
      {
        id: "assistant-msg-1",
        role: "assistant",
        content: "回答",
        createdAt: "2026-05-16T00:00:00.000Z",
        usage: {
          promptTokens: 1000,
          completionTokens: 100,
          totalTokens: 1100,
          cacheHitInputTokens: 700,
          cacheMissInputTokens: 300,
          cacheWriteInputTokens: 120,
          cacheEfficiency: 0.7,
        },
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

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  return {
    workspace,
    useWorkspaceStoreMock,
    bufferStreamingDeltaMock: vi.fn(),
    getCachedMarkdownMock: vi.fn((_id: string, content: string, renderMarkdown: (value: string) => string) => renderMarkdown(content)),
    flushStreamingBufferNowMock: vi.fn(),
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
  bufferStreamingDelta: mocks.bufferStreamingDeltaMock,
  getCachedMarkdown: mocks.getCachedMarkdownMock,
  flushStreamingBufferNow: mocks.flushStreamingBufferNowMock,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));

// 缓存用量测试只关心消息内容，虚拟滚动在 JSDOM 中固定渲染全部项目。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize?: (index: number) => number }) => {
    const items = Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: index * (estimateSize?.(index) ?? 120),
      size: estimateSize?.(index) ?? 120,
    }));
    return {
      getTotalSize: () => items.reduce((sum, item) => sum + item.size, 0),
      getVirtualItems: () => items,
      measureElement: () => undefined,
    };
  },
}));

describe("ChatPage cache usage", () => {
  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("shows cache usage details on assistant token badge and session summary", async () => {
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

    const badge = screen.getByText("输入 1000 · 输出 100 · 总计 1100 tokens · 命中 700 · 未命中 300 · 写入 120");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toContain("命中率: 70.0%");
    expect(screen.getByText(/会话总计: 输入 1,000 · 输出 100 · 命中 700 · 未命中 300 · 写入 120 · 总计 1,100 tokens/)).toBeTruthy();
  });
});
