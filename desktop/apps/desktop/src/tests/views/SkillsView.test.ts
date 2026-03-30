import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import SkillsView from "@/views/SkillsView.vue";

describe("SkillsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders local skill summary metadata", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const wrapper = mount(SkillsView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.text()).toContain("代码审查");
    expect(wrapper.text()).toContain("scripts");
    expect(wrapper.text()).toContain("agents");
  });

  it("opens skill detail and shows SKILL.md content", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const loadSkillDetailSpy = vi.spyOn(workspace, "loadSkillDetail").mockResolvedValue({
      ...workspace.skills[0],
      entryPath: `${workspace.skills[0]?.path}/SKILL.md`,
      content: "# Code Review\n\nReview the current changes before shipping.",
    });

    const wrapper = mount(SkillsView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get("[data-testid='skill-card-skill-code-review']").trigger("click");
    await flushPromises();

    expect(loadSkillDetailSpy).toHaveBeenCalledWith("skill-code-review");
    expect(wrapper.get("[data-testid='skill-detail-title']").text()).toContain("代码审查");
    expect(wrapper.get("[data-testid='skill-detail-entry-path']").text()).toContain("SKILL.md");
    expect(wrapper.get("[data-testid='skill-detail-content']").text()).toContain("# Code Review");
  });

  it("renders standard skill package structure instead of legacy installer metadata", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    fixture.skills = [
      {
        id: "skill-br-interview-workspace",
        name: "br-interview-workspace",
        description: "Standard skill package",
        path: "C:/Users/test/.myClaw/skills/br-interview-workspace",
        enabled: true,
        hasScriptsDirectory: true,
        hasReferencesDirectory: false,
        hasAssetsDirectory: false,
        hasTestsDirectory: true,
        hasAgentsDirectory: true,
      },
    ];
    workspace.hydrate(fixture);

    const wrapper = mount(SkillsView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.text()).toContain("scripts");
    expect(wrapper.text()).toContain("tests");
    expect(wrapper.text()).toContain("agents");
    expect(wrapper.text()).not.toContain("仅文档");
  });
});
