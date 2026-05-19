/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const project = {
    id: "project-default-local",
    cloudProjectId: "42",
    tenantId: "default",
    accountId: "local",
    code: "support",
    name: "客服平台",
    description: "客服项目运行能力",
    cloudVersion: 3,
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
        id: "ref-skill-summary",
        localProjectId: project.id,
        kind: "skill",
        cloudCapabilityId: "summary",
        cloudReleaseId: "release-summary",
        alias: "summary",
        displayName: "项目总结",
        description: "总结客服上下文",
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
        id: "ref-skill-disabled",
        localProjectId: project.id,
        kind: "skill",
        cloudCapabilityId: "disabled",
        cloudReleaseId: "release-disabled",
        alias: null,
        displayName: "本机停用 Skill",
        description: null,
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
        id: "ref-skill-no-hash",
        localProjectId: project.id,
        kind: "skill",
        cloudCapabilityId: "no-hash",
        cloudReleaseId: "release-no-hash",
        alias: null,
        displayName: "缺少 Hash Skill",
        description: null,
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
    ],
    prefs: [
      {
        id: "pref-summary",
        localProjectId: project.id,
        capabilityRefId: "ref-skill-summary",
        localState: "inherit",
        reason: null,
        updatedBy: null,
        updatedAt: project.updatedAt,
      },
      {
        id: "pref-disabled",
        localProjectId: project.id,
        capabilityRefId: "ref-skill-disabled",
        localState: "disabled",
        reason: null,
        updatedBy: null,
        updatedAt: project.updatedAt,
      },
      {
        id: "pref-no-hash",
        localProjectId: project.id,
        capabilityRefId: "ref-skill-no-hash",
        localState: "inherit",
        reason: null,
        updatedBy: null,
        updatedAt: project.updatedAt,
      },
    ],
    installations: [
      {
        id: "install-summary",
        sourceType: "project_skill",
        localProjectId: project.id,
        capabilityRefId: "ref-skill-summary",
        installDir: "F:/MyClaw/cache/project/summary",
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
    loadBootstrap: vi.fn().mockResolvedValue(undefined),
    ready: true,
    loading: false,
    error: "",
    requiresInitialSetup: false,
    time: { calendarEvents: [], reminders: [], availabilityPolicy: null },
    models: [{ id: "model-1", name: "Qwen" }],
    defaultModelProfileId: "model-1",
    activeSiliconPersonId: null,
    setActiveSiliconPersonId: vi.fn(),
    webPanel: { isOpen: false, viewPath: null, title: "", data: null, panelWidth: 420, tabs: [], activeTabId: null },
    projects: [project],
    projectDetails: { [project.id]: detail },
    currentProjectBinding: project,
    currentSession: { id: "session-1", title: "当前会话", messages: [] },
    skills: [{ id: "global-skill", name: "我的 Skill", description: "global", enabled: true }],
    loadProjects: vi.fn().mockResolvedValue([project]),
    loadProjectDetail: vi.fn().mockResolvedValue(detail),
    bindCloudProject: vi.fn().mockResolvedValue(detail),
    bindSessionProject: vi.fn().mockResolvedValue(undefined),
    setProjectCapabilityState: vi.fn().mockResolvedValue(detail),
    syncProjectRuntimeContext: vi.fn().mockResolvedValue(detail),
    installProjectCapability: vi.fn().mockResolvedValue(detail),
    confirmProjectMcpCapability: vi.fn().mockResolvedValue(detail),
  };
  const auth = {
    isAuthenticated: true,
    session: { user: { displayName: "测试用户", account: "tester@example.com" } },
  };
  return { auth, workspace, project };
});

vi.mock("../src/renderer/components/TitleBar", () => ({
  default: () => React.createElement("div", { "data-testid": "mock-title-bar" }),
}));

vi.mock("../src/renderer/components/WebPanel", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/components/AgentTeamDock", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/components/time/TimeAssistantCapsule", () => ({
  default: () => null,
}));

vi.mock("../src/renderer/stores/auth", () => ({
  useAuthStore: (selector?: (state: typeof mocks.auth) => unknown) =>
    (typeof selector === "function" ? selector(mocks.auth) : mocks.auth),
}));

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspace) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace),
}));

vi.mock("../src/renderer/stores/workflow-runs", () => ({
  useWorkflowRunsStore: Object.assign(
    () => ({}),
    { getState: () => ({ handleStreamEvent: vi.fn() }) },
  ),
}));

describe("project sidebar UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: { onWorkflowStream: vi.fn(() => vi.fn()) },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  /** 渲染带 Projects 子路由的 AppShell。 */
  async function renderProjectsRoute() {
    const { default: AppShell } = await import("../src/renderer/layouts/AppShell");
    const { default: ProjectsPage } = await import("../src/renderer/pages/ProjectsPage");
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="projects" element={<ProjectsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders a Projects nav item and the bound projects page", async () => {
    await renderProjectsRoute();

    expect(screen.getByTestId("nav-projects").textContent).toContain("Projects");
    expect(screen.getByTestId("projects-page")).toBeTruthy();
    expect(screen.getByTestId(`project-row-${mocks.project.id}`).textContent).toContain("客服平台");
    expect(screen.getByTestId("project-sync-status").textContent).toBe("已同步");
  });

  it("shows disabled counts and keeps project capabilities separate from global Skills", async () => {
    await renderProjectsRoute();

    expect(screen.getByTestId("project-disabled-count").textContent).toContain("停用 1");
    expect(screen.getByTestId("project-global-skills-note").textContent).toContain("不会写入我的 Skills");
    expect(screen.getByTestId("project-skill-group").textContent).toContain("项目总结");
  });

  it("disables project Skill install when artifact hash is missing", async () => {
    await renderProjectsRoute();

    const row = screen.getByTestId("project-capability-ref-skill-no-hash");
    expect(within(row).getByText("缺少 hash，无法安装")).toBeTruthy();
    expect((within(row).getByRole("button", { name: /安装/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
