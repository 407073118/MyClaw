import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import WorkflowCanvas from "@/components/workflow/WorkflowCanvas.vue";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    ...createWorkspaceFixture().workflowDefinitions[0]!,
    ...overrides,
  } as WorkflowDefinition;
}

function setStageRect(wrapper: ReturnType<typeof mount>) {
  const stage = wrapper.get("[data-testid='workflow-canvas-stage']").element as HTMLDivElement;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 720,
    width: 1200,
    height: 720,
    toJSON: () => ({}),
  });
}

describe("WorkflowCanvas drag interactions", () => {
  it("updates node position preview during drag and emits editor layout on drag end", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
      },
      attachTo: document.body,
    });
    setStageRect(wrapper);

    const node = wrapper.get("[data-testid='workflow-canvas-node-node-start']");
    await node.trigger("mousedown", { clientX: 140, clientY: 200, button: 0 });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 220, clientY: 260, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(node.attributes("style")).toContain("translate(200px, 240px)");

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 220, clientY: 260, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:editor")?.[0]?.[0]).toEqual({
      canvas: {
        viewport: { offsetX: 0, offsetY: 0 },
        nodes: [
          { nodeId: "node-start", position: { x: 200, y: 240 } },
          { nodeId: "node-end", position: { x: 400, y: 180 } },
        ],
      },
    });
  });

  it("updates viewport offsets when panning the canvas background", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
      },
      attachTo: document.body,
    });
    setStageRect(wrapper);

    const stage = wrapper.get("[data-testid='workflow-canvas-stage']");
    await stage.trigger("mousedown", { clientX: 640, clientY: 320, button: 0 });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 580, clientY: 280, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get("[data-testid='workflow-canvas-stage-layer']").attributes("style")).toContain(
      "translate(-60px, -40px)",
    );

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 580, clientY: 280, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:editor")?.[0]?.[0]).toEqual({
      canvas: {
        viewport: { offsetX: -60, offsetY: -40 },
        nodes: [
          { nodeId: "node-start", position: { x: 120, y: 180 } },
          { nodeId: "node-end", position: { x: 400, y: 180 } },
        ],
      },
    });
  });

  it("cancels a connection preview when released outside a valid target", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
      },
      attachTo: document.body,
    });
    setStageRect(wrapper);

    await wrapper.get("[data-testid='workflow-canvas-source-handle-node-start']").trigger("mousedown", {
      clientX: 300,
      clientY: 228,
      button: 0,
    });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 520, clientY: 260, bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-testid='workflow-canvas-preview-edge']").exists()).toBe(true);

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 520, clientY: 260, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("connect:node")).toBeUndefined();
    expect(wrapper.find("[data-testid='workflow-canvas-preview-edge']").exists()).toBe(false);
  });
});
