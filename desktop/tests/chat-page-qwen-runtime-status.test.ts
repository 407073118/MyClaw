/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session = {
    id: "chat-session-qwen",
    title: "Qwen Session",
    messages: [],
    runtimeIntent: {
      reasoningEffort: "high",
    },
  };

  const workspace = {
    currentSession: session,
    sessions: [session],
    models: [
      {
        id: "profile-qwen",
        name: "Qwen Max",
        provider: "openai-compatible",
        providerFlavor: "qwen",
        vendorFamily: "qwen",
        providerFamily: "qwen-native",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "test-key",
        model: "qwen-max",
        protocolTarget: "openai-responses",
        discoveredCapabilities: {
          supportsReasoning: true,
          thinkingControlKind: "budget",
          supportsTools: true,
          supportsStreaming: true,
          source: "provider-catalog",
        },
      },
    ],
    defaultModelProfileId: "profile-qwen",
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
  const bufferStreamingDeltaMock = vi.fn();
  const getCachedMarkdownMock = vi.fn((_id: string, content: string, renderMarkdown: (value: string) => string) => renderMarkdown(content));
  const flushStreamingBufferNowMock = vi.fn();

  return {
    workspace,
    useWorkspaceStoreMock,
    bufferStreamingDeltaMock,
    getCachedMarkdownMock,
    flushStreamingBufferNowMock,
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

describe("ChatPage Qwen runtime status", () => {
  afterEach(() => {
    cleanup();
    mocks.bufferStreamingDeltaMock.mockReset();
    mocks.getCachedMarkdownMock.mockReset();
    mocks.getCachedMarkdownMock.mockImplementation((_id: string, content: string, renderMarkdown: (value: string) => string) => renderMarkdown(content));
    mocks.flushStreamingBufferNowMock.mockReset();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("shows the active Qwen vendor, protocol, model, and thinking semantics near the composer", async () => {
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

    const status = screen.getByTestId("chat-runtime-model-status");
    expect(status.textContent).toContain("Qwen");
    expect(status.textContent).toContain("qwen-max");
    expect(status.textContent).toContain("OpenAI Responses");
    expect(status.textContent).toContain("Thinking Budget");
  });
});
