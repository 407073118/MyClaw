import { describe, expect, it } from "vitest";
import {
  buildFallbackNodeLayouts,
  computeEdgeAnchorPoints,
  computeNextNodePosition,
} from "../src/renderer/components/workflow/workflow-canvas-geometry";

describe("workflow canvas geometry", () => {
  it("anchors edges from the bottom center to the top center of nodes", () => {
    const anchors = computeEdgeAnchorPoints(
      { x: 100, y: 200, width: 260, height: 88 },
      { x: 400, y: 520, width: 120, height: 48 },
    );

    expect(anchors.start).toEqual({ x: 230, y: 288 });
    expect(anchors.end).toEqual({ x: 460, y: 520 });
  });

  it("keeps fallback layouts deterministic and vertically stacked", () => {
    expect(buildFallbackNodeLayouts(["a", "b"])).toEqual([
      { nodeId: "a", position: { x: 300, y: 60 } },
      { nodeId: "b", position: { x: 300, y: 220 } },
    ]);
  });

  it("positions a downstream node under its upstream node when available", () => {
    const pos = computeNextNodePosition({
      layouts: [{ nodeId: "up", position: { x: 100, y: 120 } }],
      upstreamNodeId: "up",
      fallbackIndex: 1,
    });

    expect(pos).toEqual({ x: 100, y: 280 });
  });
});
