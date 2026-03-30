import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";

import McpView from "@/views/McpView.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/mcp", component: McpView },
      { path: "/mcp/new", component: { template: "<div>new</div>" } },
      { path: "/mcp/:id", component: { template: "<div>detail</div>" } },
    ],
  });
}

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const workspace = useWorkspaceStore();
  workspace.hydrate(createWorkspaceFixture());

  const router = createTestRouter();
  router.push("/mcp");
  await router.isReady();

  const wrapper = mount(McpView, {
    global: {
      plugins: [pinia, router],
    },
  });

  await flushPromises();
  return { wrapper, workspace, router };
}

describe("McpView", () => {
  it("renders the MCP library and routes the new button to create view", async () => {
    const { wrapper } = await mountView();

    expect(wrapper.find("[data-testid='mcp-view']").exists()).toBe(true);
    expect(wrapper.text()).toContain("MCP 服务库");
    expect(wrapper.get("[data-testid='mcp-new-button']").attributes("href")).toBe("/mcp/new");
    expect(wrapper.find("[data-testid='mcp-import-claude']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='mcp-import-codex']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='mcp-import-cursor']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='mcp-library-card-mcp-filesystem']").exists()).toBe(true);
  });

  it("shows the empty state when there are no MCP servers", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    workspace.hydrate({
      ...fixture,
      mcpServers: [],
    });

    const loadSpy = vi.spyOn(workspace, "loadMcpServers").mockResolvedValue([]);
    const router = createTestRouter();
    router.push("/mcp");
    await router.isReady();

    const wrapper = mount(McpView, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.get("[data-testid='mcp-empty-state']").text()).toContain("当前还没有 MCP 服务");
  });

  it("refreshes a server from the library card action", async () => {
    const { wrapper, workspace } = await mountView();
    const refreshSpy = vi.spyOn(workspace, "refreshMcpServer").mockResolvedValue(workspace.mcpServers[0]!);

    await wrapper.get("[data-testid='mcp-library-refresh-mcp-filesystem']").trigger("click");

    expect(refreshSpy).toHaveBeenCalledWith("mcp-filesystem");
  });

  it("toggles a server enabled state from the library card action", async () => {
    const { wrapper, workspace } = await mountView();
    const server = workspace.mcpServers[0]!;
    const updateSpy = vi.spyOn(workspace, "updateMcpServer").mockResolvedValue(server);

    await wrapper.get("[data-testid='mcp-library-toggle-mcp-filesystem']").trigger("click");

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
});
