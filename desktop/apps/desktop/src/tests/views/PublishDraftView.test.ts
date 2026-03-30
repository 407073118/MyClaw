import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import PublishDraftView from "@/views/PublishDraftView.vue";

describe("PublishDraftView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("creates an employee package publish draft", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const createPublishDraftSpy = vi.spyOn(workspace as never, "createPublishDraft").mockResolvedValue({
      draft: {
        id: "publish-draft-employee-1",
        kind: "employee-package",
        sourceId: "employee-onboarding-assistant",
        filePath: "publish-drafts/employee-onboarding-assistant-1.0.0.json",
        createdAt: "2026-03-24T00:00:00.000Z",
        manifest: {
          kind: "employee-package",
          name: "onboarding-assistant",
          version: "1.0.0",
          description: "Installable onboarding employee package.",
          role: "Onboarding Assistant",
          defaultWorkflowIds: ["workflow-onboarding"],
        },
      },
    });

    const wrapper = mount(PublishDraftView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Publish Draft");
    await wrapper.get("[data-testid='publish-draft-kind']").setValue("employee-package");
    await wrapper.get("[data-testid='publish-draft-source']").setValue("employee-onboarding-assistant");
    await wrapper.get("[data-testid='publish-draft-version']").setValue("1.0.0");
    await wrapper.get("[data-testid='publish-draft-form']").trigger("submit");

    expect(createPublishDraftSpy).toHaveBeenCalledWith({
      kind: "employee-package",
      sourceId: "employee-onboarding-assistant",
      version: "1.0.0",
    });
    expect(wrapper.get("[data-testid='publish-draft-feedback']").text()).toContain("publish-draft-employee-1");
  });

  it("creates a workflow package publish draft", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const createPublishDraftSpy = vi.spyOn(workspace as never, "createPublishDraft").mockResolvedValue({
      draft: {
        id: "publish-draft-workflow-1",
        kind: "workflow-package",
        sourceId: "workflow-onboarding",
        filePath: "publish-drafts/workflow-onboarding-1.0.0.json",
        createdAt: "2026-03-24T00:00:00.000Z",
        manifest: {
          kind: "workflow-package",
          name: "onboarding-workflow",
          version: "1.0.0",
          description: "Onboarding workflow package.",
          entryWorkflowId: "workflow-onboarding",
        },
      },
    });

    const wrapper = mount(PublishDraftView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    await wrapper.get("[data-testid='publish-draft-kind']").setValue("workflow-package");
    await wrapper.get("[data-testid='publish-draft-source']").setValue("workflow-onboarding");
    await wrapper.get("[data-testid='publish-draft-version']").setValue("2.0.0");
    await wrapper.get("[data-testid='publish-draft-form']").trigger("submit");

    expect(createPublishDraftSpy).toHaveBeenCalledWith({
      kind: "workflow-package",
      sourceId: "workflow-onboarding",
      version: "2.0.0",
    });
    expect(wrapper.get("[data-testid='publish-draft-feedback']").text()).toContain("publish-draft-workflow-1");
  });
});
