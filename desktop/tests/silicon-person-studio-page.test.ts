/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const workspace = {
    approvalRequests: [] as unknown[],
    siliconPersons: [
      {
        id: "sp-1",
        name: "Ada",
        title: "Research Partner",
        description: "Owns private silicon-person session work.",
        status: "done",
        source: "personal",
        approvalMode: "inherit",
        currentSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "Default Session",
            status: "done",
            unreadCount: 2,
            hasUnread: true,
            needsApproval: false,
            updatedAt: "2026-04-08T00:00:00.000Z",
          },
        ],
        unreadCount: 2,
        hasUnread: true,
        needsApproval: false,
        updatedAt: "2026-04-08T01:00:00.000Z",
        workflowIds: ["workflow-1"],
        skillIds: ["skill-1"],
        mcpServerIds: [],
      },
    ],
    sessions: [
      {
        id: "session-1",
        title: "Default Session",
        modelProfileId: "model-1",
        attachedDirectory: null,
        createdAt: "2026-04-08T00:00:00.000Z",
        runtimeVersion: 2,
        siliconPersonId: "sp-1",
        tasks: [
          { id: "task-1", subject: "Break down work", description: "List the first two next steps.", status: "pending", blocks: [], blockedBy: [] },
          { id: "task-2", subject: "Collect evidence", description: "", status: "in_progress", blocks: [], blockedBy: [] },
        ],
        messages: [
          { id: "msg-1", role: "assistant", content: "Break the problem into three steps first.", createdAt: "2026-04-08T00:10:00.000Z" },
        ],
      },
    ],
    workflows: [{ id: "workflow-1", name: "Research SOP" }],
    workflowSummaries: { "workflow-1": { id: "workflow-1", name: "Research SOP" } },
    workflowRuns: {
      "run-1": {
        id: "run-1", workflowId: "workflow-1", workflowVersion: 3, status: "running",
        currentNodeIds: ["node-a"], startedAt: "2026-04-08T00:20:00.000Z", updatedAt: "2026-04-08T00:30:00.000Z",
      },
      "run-2": {
        id: "run-2", workflowId: "workflow-1", workflowVersion: 3, status: "waiting-input",
        currentNodeIds: ["node-b"], startedAt: "2026-04-08T00:40:00.000Z", updatedAt: "2026-04-08T00:50:00.000Z", totalSteps: 5,
      },
    },
    skills: [
      { id: "skill-1", name: "Data Analysis", description: "Analyze structured data", enabled: true },
      { id: "skill-2", name: "Doc Writing", description: "Write summaries and docs", enabled: true },
    ],
    mcpServers: [
      { id: "mcp-1", name: "Internal KB" },
      { id: "mcp-2", name: "Code Search" },
    ],
    models: [
      {
        id: "model-1",
        name: "Qwen Max",
        provider: "openai-compatible",
        providerFlavor: "qwen",
        vendorFamily: "qwen",
        providerFamily: "qwen-native",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "",
        model: "qwen-max",
        protocolTarget: "openai-responses",
        discoveredCapabilities: {
          supportsReasoning: true,
          thinkingControlKind: "budget",
          nativeToolStackId: "qwen-native",
          source: "provider-catalog",
        },
      },
    ],
    defaultModelProfileId: "model-1",
    loadSiliconPersonById: vi.fn().mockResolvedValue(null),
    loadWorkflows: vi.fn().mockResolvedValue([]),
    updateSiliconPerson: vi.fn((siliconPersonId: string, input: Record<string, unknown>) => {
      const target = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!target) return Promise.resolve(null);
      Object.assign(target, input);
      return Promise.resolve(target);
    }),
    createSiliconPersonSession: vi.fn().mockResolvedValue({
      id: "session-2",
      title: "Follow-up Session",
      modelProfileId: "model-1",
      attachedDirectory: null,
      createdAt: "2026-04-08T00:35:00.000Z",
      runtimeVersion: 2,
      siliconPersonId: "sp-1",
      tasks: [],
      messages: [],
    }),
    switchSiliconPersonSession: vi.fn().mockResolvedValue(null),
    sendSiliconPersonMessage: vi.fn().mockResolvedValue(null),
    startSiliconPersonWorkflowRun: vi.fn().mockResolvedValue(null),
    markSiliconPersonSessionRead: vi.fn().mockResolvedValue(null),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    { getState: () => workspace },
  );

  return { workspace, useWorkspaceStoreMock };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("Silicon person studio page", () => {
  beforeEach(() => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        listSiliconPersonSkills: vi.fn().mockResolvedValue({
          items: [
            { id: "skill-1", name: "Data Analysis", description: "Analyze structured data", enabled: true },
            { id: "skill-2", name: "Doc Writing", description: "Write summaries and docs", enabled: true },
          ],
        }),
        listSiliconPersonMcpServers: vi.fn().mockResolvedValue({
          servers: [
            { id: "mcp-1", name: "Internal KB", state: { connected: true } },
            { id: "mcp-2", name: "Code Search", state: { connected: false } },
          ],
        }),
        getSiliconPersonPaths: vi.fn().mockResolvedValue({
          personDir: "C:/data/myClaw/silicon-persons/sp-1",
          skillsDir: "C:/data/myClaw/silicon-persons/sp-1/skills",
          sessionsDir: "C:/data/myClaw/silicon-persons/sp-1/sessions",
        }),
      },
    });
  });

  afterEach(() => {
    cleanup();
    mocks.workspace.loadSiliconPersonById.mockClear();
    mocks.workspace.loadWorkflows.mockClear();
    mocks.workspace.updateSiliconPerson.mockClear();
    mocks.workspace.createSiliconPersonSession.mockClear();
    mocks.workspace.switchSiliconPersonSession.mockClear();
    mocks.workspace.sendSiliconPersonMessage.mockClear();
    mocks.workspace.startSiliconPersonWorkflowRun.mockClear();
    mocks.workspace.markSiliconPersonSessionRead.mockClear();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  async function renderPage() {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    await act(async () => {
      render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/employees/sp-1/studio"] },
          React.createElement(
            Routes,
            undefined,
            React.createElement(Route, {
              path: "/employees/:id/studio",
              element: React.createElement(SiliconPersonWorkspacePage),
            }),
          ),
        ),
      );
    });
  }

  it("renders the private chat view by default and shows the current session history", async () => {
    await renderPage();

    expect(screen.getByTestId("silicon-person-studio-view")).toBeTruthy();
    expect(screen.getByTestId("studio-tab-chat")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-composer-input")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-session-pill-session-1")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-message-list").textContent).toContain("Break the problem into three steps first.");
    expect(mocks.workspace.markSiliconPersonSessionRead).toHaveBeenCalledWith("sp-1", "session-1");
  });

  it("supports editing profile and saving", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("studio-tab-profile"));
    fireEvent.change(screen.getByTestId("profile-tab-approval-mode"), {
      target: { value: "auto_approve" },
    });
    fireEvent.click(screen.getByTestId("profile-tab-save"));
    fireEvent.click(await screen.findByText("确认保存"));

    await waitFor(() => {
      expect(mocks.workspace.updateSiliconPerson).toHaveBeenCalledWith(
        "sp-1",
        expect.objectContaining({ approvalMode: "auto_approve" }),
      );
    });
  });

  it("offers the xhigh reasoning preset and persists it from the profile tab", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("studio-tab-profile"));
    fireEvent.click(screen.getByRole("button", { name: "极深" }));
    fireEvent.click(screen.getByTestId("profile-tab-save"));
    fireEvent.click(await screen.findByText("确认保存"));

    await waitFor(() => {
      expect(mocks.workspace.updateSiliconPerson).toHaveBeenCalledWith(
        "sp-1",
        expect.objectContaining({ reasoningEffort: "xhigh" }),
      );
    });
  });

  it("shows model route diagnostics in the profile tab", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("studio-tab-profile"));
    expect(screen.getByText("运行诊断")).toBeTruthy();
    const status = await screen.findByTestId("silicon-person-workspace-model-status");
    expect(status.textContent).toContain("Qwen");
    expect(status.textContent).toContain("qwen-max");
    expect(status.textContent).toContain("OpenAI Responses");
    expect(status.textContent).toContain("Thinking Budget");
    expect(status.textContent).toContain("qwen-native");
  });

  it("sends follow-up messages from the silicon person chat view", async () => {
    await renderPage();

    fireEvent.change(screen.getByTestId("silicon-person-composer-input"), {
      target: { value: "Please continue with the next step." },
    });
    fireEvent.click(screen.getByTestId("silicon-person-composer-send"));

    await waitFor(() => {
      expect(mocks.workspace.sendSiliconPersonMessage).toHaveBeenCalledWith("sp-1", "Please continue with the next step.");
    });
  });

  it("shows capabilities tab with skills, MCP, and workflow bindings", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("studio-tab-capabilities"));

    await waitFor(() => {
      expect(screen.getByText("Data Analysis")).toBeTruthy();
    });
    expect(screen.getByText("Doc Writing")).toBeTruthy();
    expect(screen.getByText("Internal KB")).toBeTruthy();
    expect(screen.getByText("Code Search")).toBeTruthy();
    expect(screen.getByTestId("silicon-person-workflow-binding-workflow-1")).toBeTruthy();
  });

  it("starts a bound workflow run from the capabilities tab", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("studio-tab-capabilities"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("silicon-person-workflow-start-workflow-1"));
    });

    await waitFor(() => {
      expect(mocks.workspace.startSiliconPersonWorkflowRun).toHaveBeenCalledWith("sp-1", "workflow-1");
    });
  });

  it("shows tasks from the current session", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("studio-tab-tasks"));

    expect(screen.getByText("Break down work")).toBeTruthy();
    expect(screen.getByText("Collect evidence")).toBeTruthy();
  });
});
