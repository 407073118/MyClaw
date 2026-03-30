import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import WorkflowLibraryCard from "@/components/workflow/WorkflowLibraryCard.vue";

describe("WorkflowLibraryCard", () => {
  it("renders graph stats and last edited timestamp", () => {
    const wrapper = mount(WorkflowLibraryCard, {
      props: {
        summary: {
          id: "workflow-1",
          name: "Demo Workflow",
          description: "Example description",
          status: "draft",
          source: "personal",
          updatedAt: "2026-03-22T09:35:00.000Z",
          version: 1,
          nodeCount: 3,
          edgeCount: 2,
          libraryRootId: "personal",
        },
      },
      global: {
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    expect(wrapper.find("[data-testid='workflow-library-stat-nodes-workflow-1']").text()).toContain("3");
    expect(wrapper.find("[data-testid='workflow-library-stat-edges-workflow-1']").text()).toContain("2");
    expect(wrapper.find("[data-testid='workflow-library-stat-updated-workflow-1']").text()).toContain(
      "2026-03-22T09:35:00.000Z",
    );
  });

  it("personal library can later expose root badges even if only one root is active in V1", () => {
    const wrapper = mount(WorkflowLibraryCard, {
      props: {
        summary: {
          id: "workflow-2",
          name: "Root Badge Demo",
          description: "",
          status: "draft",
          source: "personal",
          updatedAt: "2026-03-22T09:35:00.000Z",
          version: 1,
          nodeCount: 1,
          edgeCount: 0,
          libraryRootId: "personal",
        },
        rootBadges: [
          { id: "personal", label: "personal", active: true },
          { id: "team", label: "team", active: false },
        ],
      },
      global: {
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    expect(wrapper.find("[data-testid='workflow-library-root-workflow-2-personal']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-root-workflow-2-team']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-root-workflow-2-personal']").attributes("data-active")).toBe(
      "true",
    );
    expect(wrapper.find("[data-testid='workflow-library-root-workflow-2-team']").attributes("data-active")).toBe(
      "false",
    );
  });

  it("gracefully handles invalid definition summaries reported by runtime", () => {
    const wrapper = mount(WorkflowLibraryCard, {
      props: {
        summary: {
          id: "workflow-bad",
          name: "Broken Workflow",
          description: "Bad payload from runtime should not crash UI.",
          status: "draft",
          source: "personal",
          updatedAt: "not-a-date",
          version: 1,
          nodeCount: "nope",
          edgeCount: null,
          libraryRootId: "personal",
        } as never,
      },
      global: {
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    expect(wrapper.find("[data-testid='workflow-library-stat-nodes-workflow-bad']").text()).toContain("--");
    expect(wrapper.find("[data-testid='workflow-library-stat-updated-workflow-bad']").text()).toContain("Unknown");
  });

  it("trims workflow ids before building route and test ids", () => {
    const wrapper = mount(WorkflowLibraryCard, {
      props: {
        summary: {
          id: " workflow-trimmed ",
          name: " Trimmed Workflow ",
          description: " Example ",
          status: "draft",
          source: "personal",
          updatedAt: "2026-03-22T09:35:00.000Z",
          version: 1,
          nodeCount: 1,
          edgeCount: 0,
          libraryRootId: " personal ",
        },
      },
      global: {
        stubs: {
          RouterLink: {
            props: ["to"],
            template: "<a :data-to=\"to\"><slot /></a>",
          },
        },
      },
    });

    expect(wrapper.find("[data-testid='workflow-library-card-workflow-trimmed']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-root-workflow-trimmed-personal']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-open-workflow-trimmed']").attributes("data-to")).toBe(
      "/workflows/workflow-trimmed",
    );
  });
});
