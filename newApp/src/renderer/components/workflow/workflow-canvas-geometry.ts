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

const FALLBACK_START_X = 300;
const FALLBACK_START_Y = 60;
const NODE_VERTICAL_SPACING = 160;
const NODE_HORIZONTAL_OFFSET = 240;

/** 通过 nodeId 在布局数组中查找节点布局。 */
export function findNodeLayout(
  layouts: WorkflowCanvasNodeLayout[],
  nodeId: string,
): WorkflowCanvasNodeLayout | undefined {
  return layouts.find((layout) => layout.nodeId === nodeId);
}

/** 为没有 editor 布局的旧数据生成稳定且可预测的默认节点坐标（垂直流）。 */
export function buildFallbackNodeLayouts(nodeIds: string[]): WorkflowCanvasNodeLayout[] {
  return nodeIds.map((nodeId, index) => ({
    nodeId,
    position: {
      x: FALLBACK_START_X,
      y: FALLBACK_START_Y + index * NODE_VERTICAL_SPACING,
    },
  }));
}

/** 基于上游节点坐标计算新增节点位置（垂直流），缺失时使用 deterministic fallback。 */
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
        x: upstreamLayout.position.x,
        y: upstreamLayout.position.y + NODE_VERTICAL_SPACING,
      };
      // If position is occupied, shift right
      while (occupiedPositions.has(`${candidate.x}:${candidate.y}`)) {
        candidate = {
          x: candidate.x + NODE_HORIZONTAL_OFFSET,
          y: candidate.y,
        };
      }
      return candidate;
    }
  }

  let fallback = {
    x: FALLBACK_START_X,
    y: FALLBACK_START_Y + input.fallbackIndex * NODE_VERTICAL_SPACING,
  };
  while (occupiedPositions.has(`${fallback.x}:${fallback.y}`)) {
    fallback = {
      x: fallback.x + NODE_HORIZONTAL_OFFSET,
      y: fallback.y,
    };
  }
  return fallback;
}

/** 计算连线锚点，使用底部中心到顶部中心（垂直流）。 */
export function computeEdgeAnchorPoints(
  fromRect: WorkflowNodeRect,
  toRect: WorkflowNodeRect,
): {
  start: WorkflowCanvasPoint;
  end: WorkflowCanvasPoint;
} {
  return {
    start: {
      x: fromRect.x + fromRect.width / 2,
      y: fromRect.y + fromRect.height,
    },
    end: {
      x: toRect.x + toRect.width / 2,
      y: toRect.y,
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
