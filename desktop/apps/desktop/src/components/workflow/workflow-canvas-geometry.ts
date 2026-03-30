export type WorkflowCanvasPoint = {
  x: number;
  y: number;
};

export type WorkflowCanvasNodeLayout = {
  nodeId: string;
  position: WorkflowCanvasPoint;
};

export type WorkflowCanvasViewport = {
  offsetX: number;
  offsetY: number;
};

export type WorkflowNodeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const FALLBACK_START_X = 120;
const FALLBACK_START_Y = 180;
const NODE_HORIZONTAL_SPACING = 280;

/** 通过 nodeId 在布局数组中查找节点布局。 */
export function findNodeLayout(
  layouts: WorkflowCanvasNodeLayout[],
  nodeId: string,
): WorkflowCanvasNodeLayout | undefined {
  return layouts.find((layout) => layout.nodeId === nodeId);
}

/** 为没有 editor 布局的旧数据生成稳定且可预测的默认节点坐标。 */
export function buildFallbackNodeLayouts(nodeIds: string[]): WorkflowCanvasNodeLayout[] {
  return nodeIds.map((nodeId, index) => ({
    nodeId,
    position: {
      x: FALLBACK_START_X + index * NODE_HORIZONTAL_SPACING,
      y: FALLBACK_START_Y,
    },
  }));
}

/** 基于上游节点坐标计算新增节点位置，缺失时使用 deterministic fallback。 */
export function computeNextNodePosition(input: {
  layouts: WorkflowCanvasNodeLayout[];
  upstreamNodeId?: string;
  fallbackIndex: number;
}): WorkflowCanvasPoint {
  const occupiedPositions = new Set(input.layouts.map((layout) => `${layout.position.x}:${layout.position.y}`));

  if (input.upstreamNodeId) {
    const upstreamLayout = findNodeLayout(input.layouts, input.upstreamNodeId);
    if (upstreamLayout) {
      let candidate = {
        x: upstreamLayout.position.x + NODE_HORIZONTAL_SPACING,
        y: upstreamLayout.position.y,
      };
      while (occupiedPositions.has(`${candidate.x}:${candidate.y}`)) {
        candidate = {
          x: candidate.x + NODE_HORIZONTAL_SPACING,
          y: candidate.y,
        };
      }
      return candidate;
    }
  }

  let fallback = {
    x: FALLBACK_START_X + input.fallbackIndex * NODE_HORIZONTAL_SPACING,
    y: FALLBACK_START_Y,
  };
  while (occupiedPositions.has(`${fallback.x}:${fallback.y}`)) {
    fallback = {
      x: fallback.x + NODE_HORIZONTAL_SPACING,
      y: fallback.y,
    };
  }
  return fallback;
}

/** 计算连线锚点，默认使用右侧中心到左侧中心。 */
export function computeEdgeAnchorPoints(
  fromRect: WorkflowNodeRect,
  toRect: WorkflowNodeRect,
): {
  start: WorkflowCanvasPoint;
  end: WorkflowCanvasPoint;
} {
  return {
    start: {
      x: fromRect.x + fromRect.width,
      y: fromRect.y + fromRect.height / 2,
    },
    end: {
      x: toRect.x,
      y: toRect.y + toRect.height / 2,
    },
  };
}

/** 节点删除后清理失效布局条目，并保持原有顺序。 */
export function cleanupNodeLayouts(
  layouts: WorkflowCanvasNodeLayout[],
  validNodeIds: Set<string>,
): WorkflowCanvasNodeLayout[] {
  return layouts.filter((layout) => validNodeIds.has(layout.nodeId));
}
