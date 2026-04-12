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
        title: "研究搭档",
        description: "负责把主聊天意图沉淀到私域工作空间。",
        status: "done",
        source: "personal",
        approvalMode: "inherit",
        currentSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "默认会话",
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
        title: "默认会话",
        modelProfileId: "model-1",
        attachedDirectory: null,
        createdAt: "2026-04-08T00:00:00.000Z",
        runtimeVersion: 2,
        siliconPersonId: "sp-1",
        tasks: [
          { id: "task-1", subject: "拆解任务", description: "先列出两个可执行步骤。", status: "pending", blocks: [], blockedBy: [] },
          { id: "task-2", subject: "收集资料", description: "", status: "in_progress", blocks: [], blockedBy: [] },
        ],
        messages: [
          { id: "msg-1", role: "assistant", content: "先把问题拆解成三个动作。", createdAt: "2026-04-08T00:10:00.000Z" },
        ],
      },
    ],
    workflows: [{ id: "workflow-1", name: "调研 SOP" }],
    workflowSummaries: { "workflow-1": { id: "workflow-1", name: "调研 SOP" } },
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
      { id: "skill-1", name: "数据分析", description: "数据分析技能", enabled: true },
      { id: "skill-2", name: "文档生成", description: "文档生成技能", enabled: true },
    ],
    mcpServers: [
      { id: "mcp-1", name: "内部知识库" },
      { id: "mcp-2", name: "代码搜索" },
    ],
    models: [
      { id: "model-1", name: "GPT-4o", provider: "openai", baseUrl: "", apiKey: "", model: "gpt-4o" },
    ],
    loadSiliconPersonById: vi.fn().mockResolvedValue(null),
    loadWorkflows: vi.fn().mockResolvedValue([]),
    updateSiliconPerson: vi.fn((siliconPersonId: string, input: Record<string, unknown>) => {
      const target = workspace.siliconPersons.find((item) => item.id === siliconPersonId);
      if (!target) return Promise.resolve(null);
      Object.assign(target, input);
      return Promise.resolve(target);
    }),
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
            { id: "skill-1", name: "数据分析", description: "数据分析技能", enabled: true },
            { id: "skill-2", name: "文档生成", description: "文档生成技能", enabled: true },
          ],
        }),
        listSiliconPersonMcpServers: vi.fn().mockResolvedValue({
          servers: [
            { id: "mcp-1", name: "内部知识库", state: { connected: true } },
            { id: "mcp-2", name: "代码搜索", state: { connected: false } },
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
    mocks.workspace.startSiliconPersonWorkflowRun.mockClear();
    mocks.workspace.markSiliconPersonSessionRead.mockClear();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  function renderPage() {
    return render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes, undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(
              // dynamic import returns default export
              require("../src/renderer/pages/SiliconPersonWorkspacePage").default,
            ),
          }),
        ),
      ),
    );
  }

  it("renders the studio view with profile as default tab", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes, undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(SiliconPersonWorkspacePage),
          }),
        ),
      ),
    );

    expect(screen.getByTestId("silicon-person-studio-view")).toBeTruthy();
    // Profile tab is default — profile form should be visible
    expect(screen.getByTestId("profile-tab-name")).toBeTruthy();
    expect(screen.getByTestId("profile-tab-title")).toBeTruthy();
    // No chat tab elements
    expect(screen.queryByTestId("silicon-person-composer-input")).toBeNull();
  });

  it("supports editing profile and saving", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes, undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(SiliconPersonWorkspacePage),
          }),
        ),
      ),
    );

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

  it("shows capabilities tab with skills, MCP, and workflow bindings", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes, undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(SiliconPersonWorkspacePage),
          }),
        ),
      ),
    );

    // Wait for async resource loading to complete
    await waitFor(() => {
      expect(screen.getByText("能力")).toBeTruthy();
    });

    // Switch to capabilities tab
    const capTab = screen.getByText("能力");
    fireEvent.click(capTab);

    // Skills should be listed (loaded asynchronously)
    await waitFor(() => {
      expect(screen.getByText("数据分析")).toBeTruthy();
    });
    expect(screen.getByText("文档生成")).toBeTruthy();

    // MCP servers should be listed
    expect(screen.getByText("内部知识库")).toBeTruthy();
    expect(screen.getByText("代码搜索")).toBeTruthy();

    // Workflow binding should be visible
    expect(screen.getByTestId("silicon-person-workflow-binding-workflow-1")).toBeTruthy();
  });

  it("starts a bound workflow run from the capabilities tab", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes, undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(SiliconPersonWorkspacePage),
          }),
        ),
      ),
    );

    // Switch to capabilities tab
    fireEvent.click(screen.getByText("能力"));
    fireEvent.click(screen.getByTestId("silicon-person-workflow-start-workflow-1"));

    expect(mocks.workspace.startSiliconPersonWorkflowRun).toHaveBeenCalledWith("sp-1", "workflow-1");
  });

  it("shows tasks tab with session tasks", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1"] },
        React.createElement(
          Routes, undefined,
          React.createElement(Route, {
            path: "/employees/:id",
            element: React.createElement(SiliconPersonWorkspacePage),
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByText("任务"));

    expect(screen.getByText("拆解任务")).toBeTruthy();
    expect(screen.getByText("收集资料")).toBeTruthy();
  });
});
