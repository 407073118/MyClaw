import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();
const saveWorkflowMock = vi.fn(() => Promise.resolve());

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveWorkflow: saveWorkflowMock,
}));

/** 获取指定 channel 对应的 IPC 处理函数，便于直接调用并断言返回结果。 */
function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`未注册 IPC handler: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("workflow IPC handlers", () => {
  beforeEach(() => {
    handleMock.mockClear();
    saveWorkflowMock.mockClear();
  });

  it("keeps stateSchema defined after creating and updating a workflow", async () => {
    const workflows: Array<Record<string, unknown>> = [];
    const ctx = {
      state: {
        workflowDefinitions: {} as Record<string, unknown>,
        getWorkflows: () => workflows,
      },
      runtime: {
        paths: {},
      },
    } as any;

    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    registerWorkflowHandlers(ctx);

    const createHandler = findHandler("workflow:create");
    const updateHandler = findHandler("workflow:update");
    const getHandler = findHandler("workflow:get");

    const createdPayload = await createHandler(null, {
      name: "新建工作流",
      description: "用于复现 starter graph 初始化。",
    }) as { workflow: { id: string } };

    await updateHandler(null, createdPayload.workflow.id, {
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        {
          id: "edge-start-end",
          fromNodeId: "node-start",
          toNodeId: "node-end",
          kind: "normal",
        },
      ],
    });

    const definition = await getHandler(null, createdPayload.workflow.id) as {
      stateSchema?: unknown[];
      nodes: unknown[];
      edges: unknown[];
    };

    expect(definition.nodes).toHaveLength(2);
    expect(definition.edges).toHaveLength(1);
    expect(definition.stateSchema).toEqual([]);
  });

  it("returns an empty stateSchema when only summary data exists", async () => {
    const workflows = [
      {
        id: "summary-only",
        name: "Summary Only",
        description: "仅存在摘要数据的工作流",
        status: "draft",
        source: "personal",
        version: 1,
        nodeCount: 0,
        edgeCount: 0,
        libraryRootId: "",
        updatedAt: new Date().toISOString(),
      },
    ];
    const ctx = {
      state: {
        workflowDefinitions: {} as Record<string, unknown>,
        getWorkflows: () => workflows,
      },
      runtime: {
        paths: {},
      },
    } as any;

    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    registerWorkflowHandlers(ctx);

    const getHandler = findHandler("workflow:get");
    const definition = await getHandler(null, "summary-only") as {
      stateSchema?: unknown[];
      nodes: unknown[];
      edges: unknown[];
    };

    expect(definition.nodes).toEqual([]);
    expect(definition.edges).toEqual([]);
    expect(definition.stateSchema).toEqual([]);
  });
});
