import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import ToolsView from "@/views/ToolsView.vue";

describe("ToolsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders a standardized page header for the tools overview", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const wrapper = mount(ToolsView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const header = wrapper.find("header.page-header");
    expect(header.exists()).toBe(true);
    expect(header.text()).toContain("工具目录");
    expect(header.text()).toContain("内置工具与 MCP 工具");
    expect(header.text()).toContain("3个内置工具");
    expect(header.text()).toContain("2个 MCP 工具");
    expect(header.text()).toContain("2个已暴露");
  });

  it("renders builtin and MCP tools in separate groups", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const wrapper = mount(ToolsView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("文件");
    expect(wrapper.text()).toContain("MCP 工具");
    expect(wrapper.text()).toContain("read_file");
    expect(wrapper.text()).toContain("归属服务：mcp-filesystem");
  });

  it("updates a builtin tool toggle through the workspace store", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const updateSpy = vi.spyOn(workspace, "updateBuiltinToolPreference").mockResolvedValue(workspace.builtinTools[0]);

    const wrapper = mount(ToolsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='tool-exposed-fs.read']").setValue(false);
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("fs.read", {
      enabled: true,
      exposedToModel: false,
      approvalModeOverride: "inherit",
    });
  });

  it("updates MCP tool visibility through the workspace store", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const updateSpy = vi.spyOn(workspace, "updateMcpToolPreference").mockResolvedValue(workspace.mcpTools[0]);

    const wrapper = mount(ToolsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='tool-enabled-mcp-filesystem:read_file']").setValue(false);
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("mcp-filesystem:read_file", {
      enabled: false,
      exposedToModel: false,
      approvalModeOverride: "inherit",
    });
  });
});
