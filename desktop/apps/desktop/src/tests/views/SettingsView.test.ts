import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as runtimeClient from "@/services/runtime-client";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import SettingsView from "@/views/SettingsView.vue";

describe("SettingsView", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());
  });

  it("renders settings with provider presets", async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.get("[data-testid='add-model-profile']").exists()).toBe(true);
    expect(wrapper.text()).toContain("OpenAI");
    expect(wrapper.text()).toContain("MiniMax");
    expect(wrapper.text()).toContain("Moonshot");
    expect(wrapper.text()).toContain("Qwen");
    expect(wrapper.text()).toContain("Anthropic");
    expect(wrapper.text()).toContain("Custom");
  });

  it("adds a provider profile through runtime client and makes it default", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const createSpy = vi.spyOn(runtimeClient, "createModelProfile").mockResolvedValue({
      profile: {
        id: "model-moonshot",
        name: "Moonshot Primary",
        provider: "openai-compatible",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-test",
        model: "moonshot-v1-8k",
      },
    });
    const defaultSpy = vi.spyOn(runtimeClient, "setDefaultModelProfile").mockResolvedValue({
      defaultModelProfileId: "model-moonshot",
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    const inputs = wrapper.findAll("input");

    await wrapper.get("select").setValue("moonshot");
    await inputs[0].setValue("Moonshot Primary");
    await inputs[1].setValue("https://api.moonshot.cn/v1");
    await inputs[2].setValue("sk-test");
    await inputs[3].setValue("moonshot-v1-8k");
    await wrapper.get("[data-testid='add-model-profile']").trigger("click");
    await flushPromises();

    expect(createSpy).toHaveBeenCalled();
    expect(defaultSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", "model-moonshot");
    expect(wrapper.text()).toContain("Moonshot Primary");
  });

  it("shows an error message when creating model profile fails", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    vi.spyOn(runtimeClient, "createModelProfile").mockRejectedValue(new Error("runtime unavailable"));

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='add-model-profile']").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-testid='add-model-error']").text()).toContain("runtime unavailable");
  });

  it("tests model profile connectivity and shows latency", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const testSpy = vi.spyOn(runtimeClient, "testModelProfile").mockResolvedValue({
      ok: true,
      latencyMs: 321,
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='test-model-profile-model-default']").trigger("click");
    await flushPromises();

    expect(testSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", "model-default");
    expect(wrapper.get("[data-testid='model-connectivity-status-model-default']").text()).toContain("321ms");
  });

  it("edits an existing model profile from the settings page", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const updateSpy = vi.spyOn(runtimeClient, "updateModelProfile").mockResolvedValue({
      profile: {
        id: "model-default",
        name: "Updated Default",
        provider: "openai-compatible",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "sk-updated",
        model: "qwen3.5-plus",
      },
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='edit-model-profile-model-default']").trigger("click");
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("Updated Default");
    await inputs[1].setValue("https://coding.dashscope.aliyuncs.com/v1");
    await inputs[2].setValue("sk-updated");
    await inputs[3].setValue("qwen3.5-plus");
    await wrapper.get("[data-testid='save-model-profile']").trigger("click");
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", "model-default", {
      name: "Updated Default",
      provider: "openai-compatible",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      apiKey: "sk-updated",
      model: "qwen3.5-plus",
      headers: {},
      requestBody: {},
    });
    expect(wrapper.get("[data-testid='model-form-mode']").text()).toContain("添加模型配置");
    expect(wrapper.find("[data-testid='save-model-profile']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='add-model-profile']").exists()).toBe(true);
  });

  it("switches from edit mode back to create mode", async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='edit-model-profile-model-default']").trigger("click");
    expect(wrapper.get("[data-testid='model-form-mode']").text()).toContain("编辑模型配置");
    expect(wrapper.get("[data-testid='create-model-profile']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='add-model-profile']").exists()).toBe(false);

    await wrapper.get("[data-testid='create-model-profile']").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-testid='model-form-mode']").text()).toContain("添加模型配置");
    expect(wrapper.get("[data-testid='add-model-profile']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='save-model-profile']").exists()).toBe(false);
  });

  it("deletes an existing model profile from the settings page", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    workspace.hydrate({
      ...fixture,
      models: [
        fixture.models[0],
        {
          id: "model-extra",
          name: "Extra Model",
          provider: "openai-compatible",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-extra",
          model: "gpt-extra",
        },
      ],
    });

    const deleteSpy = vi.spyOn(runtimeClient, "deleteModelProfile").mockResolvedValue({
      deletedProfileId: "model-extra",
      defaultModelProfileId: "model-default",
      models: fixture.models,
      sessions: fixture.sessions,
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='delete-model-profile-model-extra']").trigger("click");
    await flushPromises();

    expect(deleteSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", "model-extra");
  });

  it("shows model profile connectivity error details", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    vi.spyOn(runtimeClient, "testModelProfile").mockRejectedValue(new Error("connect timeout"));

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='test-model-profile-model-default']").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-testid='model-connectivity-status-model-default']").text()).toContain(
      "connect timeout",
    );
  });

  it("describes the approval strategy with skills auto-approved", async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    const tabs = wrapper.findAll("button.tab");
    await tabs[2].trigger("click");

    expect(wrapper.text()).toContain("Skills");
  });

  it("submits custom headers and request body when creating and editing model profiles", async () => {
    const createSpy = vi.spyOn(runtimeClient, "createModelProfile").mockResolvedValue({
      profile: {
        id: "model-custom",
        name: "Custom Gateway",
        provider: "openai-compatible",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "sk-custom",
        model: "gateway-model",
        headers: {
          "x-tool-mode": "required",
        },
        requestBody: {
          reasoning_effort: "high",
        },
      },
    });
    const updateSpy = vi.spyOn(runtimeClient, "updateModelProfile").mockResolvedValue({
      profile: {
        id: "model-default",
        name: "默认 Qwen 3.5 Plus",
        provider: "openai-compatible",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        baseUrlMode: "manual",
        apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
        model: "qwen3.5-plus",
        headers: {
          "x-tool-mode": "required",
          "x-reasoning-mode": "visible",
        },
        requestBody: {
          enable_thinking: true,
          reasoning_effort: "medium",
        },
      },
    });
    vi.spyOn(runtimeClient, "setDefaultModelProfile").mockResolvedValue({
      defaultModelProfileId: "model-custom",
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    const inputs = wrapper.findAll("input");
    await wrapper.get("select").setValue("custom");
    await inputs[0].setValue("Custom Gateway");
    await inputs[1].setValue("https://gateway.example.com/v1");
    await inputs[2].setValue("sk-custom");
    await inputs[3].setValue("gateway-model");
    await wrapper.get("[data-testid='model-headers-input']").setValue('{"x-tool-mode":"required"}');
    await wrapper.get("[data-testid='model-request-body-input']").setValue('{"reasoning_effort":"high"}');
    await wrapper.get("[data-testid='add-model-profile']").trigger("click");
    await flushPromises();

    expect(createSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", {
      name: "Custom Gateway",
      provider: "openai-compatible",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "sk-custom",
      model: "gateway-model",
      headers: {
        "x-tool-mode": "required",
      },
      requestBody: {
        reasoning_effort: "high",
      },
    });

    await wrapper.get("[data-testid='edit-model-profile-model-default']").trigger("click");
    await wrapper
      .get("[data-testid='model-headers-input']")
      .setValue('{"x-tool-mode":"required","x-reasoning-mode":"visible"}');
    await wrapper
      .get("[data-testid='model-request-body-input']")
      .setValue('{"enable_thinking":true,"reasoning_effort":"medium"}');
    await wrapper.get("[data-testid='save-model-profile']").trigger("click");
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", "model-default", {
      name: "默认 Qwen 3.5 Plus",
      provider: "openai-compatible",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
      model: "qwen3.5-plus",
      headers: {
        "x-tool-mode": "required",
        "x-reasoning-mode": "visible",
      },
      requestBody: {
        enable_thinking: true,
        reasoning_effort: "medium",
      },
    });
  });

  it("updates the approval policy from the settings page", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const updateSpy = vi.spyOn(runtimeClient, "updateApprovalPolicy").mockResolvedValue({
      approvals: {
        ...createWorkspaceFixture().approvals,
        mode: "auto-read-only",
        autoApproveReadOnly: false,
        autoApproveSkills: false,
      },
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    const tabs = wrapper.findAll("button.tab");
    await tabs[2].trigger("click");
    await wrapper.get("[data-testid='approval-mode-select']").setValue("auto-read-only");
    await wrapper.get("[data-testid='approval-readonly-toggle']").setValue(false);
    await wrapper.get("[data-testid='approval-skills-toggle']").setValue(false);
    await wrapper.get("[data-testid='approval-save']").trigger("click");
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("http://127.0.0.1:43110", {
      mode: "auto-read-only",
      autoApproveReadOnly: false,
      autoApproveSkills: false,
    });
  });

  it("shows state file location and first-time setup hint when initialization is required", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate({
      ...createWorkspaceFixture(),
      runtimeStateFilePath: "C:/Users/test/.myClaw/runtime/state.db",
      requiresInitialSetup: true,
      isFirstLaunch: true,
    });

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.get("[data-testid='runtime-state-path']").text()).toContain(
      "C:/Users/test/.myClaw/runtime/state.db",
    );
    expect(wrapper.get("[data-testid='initial-setup-hint']").exists()).toBe(true);
  });

  it("shows myClaw storage roots returned by runtime bootstrap", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.get("[data-testid='myclaw-root-path']").text()).toContain("C:/Users/test/.myClaw");
    expect(wrapper.get("[data-testid='skills-root-path']").text()).toContain("C:/Users/test/.myClaw/skills");
    expect(wrapper.get("[data-testid='sessions-root-path']").text()).toContain("C:/Users/test/.myClaw/sessions");
  });
});
