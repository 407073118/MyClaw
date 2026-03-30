import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";

import ModelDetailView from "@/views/ModelDetailView.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/settings/models/new", name: "model-create", component: ModelDetailView },
      { path: "/settings/models/:id", name: "model-edit", component: ModelDetailView },
      { path: "/settings", component: { template: "<div>settings</div>" } },
    ],
  });
}

async function mountDetail(path = "/settings/models/new") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const workspace = useWorkspaceStore();
  workspace.hydrate(createWorkspaceFixture());

  const router = createTestRouter();
  router.push(path);
  await router.isReady();

  const wrapper = mount(ModelDetailView, {
    global: {
      plugins: [pinia, router],
    },
  });

  await flushPromises();
  return { wrapper, workspace, router };
}

describe("ModelDetailView", () => {
  it("uses provider-root mode for preset providers and manual mode for custom providers", async () => {
    const { wrapper } = await mountDetail();

    expect((wrapper.get("[data-testid='model-base-url-mode']").element as HTMLInputElement).value).toBe("provider-root");

    await wrapper.get("[data-testid='model-preset-select']").setValue("custom");
    await flushPromises();

    expect((wrapper.get("[data-testid='model-base-url-mode']").element as HTMLInputElement).value).toBe("manual");
  });

  it("fetches model ids from the current form and applies the selected model id", async () => {
    const { wrapper, workspace } = await mountDetail("/settings/models/new");
    const fetchSpy = vi.spyOn(workspace, "fetchAvailableModelIds").mockResolvedValue(["MiniMax-M1", "MiniMax-Text-01"]);

    await wrapper.get("[data-testid='model-preset-select']").setValue("minimax");
    await wrapper.get("[data-testid='model-api-key-input']").setValue("sk-minimax");
    await wrapper.get("[data-testid='model-fetch-list']").trigger("click");
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({
      provider: "anthropic",
      baseUrl: "https://api.minimaxi.com",
      baseUrlMode: "provider-root",
      apiKey: "sk-minimax",
    }));

    const modelSelect = wrapper.get("[data-testid='model-id-select']");
    expect(modelSelect.findAll("option")).toHaveLength(2);

    await modelSelect.setValue("MiniMax-Text-01");
    expect((wrapper.get("[data-testid='model-id-input']").element as HTMLInputElement).value).toBe("MiniMax-Text-01");
  });
});
