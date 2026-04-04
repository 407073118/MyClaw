/** @vitest-environment jsdom */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const workspaceState = {
  ready: true,
  loading: false,
  sessions: [
    {
      id: "session-1",
      title: "Reasoning Session",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      thinkingEnabled: false,
      thinkingSource: "default",
      createdAt: "2026-04-04T00:00:00.000Z",
      messages: [],
    },
  ],
  currentSession: {
    id: "session-1",
    title: "Reasoning Session",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    thinkingEnabled: false,
    thinkingSource: "default",
    createdAt: "2026-04-04T00:00:00.000Z",
    messages: [],
  },
  skills: [],
  approvalRequests: [],
  updateSessionThinking: vi.fn(),
  selectSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  sendMessage: vi.fn(),
  pushAssistantMessage: vi.fn(),
  patchStreamingMessage: vi.fn(),
  applySessionUpdate: vi.fn(),
  addApprovalRequest: vi.fn(),
  removeApprovalRequest: vi.fn(),
  resolveApproval: vi.fn(),
  requestExecutionIntent: vi.fn(),
  openWebPanel: vi.fn(),
};

vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: () => workspaceState,
}));

describe("phase 9 thinking ui", () => {
  beforeEach(() => {
    workspaceState.currentSession = {
      ...workspaceState.currentSession,
      thinkingEnabled: false,
      thinkingSource: "default",
      messages: [],
    };
    workspaceState.sessions = [workspaceState.currentSession];
    workspaceState.updateSessionThinking.mockReset();
    window.myClawAPI = {
      onSessionStream: () => () => undefined,
      onWebPanelOpen: () => () => undefined,
    } as any;
  });

  it("renders a lightweight thinking badge", async () => {
    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");

    render(React.createElement(ChatPage));

    expect(screen.getByText("Thinking: Off")).toBeTruthy();
  });

  it("asks for confirmation before mid-conversation toggle", async () => {
    workspaceState.currentSession = {
      ...workspaceState.currentSession,
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "已有回复",
          createdAt: "2026-04-04T00:01:00.000Z",
        },
      ],
    };
    workspaceState.sessions = [workspaceState.currentSession];
    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");

    render(React.createElement(ChatPage));

    fireEvent.click(screen.getByRole("button", { name: "Thinking: Off" }));

    expect(screen.getByText("中途切换会改变后续回复延迟与风格，确认继续吗？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续切换" }));

    expect(workspaceState.updateSessionThinking).toHaveBeenCalledWith("session-1", true);
  });

  it("keeps reasoning details rendering available", async () => {
    workspaceState.currentSession = {
      ...workspaceState.currentSession,
      messages: [
        {
          id: "assistant-2",
          role: "assistant",
          content: "最终答案",
          reasoning: "推理过程",
          createdAt: "2026-04-04T00:02:00.000Z",
        },
      ],
    };
    workspaceState.sessions = [workspaceState.currentSession];
    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");

    render(React.createElement(ChatPage));

    expect(screen.getByTestId("reasoning-assistant-2")).toBeTruthy();
  });
});
