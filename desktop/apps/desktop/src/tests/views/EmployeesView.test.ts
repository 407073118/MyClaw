import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import EmployeesView from "@/views/EmployeesView.vue";

describe("EmployeesView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("lists employees with source, status, and summary", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const wrapper = mount(EmployeesView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find("[data-testid='employees-view']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Onboarding Assistant");
    expect(wrapper.text()).toContain("Guides local startup and follow-up tasks.");
    expect(wrapper.text()).toContain("personal");
    expect(wrapper.text()).toContain("draft");
    expect(wrapper.find("[data-testid='employee-open-employee-onboarding-assistant']").exists()).toBe(true);
  });

  it("creates a new local employee from the library page", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const createSpy = vi.spyOn(workspace as never, "createEmployee").mockResolvedValue({
      id: "employee-research-assistant",
      name: "Research Assistant",
      description: "Tracks recurring checks and summaries.",
      status: "draft",
      source: "personal",
      workflowIds: [],
      updatedAt: "2026-03-23T10:00:00.000Z",
    });

    const wrapper = mount(EmployeesView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='employee-create-name']").setValue("Research Assistant");
    await wrapper.get("[data-testid='employee-create-description']").setValue("Tracks recurring checks and summaries.");
    await wrapper.get("[data-testid='employee-create-form']").trigger("submit");

    expect(createSpy).toHaveBeenCalledWith({
      name: "Research Assistant",
      description: "Tracks recurring checks and summaries.",
    });
  });
});
