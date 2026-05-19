/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockRouterState = vi.hoisted(() => ({ search: "" }));
const mockWorkspace = vi.hoisted(() => ({
  currentSession: { id: "chat-session-1", title: "项目会话", messages: [] },
  cloudSkills: [
    {
      id: "hub-skill-1",
      name: "Avatar Fallback",
      summary: "Skill with an avatar that fails to load.",
      category: "development",
      tags: ["ui"],
      downloads: 42,
      latestReleaseId: "release-1",
      updatedAt: "2026-04-04T00:00:00.000Z",
      icon: "https://example.com/missing.png",
    },
    {
      id: "bvvv",
      name: "Missing Cloud Skill",
      summary: "A stale cloud skill summary.",
      category: "development",
      tags: [],
      downloads: 0,
      latestReleaseId: null,
      updatedAt: "2026-05-19T00:00:00.000Z",
      icon: "",
    },
  ],
  cloudSkillDetail: {
    id: "hub-skill-1",
    name: "Avatar Fallback",
    description: "Skill with an avatar that fails to load.",
    author: "anonymous",
    category: "development",
    latestVersion: "1.0.0",
    downloadCount: 42,
    releases: [],
    icon: "https://example.com/missing.png",
  },
  cloudProjects: [
    {
      id: 42,
      code: "support",
      name: "客服平台",
      description: "客服项目运行能力",
      ownerAccount: "tester",
      status: "active",
      repositoryCount: 2,
      apiCount: 3,
      skillCount: 1,
      mcpCount: 1,
      version: 3,
      updatedAt: "2026-05-18T00:00:00.000Z",
    },
    {
      id: 77,
      code: "billing",
      name: "计费平台",
      description: "计费项目运行能力",
      ownerAccount: "tester",
      status: "active",
      repositoryCount: 1,
      apiCount: 1,
      skillCount: 0,
      mcpCount: 0,
      version: 1,
      updatedAt: "2026-05-17T00:00:00.000Z",
    },
  ],
  projects: [
    {
      id: "project-default-local",
      cloudProjectId: "42",
      tenantId: "default",
      accountId: "local",
      code: "support",
      name: "客服平台",
      description: "客服项目运行能力",
      cloudVersion: 2,
      etag: "etag-2",
      policyEpoch: 1,
      syncedAt: "2026-05-17T00:00:00.000Z",
      expiresAt: null,
      revokedAt: null,
      deletedAt: null,
      lastSyncStatus: "synced",
      lastSyncError: null,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    },
  ],
  cloudHubItems: [],
  cloudHubDetail: null as unknown,
  cloudHubManifest: null as unknown,
  loadCloudSkills: vi.fn().mockResolvedValue([]),
  loadCloudHubItems: vi.fn().mockResolvedValue([]),
  loadCloudProjects: vi.fn().mockResolvedValue([]),
  loadProjects: vi.fn().mockResolvedValue([]),
  loadCloudSkillDetail: vi.fn().mockImplementation(async () => mockWorkspace.cloudSkillDetail),
  loadCloudHubDetail: vi.fn().mockResolvedValue({ releases: [] }),
  loadCloudHubManifest: vi.fn().mockResolvedValue(null),
  bindCloudProject: vi.fn().mockResolvedValue({
    project: {
      id: "project-billing-local",
      cloudProjectId: "77",
      cloudVersion: 1,
      lastSyncStatus: "synced",
    },
    refs: [],
    prefs: [],
    installations: [],
  }),
  syncProjectRuntimeContext: vi.fn().mockResolvedValue({
    project: {
      id: "project-default-local",
      cloudProjectId: "42",
      cloudVersion: 3,
      lastSyncStatus: "synced",
    },
    refs: [],
    prefs: [],
    installations: [],
  }),
  bindSessionProject: vi.fn().mockResolvedValue(undefined),
  clearCloudSkillDetail: vi.fn(),
  clearCloudHubDetail: vi.fn(),
  importCloudSkill: vi.fn(),
  importCloudMcp: vi.fn(),
  importCloudSiliconPersonPackage: vi.fn(),
  importCloudWorkflowPackage: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/hub", search: mockRouterState.search, hash: "", state: null, key: "test" }),
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: unknown) =>
    typeof selector === "function" ? selector(mockWorkspace) : mockWorkspace,
}));

vi.mock("../src/renderer/stores/shell", () => ({
  useShellStore: (selector?: unknown) =>
    typeof selector === "function"
      ? selector({ runtimeBaseUrl: "http://localhost:3000" })
      : { runtimeBaseUrl: "http://localhost:3000" },
}));

import HubPage from "../src/renderer/pages/HubPage";

afterEach(() => {
  cleanup();
  mockNavigate.mockReset();
  mockRouterState.search = "";
  (mockWorkspace as any).cloudHubItems = [];
  (mockWorkspace as any).cloudHubDetail = null;
  (mockWorkspace as any).cloudHubManifest = null;
  (mockWorkspace as any).cloudSkillDetail = {
    id: "hub-skill-1",
    name: "Avatar Fallback",
    description: "Skill with an avatar that fails to load.",
    author: "anonymous",
    category: "development",
    latestVersion: "1.0.0",
    downloadCount: 42,
    releases: [],
    icon: "https://example.com/missing.png",
  };
  mockWorkspace.loadCloudProjects.mockClear();
  mockWorkspace.loadProjects.mockClear();
  mockWorkspace.bindCloudProject.mockClear();
  mockWorkspace.syncProjectRuntimeContext.mockClear();
  mockWorkspace.bindSessionProject.mockClear();
  mockWorkspace.importCloudMcp.mockClear();
});

describe("HubPage", () => {
  it("uses the shared page-shell layout instead of the legacy page-container", async () => {
    const { container } = render(React.createElement(HubPage));
    await screen.findByTestId("hub-item-hub-skill-1");

    const view = container.firstElementChild as HTMLElement;
    const styleText = Array.from(container.querySelectorAll("style"))
      .map((styleNode) => styleNode.textContent ?? "")
      .join("\n");

    expect(view.className).toContain("page-shell");
    expect(view.className).not.toContain("page-container");
    expect(container.querySelector(".page-header--sticky")).not.toBeNull();
    expect(container.querySelector(".page-content")).not.toBeNull();
    expect(styleText).not.toContain(".page-container");
  });

  it("keeps the silicon person scope when importing an MCP from the Hub query entry", async () => {
    mockRouterState.search = "?tab=mcp&siliconPersonId=sp-1";
    const manifest = { kind: "mcp", name: "Scoped MCP", config: { id: "scoped-mcp", transport: "stdio", command: "node" } };
    (mockWorkspace as any).cloudHubItems = [
      { id: "hub-mcp-1", type: "mcp", name: "Scoped MCP", summary: "Employee scoped MCP", latestVersion: "1.0.0" },
    ];
    (mockWorkspace as any).cloudHubDetail = {
      id: "hub-mcp-1",
      type: "mcp",
      name: "Scoped MCP",
      description: "Employee scoped MCP",
      latestVersion: "1.0.0",
      releases: [{ id: "release-mcp-1", version: "1.0.0", releaseNotes: "" }],
    };
    (mockWorkspace as any).cloudHubManifest = manifest;

    render(React.createElement(HubPage));

    expect(await screen.findByTestId("hub-item-hub-mcp-1")).toBeTruthy();
    expect(screen.getByTestId("hub-tab-mcp").className).toContain("active");

    fireEvent.click(screen.getByTestId("hub-item-hub-mcp-1"));
    fireEvent.click(await screen.findByTestId("hub-action-import"));

    await waitFor(() => {
      expect(mockWorkspace.importCloudMcp).toHaveBeenCalledWith({
        manifest,
        siliconPersonId: "sp-1",
      });
    });
    expect(screen.getByTestId("hub-import-feedback").textContent).toContain("员工 MCP");
  });

  it("replaces a broken avatar image with a React-rendered fallback", async () => {
    render(React.createElement(HubPage));

    const card = await screen.findByTestId("hub-item-hub-skill-1");
    const avatarImg = within(card).getByAltText("Avatar Fallback");

    fireEvent.error(avatarImg);

    await waitFor(() => {
      expect(within(card).queryByAltText("Avatar Fallback")).toBeNull();
      expect(within(card).getByText("A")).toBeTruthy();
    });
  });

  it("supports escape close and focus restore for the hub detail dialog", async () => {
    render(React.createElement(HubPage));

    const card = await screen.findByTestId("hub-item-hub-skill-1");
    card.focus();
    fireEvent.click(card);

    const dialog = await screen.findByRole("dialog", { name: "云端资源详情" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "云端资源详情" })).toBeNull());
    expect(document.activeElement).toBe(card);
  });

  it("shows a detail error when a stale cloud skill no longer exists", async () => {
    (mockWorkspace as any).cloudSkillDetail = null;
    mockWorkspace.loadCloudSkillDetail.mockRejectedValueOnce(new Error("云端 Skill 不存在或已下架：bvvv"));
    render(React.createElement(HubPage));

    fireEvent.click(await screen.findByTestId("hub-item-bvvv"));

    const dialog = await screen.findByRole("dialog", { name: "云端资源详情" });
    await waitFor(() => {
      expect(within(dialog).getByText("云端 Skill 不存在或已下架：bvvv")).toBeTruthy();
    });
    expect(within(dialog).queryByText("加载详情中...")).toBeNull();
  });

  it("lists Cloud projects and updates a stale local binding before binding it to the current session", async () => {
    render(React.createElement(HubPage));

    fireEvent.click(screen.getByTestId("hub-tab-projects"));

    const projectCard = await screen.findByTestId("hub-project-42");
    expect(mockWorkspace.loadCloudProjects).toHaveBeenCalledTimes(1);
    expect(projectCard.textContent).toContain("客服平台");
    expect(projectCard.textContent).toContain("云端 v3");
    expect(projectCard.textContent).toContain("本地 v2");
    expect(projectCard.textContent).toContain("可更新");

    fireEvent.click(projectCard);
    const action = await screen.findByTestId("hub-project-action");
    expect(action.textContent).toContain("更新并绑定当前会话");
    fireEvent.click(action);

    await waitFor(() => {
      expect(mockWorkspace.syncProjectRuntimeContext).toHaveBeenCalledWith("project-default-local");
      expect(mockWorkspace.bindSessionProject).toHaveBeenCalledWith("chat-session-1", "project-default-local");
    });
  });

  it("downloads an unbound Cloud project into local project data and binds it to the current session", async () => {
    render(React.createElement(HubPage));

    fireEvent.click(screen.getByTestId("hub-tab-projects"));
    fireEvent.click(await screen.findByTestId("hub-project-77"));
    fireEvent.click(await screen.findByTestId("hub-project-action"));

    await waitFor(() => {
      expect(mockWorkspace.bindCloudProject).toHaveBeenCalledWith({
        cloudProjectId: "77",
        sessionId: "chat-session-1",
      });
    });
  });
});
