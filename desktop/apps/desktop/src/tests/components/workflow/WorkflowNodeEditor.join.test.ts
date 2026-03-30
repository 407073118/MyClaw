import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import WorkflowNodeEditor from "@/components/workflow/WorkflowNodeEditor.vue";

describe("WorkflowNodeEditor join fields", () => {
  it("shows and updates join-specific mode and timeout fields", async () => {
    const wrapper = mount(WorkflowNodeEditor, {
      props: {
        node: {
          id: "node-join",
          kind: "join",
          label: "Join",
          join: {
            mode: "all",
            upstreamNodeIds: ["node-a"],
            timeoutMs: 1200,
          },
        },
        upstreamCandidateNodeIds: ["node-a", "node-b"],
      },
    });

    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-node-editor-join-mode']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='workflow-node-editor-join-timeout-ms']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-node-editor-join-mode']").setValue("any");
    await wrapper.get("[data-testid='workflow-node-editor-join-timeout-ms']").setValue("3600");

    const events = wrapper.emitted("update:node") ?? [];
    expect(events.at(-1)?.[0]).toEqual(expect.objectContaining({
      id: "node-join",
      join: expect.objectContaining({
        mode: "any",
        timeoutMs: 3600,
        upstreamNodeIds: ["node-a"],
      }),
    }));
  });
});
