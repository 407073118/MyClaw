import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";

import McpDetailView from "@/views/McpDetailView.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/mcp/new", component: McpDetailView },
      { path: "/mcp/:id", component: McpDetailView },
      { path: "/mcp", component: { template: "<div>library</div>" } },
    ],
  });
}

async function mountDetail(path = "/mcp/mcp-filesystem") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const workspace = useWorkspaceStore();
  workspace.hydrate(createWorkspaceFixture());

  const router = createTestRouter();
  router.push(path);
  await router.isReady();

  const wrapper = mount(McpDetailView, {
    global: {
      plugins: [pinia, router],
    },
  });

  await flushPromises();
  return { wrapper, workspace, router };
}

describe("McpDetailView", () => {
  it("renders an existing server in read-only detail mode", async () => {
    const { wrapper } = await mountDetail();

    expect(wrapper.find("[data-testid='mcp-detail-view']").exists()).toBe(true);
    expect(wrapper.text()).toContain("MCP 服务详情");
    expect(wrapper.text()).toContain("文件系统 MCP");
    expect(wrapper.text()).toContain("概览");
    expect(wrapper.text()).toContain("连接配置");
    expect(wrapper.text()).toContain("工具列表");
    expect(wrapper.text()).toContain("运行状态");
    expect(wrapper.find("[data-testid='mcp-server-form']").exists()).toBe(false);
  });

  it("shows missing state for an unknown MCP server id", async () => {
    const { wrapper } = await mountDetail("/mcp/not-found");

    expect(wrapper.text()).toContain("未找到 MCP 服务");
    expect(wrapper.text()).toContain("请返回列表检查所选服务 ID 是否正确。");
  });

  it("shows empty tools and recent runtime error when the server has no tools", async () => {
    const { wrapper } = await mountDetail("/mcp/mcp-broken-http");

    expect(wrapper.text()).toContain("暂未发现工具");
    expect(wrapper.text()).toContain("connection refused");
  });

  it("refreshes and toggles the current server", async () => {
    const { wrapper, workspace } = await mountDetail();
    const refreshSpy = vi.spyOn(workspace, "refreshMcpServer").mockResolvedValue(workspace.mcpServers[0]!);
    const updateSpy = vi.spyOn(workspace, "updateMcpServer").mockResolvedValue(workspace.mcpServers[0]!);

    await wrapper.get("[data-testid='mcp-detail-refresh']").trigger("click");
    await wrapper.get("[data-testid='mcp-detail-toggle']").trigger("click");

    expect(refreshSpy).toHaveBeenCalledWith("mcp-filesystem");
    expect(updateSpy).toHaveBeenCalledWith("mcp-filesystem", {
      id: "mcp-filesystem",
      name: "文件系统 MCP",
      source: "manual",
      enabled: false,
      transport: "stdio",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "."],
    });
  });

  it("switches to edit mode and saves updates", async () => {
    const { wrapper, workspace } = await mountDetail();
    const updateSpy = vi.spyOn(workspace, "updateMcpServer").mockImplementation(async (_serverId, input) => ({
      ...workspace.mcpServers[0]!,
      ...input,
    }));

    await wrapper.get("[data-testid='mcp-detail-edit']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='mcp-form-name']").setValue("文档网关");
    await wrapper.get("[data-testid='mcp-form-submit']").trigger("submit");
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("mcp-filesystem", expect.objectContaining({
      id: "mcp-filesystem",
      name: "文档网关",
    }));
  });

  it("creates a new server on the /mcp/new route", async () => {
    const { wrapper, workspace, router } = await mountDetail("/mcp/new");
    const createSpy = vi.spyOn(workspace, "createMcpServer").mockImplementation(async (input) => ({
      ...input,
      health: "unknown",
      tools: [],
      recentError: null,
      lastCheckedAt: null,
      state: {
        serverId: input.id,
        health: "unknown",
        connected: false,
        toolCount: 0,
        lastCheckedAt: null,
        recentError: null,
      },
    }));

    await wrapper.get("[data-testid='mcp-form-id']").setValue("mcp-docs");
    await wrapper.get("[data-testid='mcp-form-name']").setValue("文档网关");
    await wrapper.get("[data-testid='mcp-form-transport']").setValue("http");
    await wrapper.get("[data-testid='mcp-form-url']").setValue("http://127.0.0.1:8123/mcp");
    await wrapper.get("[data-testid='mcp-form-submit']").trigger("submit");
    await flushPromises();

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: "mcp-docs",
      name: "文档网关",
      transport: "http",
      url: "http://127.0.0.1:8123/mcp",
      source: "manual",
      enabled: true,
    }));
    expect(router.currentRoute.value.path).toBe("/mcp/mcp-docs");
  });
});
