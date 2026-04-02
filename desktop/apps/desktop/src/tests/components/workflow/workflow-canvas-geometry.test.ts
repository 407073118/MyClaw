import { describe, expect, it } from "vitest";

import {
  buildFallbackNodeLayouts,
  cleanupNodeLayouts,
  computeEdgeAnchorPoints,
  computeNextNodePosition,
  findNodeLayout,
} from "@/components/workflow/workflow-canvas-geometry";

describe("workflow canvas geometry", () => {
  it("finds node layout by node id", () => {
    const layouts = [
      { nodeId: "node-start", position: { x: 120, y: 180 } },
      { nodeId: "node-end", position: { x: 420, y: 180 } },
    ];

    expect(findNodeLayout(layouts, "node-end")).toEqual({
      nodeId: "node-end",
      position: { x: 420, y: 180 },
    });
  });

  it("builds deterministic fallback positions for legacy definitions without editor layouts", () => {
    const layouts = buildFallbackNodeLayouts(["node-start", "node-end", "node-review"]);
    expect(layouts).toEqual([
      { nodeId: "node-start", position: { x: 300, y: 60 } },
      { nodeId: "node-end", position: { x: 300, y: 220 } },
      { nodeId: "node-review", position: { x: 300, y: 380 } },
    ]);
  });

  it("auto-places a new node near the selected upstream node when possible", () => {
    const layouts = [
      { nodeId: "node-start", position: { x: 300, y: 60 } },
      { nodeId: "node-end", position: { x: 300, y: 220 } },
    ];

    expect(computeNextNodePosition({
      layouts,
      upstreamNodeId: "node-end",
      fallbackIndex: 5,
    })).toEqual({ x: 300, y: 380 });
  });

  it("computes edge anchors from node rectangles", () => {
    const anchors = computeEdgeAnchorPoints(
      { x: 120, y: 60, width: 200, height: 80 },
      { x: 120, y: 220, width: 200, height: 80 },
    );
    expect(anchors).toEqual({
      start: { x: 220, y: 140 },
      end: { x: 220, y: 220 },
    });
  });

  it("removes stale layout entries when nodes are deleted", () => {
    const layouts = [
      { nodeId: "node-start", position: { x: 120, y: 180 } },
      { nodeId: "node-end", position: { x: 400, y: 180 } },
      { nodeId: "node-orphan", position: { x: 680, y: 180 } },
    ];

    expect(cleanupNodeLayouts(layouts, new Set(["node-start", "node-end"]))).toEqual([
      { nodeId: "node-start", position: { x: 120, y: 180 } },
      { nodeId: "node-end", position: { x: 400, y: 180 } },
    ]);
  });
});
