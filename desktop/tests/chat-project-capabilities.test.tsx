/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session = {
    id: "chat-session-1",
    title: "项目会话",
    messages: [],
  };
  const project = {
    id: "project-default-local",
    cloudProjectId: "42",
    tenantId: "default",
    accountId: "local",
    code: "support",
    name: "客服平台",
    description: "客服项目运行能力",
    cloudVersion: 1,
    etag: "etag-42",
    policyEpoch: 1,
    syncedAt: "2026-05-18T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    deletedAt: null,
    lastSyncStatus: "synced",
    lastSyncError: null,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
  };
  const detail = {
    project,
    refs: [
      {
        id: "ref-project-summary",
        localProjectId: project.id,
        kind: "skill",
        cloudCapabilityId: "summary",
        cloudReleaseId: "release-summary",
        alias: "summary",
        displayName: "项目总结",
        description: "总结项目上下文",
        defaultEnabled: true,
        manifestJson: {},
        artifactJson: {},
        artifactHash: null,
        runtimePolicyJson: null,
        cloudConfigJson: null,
        syncStatus: "synced",
        syncWarning: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      {
        id: "ref-project-mcp",
        localProjectId: project.id,
        kind: "mcp",
        cloudCapabilityId: "jira",
        cloudReleaseId: "release-jira",
        alias: "jira",
        displayName: "项目 Jira",
        description: "查询项目工单",
        defaultEnabled: true,
        manifestJson: {},
        artifactJson: null,
        artifactHash: null,
        runtimePolicyJson: { allowAutoExposeToModel: true },
        cloudConfigJson: null,
        syncStatus: "synced",
        syncWarning: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      {
        id: "ref-project-unready",
        localProjectId: project.id,
        kind: "skill",
        cloudCapabilityId: "draft-summary",
        cloudReleaseId: "release-draft",
        alias: "draft",
        displayName: "未就绪项目技能",
        description: "尚未安装",
        defaultEnabled: true,
        manifestJson: {},
        artifactJson: {},
        artifactHash: "artifact-draft",
        runtimePolicyJson: null,
        cloudConfigJson: null,
        syncStatus: "synced",
        syncWarning: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ],
    prefs: [
      {
        id: "pref-project-summary",
        localProjectId: project.id,
        capabilityRefId: "ref-project-summary",
        localState: "inherit",
        reason: null,
        updatedBy: null,
        updatedAt: project.updatedAt,
      },
      {
        id: "pref-project-mcp",
        localProjectId: project.id,
        capabilityRefId: "ref-project-mcp",
        localState: "inherit",
        reason: null,
        updatedBy: null,
        updatedAt: project.updatedAt,
        localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true },
      },
      {
        id: "pref-project-unready",
        localProjectId: project.id,
        capabilityRefId: "ref-project-unready",
        localState: "inherit",
        reason: null,
        updatedBy: null,
        updatedAt: project.updatedAt,
      },
    ],
    installations: [
      {
        id: "install-project-summary",
        sourceType: "project_skill",
        localProjectId: project.id,
        capabilityRefId: "ref-project-summary",
        installDir: "F:/MyClaw/project-cache/summary",
        manifestHash: "manifest",
        artifactHash: "artifact",
        installedReleaseId: "release-summary",
        installedAt: project.updatedAt,
        verifiedAt: project.updatedAt,
        installStatus: "ready",
        lastError: null,
      },
    ],
  };
  const workspace = {
    currentSession: session,
    sessions: [session],
    models: [],
    defaultModelProfileId: null,
    approvalRequests: [],
    skills: [{ id: "global-helper", name: "我的助手", description: "全局 Skill", enabled: true }],
    mcpTools: [{ id: "mcp__global__search", serverId: "global", name: "全局搜索", description: "全局 MCP", enabled: true, exposedToModel: true }],
    mcpServers: [],
    projects: [project],
    projectDetails: { [project.id]: detail },
    currentProjectBinding: project,
    siliconPersons: [],
    activeSiliconPersonId: null,
    agentTasks: [],
    modelSwitchNotice: null,
    myClawRootPath: "F:/MyClaw",
    workspaceRootPath: "F:/MyClaw/workspace",
    time: { scheduleJobs: [] },
    webPanel: { isOpen: false, viewPath: null, title: "", data: null, panelWidth: 420, tabs: [], activeTabId: null },
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    pushAssistantMessage: vi.fn(),
    createSession: vi.fn(),
    createWebPanelTab: vi.fn(),
    closeWebPanel: vi.fn(),
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
    loadSessionProjectBinding: vi.fn().mockResolvedValue(project),
    loadProjectDetail: vi.fn().mockResolvedValue(detail),
  };
  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) => (typeof selector === "function" ? selector(workspace) : workspace),
    { getState: () => workspace },
  );
  return {
    project,
    detail,
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

// JSDOM 不提供真实滚动测量，固定让虚拟列表渲染全部消息。
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

describe("ChatPage project capabilities", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.currentProjectBinding = mocks.project;
    mocks.workspace.projectDetails = { [mocks.project.id]: mocks.detail };
    mocks.workspace.loadSessionProjectBinding.mockClear();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  /** 渲染 ChatPage 并注入主进程事件桩。 */
  async function renderChatPage() {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        onSessionStream: vi.fn(() => vi.fn()),
        onWebPanelOpen: vi.fn(() => vi.fn()),
        onTimeReminderDelivered: vi.fn(() => vi.fn()),
      },
    });
    const { default: ChatPage } = await import("../src/renderer/pages/ChatPage");
    render(<ChatPage />);
  }

  it("shows no project when the current session is unbound", async () => {
    mocks.workspace.currentProjectBinding = null;
    mocks.workspace.projectDetails = {};

    await renderChatPage();

    expect(screen.getByTestId("chat-project-pill").textContent).toContain("无项目");
  });

  it("shows the bound project and grouped capability panel", async () => {
    await renderChatPage();

    expect(screen.getByTestId("chat-project-pill").textContent).toContain("客服平台");
    expect(screen.getByTestId("chat-capability-group-project-skills").textContent).toContain("项目总结");
    expect(screen.getByTestId("chat-capability-group-user-skills").textContent).toContain("我的助手");
    expect(screen.getByTestId("chat-capability-group-project-mcp").textContent).toContain("项目 Jira");
    expect(screen.getByTestId("chat-capability-group-global-mcp").textContent).toContain("全局搜索");
  });

  it("keeps project Skills out of global Skills-only grouping and labels slash entries", async () => {
    await renderChatPage();

    const globalGroup = screen.getByTestId("chat-capability-group-user-skills");
    expect(within(globalGroup).queryByText("项目总结")).toBeNull();

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/" } });

    const slashMenu = document.querySelector(".slash-menu") as HTMLElement;
    expect(within(slashMenu).getByText("项目技能")).toBeTruthy();
    expect(within(slashMenu).getByText("我的技能")).toBeTruthy();
    expect(within(slashMenu).queryByText("未就绪项目技能")).toBeNull();
  });

  it("exposes the project capability panel with dialog a11y state", async () => {
    await renderChatPage();

    const trigger = screen.getByTestId("chat-project-pill");
    expect(trigger.getAttribute("aria-controls")).toBe("chat-project-capability-panel");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "会话项目能力" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
