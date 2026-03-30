import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import AppShell from "@/layouts/AppShell.vue";
import { routes } from "@/router";
import * as runtimeClient from "@/services/runtime-client";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

function createBootstrapPayload(
  overrides: Partial<runtimeClient.BootstrapPayload> = {},
): runtimeClient.BootstrapPayload {
  const fixture = createWorkspaceFixture();

  return {
    services: [],
    defaultModelProfileId: fixture.models[0]?.id ?? null,
    sessions: fixture.sessions,
    models: fixture.models,
    myClawRootPath: fixture.myClawRootPath,
    skillsRootPath: fixture.skillsRootPath,
    sessionsRootPath: fixture.sessionsRootPath,
    runtimeStateFilePath: fixture.runtimeStateFilePath,
    requiresInitialSetup: false,
    isFirstLaunch: false,
    mcp: { servers: fixture.mcpServers },
    tools: {
      builtin: fixture.builtinTools,
      mcp: fixture.mcpTools,
    },
    skills: { items: fixture.skills },
    employees: fixture.employees,
    workflows: fixture.workflows,
    workflowRuns: fixture.workflowRuns,
    approvals: fixture.approvals,
    approvalRequests: fixture.approvalRequests,
    ...overrides,
  };
}

beforeAll(() => {
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = vi.fn();
  }
});

describe("AppShell", () => {
  it("shows a startup splash before bootstrap data is ready", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const deferredBootstrap = createDeferred<runtimeClient.BootstrapPayload>();
    vi.spyOn(runtimeClient, "fetchBootstrap").mockReturnValue(deferredBootstrap.promise);

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();

    expect(wrapper.find("[data-testid='app-bootstrap-splash']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='app-sidebar']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Starting workspace");

    deferredBootstrap.resolve(createBootstrapPayload());
    await flushPromises();

    expect(wrapper.find("[data-testid='app-bootstrap-splash']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='app-sidebar']").exists()).toBe(true);
  });

  it("shows a bootstrap error state when startup data loading fails", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    vi.spyOn(runtimeClient, "fetchBootstrap").mockRejectedValue(new Error("Runtime bootstrap failed"));

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();

    expect(wrapper.find("[data-testid='app-bootstrap-splash']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='app-bootstrap-retry']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Runtime bootstrap failed");
  });

  it("renders the global sidebar alongside the chat workspace", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='app-sidebar']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='app-nav']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-chat']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-hub']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-tools']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-mcp']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-skills']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-employees']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-workflows']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-publish-drafts']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='nav-settings']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='session-list']").exists()).toBe(true);
  });

  it("redirects to settings on first launch when initial setup is required", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    vi.spyOn(runtimeClient, "fetchBootstrap").mockResolvedValue(createBootstrapPayload({
      requiresInitialSetup: true,
      isFirstLaunch: true,
    }));

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/");
    await router.isReady();

    mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/settings");
  });

  it("renders the cloud hub route inside the shell", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/hub");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='nav-hub']").classes()).toContain("active");
    expect(wrapper.text()).toContain("云端Hub");
  });

  it("renders the employees route inside the shell", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/employees");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='nav-employees']").classes()).toContain("active");
    expect(wrapper.find("[data-testid='employees-view']").exists()).toBe(true);
  });

  it("renders the workflows route inside the shell", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/workflows");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='nav-workflows']").classes()).toContain("active");
    expect(wrapper.find("[data-testid='workflows-view']").exists()).toBe(true);
  });

  it("renders the employee studio route inside the shell", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/employees/employee-onboarding-assistant");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='employee-studio-view']").exists()).toBe(true);
  });

  it("renders the workflow studio route inside the shell", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/workflows/workflow-onboarding");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='workflow-studio-view']").exists()).toBe(true);
  });

  it("renders the publish drafts route inside the shell", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/publish-drafts");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();

    expect(wrapper.find("[data-testid='nav-publish-drafts']").classes()).toContain("active");
    expect(router.currentRoute.value.path).toBe("/publish-drafts");
  });

  it("keeps the MCP nav item active on nested MCP routes", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/mcp/new");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    expect(wrapper.find("[data-testid='nav-mcp']").classes()).toContain("active");

    await router.push("/mcp/mcp-filesystem");
    await flushPromises();

    expect(wrapper.find("[data-testid='nav-mcp']").classes()).toContain("active");
  });

  it("keeps in-flight chat state when switching away from chat and back", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().hydrate(createWorkspaceFixture());

    let resolveMessage: ((value: runtimeClient.PostSessionMessagePayload) => void) | null = null;
    const pendingMessage = new Promise<runtimeClient.PostSessionMessagePayload>((resolve) => {
      resolveMessage = resolve;
    });
    vi.spyOn(runtimeClient, "postSessionMessageStream").mockImplementation(async (_baseUrl, _sessionId, content, handlers) => {
      const fixture = createWorkspaceFixture();
      handlers?.onSnapshot?.({
        session: {
          ...fixture.sessions[0],
          messages: [
            ...fixture.sessions[0].messages,
            {
              id: "msg-user-pending",
              role: "user",
              content,
              createdAt: "2026-03-26T12:00:00.000Z",
            },
          ],
        },
      });

      return pendingMessage;
    });

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    router.push("/");
    await router.isReady();

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia, router],
      },
    });

    await wrapper.get("[data-testid='composer-input']").setValue("Keep this running");
    await wrapper.get("[data-testid='composer-submit']").trigger("click");
    await flushPromises();

    expect(wrapper.find(".typing-dots").exists()).toBe(true);

    await router.push("/skills");
    await flushPromises();
    await router.push("/");
    await flushPromises();

    expect(wrapper.find(".typing-dots").exists()).toBe(true);

    resolveMessage?.({
      session: {
        ...createWorkspaceFixture().sessions[0],
        messages: [
          ...createWorkspaceFixture().sessions[0].messages,
          {
            id: "msg-user-pending",
            role: "user",
            content: "Keep this running",
            createdAt: "2026-03-26T12:00:00.000Z",
          },
          {
            id: "msg-assistant-finished",
            role: "assistant",
            content: "Still running after navigation.",
            createdAt: "2026-03-26T12:00:01.000Z",
          },
        ],
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Still running after navigation.");
  });
});
