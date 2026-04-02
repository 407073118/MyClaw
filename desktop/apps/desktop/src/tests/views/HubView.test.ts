import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import HubView from "@/views/HubView.vue";

const cloudSkillSummary = {
  id: "cloud-skill-security-audit",
  name: "Security Audit",
  summary: "Audit a codebase for security regressions before release.",
  description: "Cloud-hosted audit skill package with curated checks and release metadata.",
  icon: "",
  category: "dev-tools" as const,
  tags: ["security", "audit"],
  author: "myclaw",
  downloadCount: 42,
  latestVersion: "1.2.0",
  latestReleaseId: "release-skill-security-audit-1-2-0",
  updatedAt: "2026-03-24T00:00:00.000Z",
};

const cloudSkillDetail = {
  ...cloudSkillSummary,
  releases: [
    {
      id: "release-skill-security-audit-1-2-0",
      version: "1.2.0",
      releaseNotes: "Adds dependency review and CI guidance.",
    },
  ],
  readme: "",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const cloudMcpDetail = {
  id: "cloud-mcp-docs-gateway",
  type: "mcp" as const,
  name: "Docs Gateway",
  summary: "Expose internal docs over MCP for desktop sessions.",
  description: "Cloud-hosted MCP connector for docs browsing.",
  latestVersion: "0.9.1",
  releases: [
    {
      id: "release-mcp-docs-gateway-0-9-1",
      version: "0.9.1",
      releaseNotes: "Initial release.",
    },
  ],
};

const cloudEmployeePackageDetail = {
  id: "cloud-employee-package-onboarding-assistant",
  type: "employee-package" as const,
  name: "Onboarding Assistant Package",
  summary: "Install a role-ready onboarding employee with default workflow bindings.",
  description: "Cloud-hosted employee package for onboarding handoff and follow-up routines.",
  latestVersion: "1.0.0",
  releases: [
    {
      id: "release-employee-package-onboarding-assistant-1-0-0",
      version: "1.0.0",
      releaseNotes: "Initial employee package release.",
    },
  ],
};

const cloudWorkflowPackageDetail = {
  id: "cloud-workflow-package-weekly-review",
  type: "workflow-package" as const,
  name: "Weekly Review Workflow Package",
  summary: "Install a reusable weekly review workflow into local workspace.",
  description: "Cloud-hosted workflow package with checklist-oriented weekly review defaults.",
  latestVersion: "1.1.0",
  releases: [
    {
      id: "release-workflow-package-weekly-review-1-1-0",
      version: "1.1.0",
      releaseNotes: "Adds follow-up checklist steps.",
    },
  ],
};

const cloudSkillManifest = {
  kind: "skill" as const,
  name: "security-audit",
  version: "1.2.0",
  description: "Audit a codebase for security regressions before release.",
  entry: "SKILL.md",
};

const cloudMcpManifest = {
  kind: "mcp" as const,
  name: "docs-gateway",
  version: "0.9.1",
  description: "Expose internal docs over MCP for desktop sessions.",
  transport: "http" as const,
  endpoint: "http://127.0.0.1:8123/mcp",
};

const cloudEmployeePackageManifest = {
  kind: "employee-package" as const,
  name: "onboarding-assistant",
  version: "1.0.0",
  description: "Installable onboarding employee package.",
  role: "Onboarding Assistant",
  defaultWorkflowIds: ["workflow-onboarding"],
};

const cloudWorkflowPackageManifest = {
  kind: "workflow-package" as const,
  name: "weekly-review-workflow",
  version: "1.1.0",
  description: "Installable workflow package for weekly reviews.",
  entryWorkflowId: "workflow-weekly-review",
};

function setupCloudHubMocks(workspace: ReturnType<typeof useWorkspaceStore>) {
  const hubItems = [
    {
      id: cloudMcpDetail.id,
      type: cloudMcpDetail.type,
      name: cloudMcpDetail.name,
      summary: cloudMcpDetail.summary,
      latestVersion: cloudMcpDetail.latestVersion,
      iconUrl: null,
    },
    {
      id: cloudEmployeePackageDetail.id,
      type: cloudEmployeePackageDetail.type,
      name: cloudEmployeePackageDetail.name,
      summary: cloudEmployeePackageDetail.summary,
      latestVersion: cloudEmployeePackageDetail.latestVersion,
      iconUrl: null,
    },
    {
      id: cloudWorkflowPackageDetail.id,
      type: cloudWorkflowPackageDetail.type,
      name: cloudWorkflowPackageDetail.name,
      summary: cloudWorkflowPackageDetail.summary,
      latestVersion: cloudWorkflowPackageDetail.latestVersion,
      iconUrl: null,
    },
  ];

  // Skills tab uses separate API
  vi.spyOn(workspace, "loadCloudSkills").mockImplementation(async () => {
    workspace.cloudSkills = [cloudSkillSummary];
    return [cloudSkillSummary];
  });

  vi.spyOn(workspace, "loadCloudSkillDetail").mockImplementation(async (skillId) => {
    if (skillId === cloudSkillSummary.id) {
      workspace.cloudSkillDetail = cloudSkillDetail;
      return cloudSkillDetail;
    }
    workspace.cloudSkillDetail = cloudSkillDetail;
    return cloudSkillDetail;
  });

  // MCP / Employee / Workflow tabs use hub items API
  vi.spyOn(workspace, "loadCloudHubItems").mockImplementation(async (type = "all") => {
    const items = type === "all" ? hubItems : hubItems.filter((item) => item.type === type);
    workspace.cloudHubItems = items;
    return items;
  });

  vi.spyOn(workspace, "loadCloudHubDetail").mockImplementation(async (itemId) => {
    const detailById: Record<string, typeof cloudMcpDetail> = {
      [cloudMcpDetail.id]: cloudMcpDetail,
      [cloudEmployeePackageDetail.id]: cloudEmployeePackageDetail,
      [cloudWorkflowPackageDetail.id]: cloudWorkflowPackageDetail,
    };
    const detail = detailById[itemId] ?? cloudMcpDetail;
    workspace.cloudHubDetail = detail;
    return detail;
  });

  vi.spyOn(workspace, "loadCloudHubManifest").mockImplementation(async (releaseId) => {
    const manifestByReleaseId: Record<string, typeof cloudSkillManifest | typeof cloudMcpManifest | typeof cloudEmployeePackageManifest | typeof cloudWorkflowPackageManifest> = {
      [cloudSkillDetail.releases[0].id]: cloudSkillManifest,
      [cloudMcpDetail.releases[0].id]: cloudMcpManifest,
      [cloudEmployeePackageDetail.releases[0].id]: cloudEmployeePackageManifest,
      [cloudWorkflowPackageDetail.releases[0].id]: cloudWorkflowPackageManifest,
    };
    const manifest = manifestByReleaseId[releaseId] ?? cloudSkillManifest;
    workspace.cloudHubManifest = manifest;
    return manifest;
  });
}

describe("HubView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders cloud hub tabs and lets users view cloud skills", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    setupCloudHubMocks(workspace);

    const wrapper = mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("云端");
    expect(wrapper.get("[data-testid='hub-tab-skills']").text()).toContain("技能");
    expect(wrapper.get("[data-testid='hub-tab-mcp']").text()).toContain("MCP");
    expect(wrapper.get("[data-testid='hub-tab-employee-packages']").text()).toContain("员工包");
    expect(wrapper.get("[data-testid='hub-tab-workflow-packages']").text()).toContain("工作流包");

    // Skills tab is default — click on a skill card
    await wrapper.get("[data-testid='hub-item-cloud-skill-security-audit']").trigger("click");
    await flushPromises();

    expect(workspace.cloudSkillDetail?.id).toBe("cloud-skill-security-audit");
    expect(wrapper.text()).toContain("安装到本地技能目录");
  });

  it("imports a cloud skill into local skills", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    setupCloudHubMocks(workspace);

    const importCloudSkillSpy = vi.spyOn(workspace as never, "importCloudSkill").mockResolvedValue({
      skills: { items: workspace.skills },
      installedSkill: workspace.skills[0],
    });

    const wrapper = mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();

    // Open skill detail
    await wrapper.get("[data-testid='hub-item-cloud-skill-security-audit']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='hub-action-import']").trigger("click");
    await flushPromises();

    expect(importCloudSkillSpy).toHaveBeenCalledWith({
      releaseId: cloudSkillDetail.releases[0].id,
      skillName: cloudSkillDetail.name,
    });
    expect(wrapper.get("[data-testid='hub-import-feedback']").text()).toContain("已安装到本地技能目录");
  });

  it("imports a cloud mcp item into local mcp configuration", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    setupCloudHubMocks(workspace);

    const importCloudMcpSpy = vi.spyOn(workspace as never, "importCloudMcp").mockResolvedValue({
      id: "mcp-docs-gateway",
      name: "Docs Gateway",
      source: "manual",
      transport: "http",
      url: "http://127.0.0.1:8123/mcp",
      enabled: true,
      tools: [],
      health: "unknown",
    });

    const wrapper = mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();

    await wrapper.get("[data-testid='hub-tab-mcp']").trigger("click");
    await flushPromises();

    // Open MCP detail
    await wrapper.get("[data-testid='hub-item-cloud-mcp-docs-gateway']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='hub-action-import']").trigger("click");
    await flushPromises();

    expect(importCloudMcpSpy).toHaveBeenCalledWith(cloudMcpManifest);
    expect(wrapper.get("[data-testid='hub-import-feedback']").text()).toContain("已安装到本地 MCP 配置");
  });

  it("imports a cloud employee package into local employees", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    setupCloudHubMocks(workspace);

    const importCloudEmployeePackageSpy = vi.spyOn(
      workspace as never,
      "importCloudEmployeePackage",
    ).mockResolvedValue({
      employee: workspace.employees[0],
      packageRecord: {
        id: "employee-package-1",
        itemId: cloudEmployeePackageDetail.id,
        releaseId: cloudEmployeePackageDetail.releases[0].id,
        filePath: "employee-packages/package.json",
        downloadUrl: "https://example.com/employee.zip",
        installedAt: "2026-03-24T00:00:00.000Z",
        manifest: cloudEmployeePackageManifest,
      },
      items: workspace.employees,
    });

    const wrapper = mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();

    await wrapper.get("[data-testid='hub-tab-employee-packages']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='hub-item-cloud-employee-package-onboarding-assistant']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='hub-action-import']").trigger("click");
    await flushPromises();

    expect(importCloudEmployeePackageSpy).toHaveBeenCalledWith({
      itemId: cloudEmployeePackageDetail.id,
      releaseId: cloudEmployeePackageDetail.releases[0].id,
      name: cloudEmployeePackageDetail.name,
      summary: cloudEmployeePackageDetail.summary,
      manifest: cloudEmployeePackageManifest,
    });
    expect(wrapper.get("[data-testid='hub-import-feedback']").text()).toContain("已导入到本地员工列表");
  });

  it("imports a cloud workflow package into local workflows", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    setupCloudHubMocks(workspace);

    const importCloudWorkflowPackageSpy = vi.spyOn(
      workspace as never,
      "importCloudWorkflowPackage",
    ).mockResolvedValue({
      workflow: workspace.workflows[0],
      packageRecord: {
        id: "workflow-package-1",
        itemId: cloudWorkflowPackageDetail.id,
        releaseId: cloudWorkflowPackageDetail.releases[0].id,
        filePath: "workflows/package.json",
        downloadUrl: "https://example.com/workflow.zip",
        installedAt: "2026-03-24T00:00:00.000Z",
        manifest: cloudWorkflowPackageManifest,
      },
      items: workspace.workflows,
    });

    const wrapper = mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();

    await wrapper.get("[data-testid='hub-tab-workflow-packages']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='hub-item-cloud-workflow-package-weekly-review']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='hub-action-import']").trigger("click");
    await flushPromises();

    expect(importCloudWorkflowPackageSpy).toHaveBeenCalledWith({
      itemId: cloudWorkflowPackageDetail.id,
      releaseId: cloudWorkflowPackageDetail.releases[0].id,
      name: cloudWorkflowPackageDetail.name,
      summary: cloudWorkflowPackageDetail.summary,
      manifest: cloudWorkflowPackageManifest,
    });
    expect(wrapper.get("[data-testid='hub-import-feedback']").text()).toContain("已导入到本地工作流列表");
  });

  it("renders a friendly cloud error state instead of raw fetch errors", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    vi.spyOn(workspace, "loadCloudSkills").mockRejectedValue(new Error("Failed to fetch"));

    const wrapper = mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("云端Hub暂时不可用");
    expect(wrapper.text()).toContain("http://127.0.0.1:43110/api/cloud-hub/items");
    expect(wrapper.text()).not.toContain("Failed to fetch");
  });

  it("automatically retries cloud loading after a temporary failure", async () => {
    vi.useFakeTimers();

    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const loadSkillsSpy = vi
      .spyOn(workspace, "loadCloudSkills")
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockImplementation(async () => {
        workspace.cloudSkills = [cloudSkillSummary];
        return [cloudSkillSummary];
      });

    mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();
    expect(loadSkillsSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();

    expect(loadSkillsSpy).toHaveBeenCalledTimes(2);
  });

  it("retries immediately when the window regains focus", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const loadSkillsSpy = vi
      .spyOn(workspace, "loadCloudSkills")
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockImplementation(async () => {
        workspace.cloudSkills = [cloudSkillSummary];
        return [cloudSkillSummary];
      });

    mount(HubView, {
      global: {
        plugins: [pinia],
        stubs: { teleport: true },
      },
    });

    await flushPromises();
    expect(loadSkillsSpy).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    await flushPromises();

    expect(loadSkillsSpy).toHaveBeenCalledTimes(2);
  });
});
