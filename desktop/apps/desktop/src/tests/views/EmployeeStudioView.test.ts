import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import EmployeeStudioView from "@/views/EmployeeStudioView.vue";

describe("EmployeeStudioView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("edits role fields and workflow bindings for an employee", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateEmployee").mockResolvedValue({
      ...workspace.employees[0],
      name: "Onboarding Lead",
      description: "Runs onboarding with weekly follow-up.",
      status: "active",
      workflowIds: ["workflow-onboarding"],
    });

    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/employees/:id", component: EmployeeStudioView }],
    });
    router.push("/employees/employee-onboarding-assistant");
    await router.isReady();

    const wrapper = mount(EmployeeStudioView, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Employee Studio");
    expect(wrapper.text()).toContain("SOP summary");
    expect(wrapper.text()).toContain("Memory summary");
    expect(wrapper.text()).toContain("Pending work summary");

    await wrapper.get("[data-testid='employee-studio-name']").setValue("Onboarding Lead");
    await wrapper
      .get("[data-testid='employee-studio-description']")
      .setValue("Runs onboarding with weekly follow-up.");
    await wrapper.get("[data-testid='employee-studio-status']").setValue("active");
    await wrapper.get("[data-testid='employee-studio-workflow-select']").setValue("workflow-onboarding");
    await wrapper.get("[data-testid='employee-studio-bind-workflow']").trigger("click");
    await wrapper.get("[data-testid='employee-studio-save']").trigger("submit");

    expect(updateSpy).toHaveBeenCalledWith("employee-onboarding-assistant", {
      name: "Onboarding Lead",
      description: "Runs onboarding with weekly follow-up.",
      status: "active",
      source: "personal",
      workflowIds: ["workflow-onboarding"],
    });
  });
});
