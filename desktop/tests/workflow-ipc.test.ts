import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();
const saveWorkflowMock = vi.fn(() => Promise.resolve());
const saveWorkflowRunMock = vi.fn(() => Promise.resolve());

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveWorkflow: saveWorkflowMock,
  saveWorkflowRun: saveWorkflowRunMock,
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
    saveWorkflowRunMock.mockClear();
  });

  it("keeps stateSchema defined after creating and updating a workflow", async () => {
    const workflows: Array<Record<string, unknown>> = [];
    const ctx = {
      state: {
        workflowDefinitions: {} as Record<string, unknown>,
        getWorkflows: () => workflows,
      },
      runtime: {
        paths: { myClawDir: "/tmp/myclaw" },
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
        paths: { myClawDir: "/tmp/myclaw" },
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

  it("lists, starts, and resumes workflow runs using the in-memory registry", async () => {
    const workflowRuns = [
      {
        id: "run-1",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "waiting-input",
        currentNodeIds: [],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    ];
    const workflows = [
      {
        id: "workflow-1",
        name: "Visible Workflow",
        description: "workflow",
        status: "draft",
        source: "personal",
        version: 1,
        nodeCount: 0,
        edgeCount: 0,
        libraryRootId: "",
        updatedAt: "2026-04-06T00:00:00.000Z",
      },
    ];
    const ctx = {
      state: {
        workflowRuns,
        workflowDefinitions: {
          "workflow-1": {
            id: "workflow-1",
            name: "Visible Workflow",
            description: "workflow",
            status: "draft",
            source: "personal",
            version: 1,
            nodeCount: 2,
            edgeCount: 1,
            libraryRootId: "",
            updatedAt: "2026-04-06T00:00:00.000Z",
            entryNodeId: "start",
            nodes: [
              { id: "start", kind: "start", label: "Start" },
              { id: "end", kind: "end", label: "End" },
            ],
            edges: [
              { id: "edge-1", fromNodeId: "start", toNodeId: "end", kind: "normal" },
            ],
            stateSchema: [],
          },
        } as Record<string, unknown>,
        getWorkflows: () => workflows,
        getDefaultModelProfileId: () => "profile-1",
        activeWorkflowRuns: new Map(),
      },
      runtime: {
        paths: { myClawDir: "/tmp/myclaw" },
        myClawRootPath: "/tmp/myclaw",
      },
      services: {
        mcpManager: null,
      },
    } as any;

    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    registerWorkflowHandlers(ctx);

    const listRunsHandler = findHandler("workflow:list-runs");
    const startRunHandler = findHandler("workflow:start-run");
    const resumeRunHandler = findHandler("workflow:resume-run");

    const listedRuns = await listRunsHandler(null) as Array<{ id: string; workflowId: string; status: string }>;
    expect(listedRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workflowId: "workflow-1",
      }),
    ]));

    const startedPayload = await startRunHandler(null, { workflowId: "workflow-1" }) as {
      runId: string;
    };
    expect(startedPayload.runId).toBeTruthy();
    expect(ctx.state.workflowRuns).toHaveLength(2);
    expect(ctx.state.workflowRuns.at(-1)).toMatchObject({
      workflowId: "workflow-1",
      status: "running",
    });
    expect(saveWorkflowRunMock).toHaveBeenCalled();

    const resumedPayload = await resumeRunHandler(null, "run-1") as {
      run: { id: string; workflowId: string; status: string };
      items: Array<{ id: string }>;
    };
    expect(resumedPayload.run.id).toBe("run-1");
    expect(resumedPayload.run.status).toBe("running");
    expect(ctx.state.workflowRuns.find((run: { id: string }) => run.id === "run-1")?.status).toBe("running");
    expect(saveWorkflowRunMock).toHaveBeenCalledTimes(2);
  });

  it("rejects resuming a workflow run that is already terminal", async () => {
    const workflowRuns = [
      {
        id: "run-finished",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "succeeded",
        currentNodeIds: [],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:10:00.000Z",
        finishedAt: "2026-04-06T00:10:00.000Z",
      },
    ];
    const ctx = {
      state: {
        workflowRuns,
        workflowDefinitions: {} as Record<string, unknown>,
        getWorkflows: () => [],
      },
      runtime: {
        paths: { myClawDir: "/tmp/myclaw" },
      },
    } as any;

    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    registerWorkflowHandlers(ctx);

    const resumeRunHandler = findHandler("workflow:resume-run");

    await expect(resumeRunHandler(null, "run-finished")).rejects.toThrow(/cannot be resumed/i);
    expect(saveWorkflowRunMock).not.toHaveBeenCalled();
    expect(ctx.state.workflowRuns[0]?.status).toBe("succeeded");
  });

  it("resumes a workflow run that is waiting for retry scheduling", async () => {
    const workflowRuns = [
      {
        id: "run-retry",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "retry-scheduled",
        currentNodeIds: ["node-retry"],
        startedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:03:00.000Z",
      },
    ];
    const ctx = {
      state: {
        workflowRuns,
        workflowDefinitions: {} as Record<string, unknown>,
        getWorkflows: () => [],
      },
      runtime: {
        paths: { myClawDir: "/tmp/myclaw" },
      },
    } as any;

    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    registerWorkflowHandlers(ctx);

    const resumeRunHandler = findHandler("workflow:resume-run");
    const resumedPayload = await resumeRunHandler(null, "run-retry") as {
      run: { id: string; status: string };
    };

    expect(resumedPayload.run.id).toBe("run-retry");
    expect(resumedPayload.run.status).toBe("running");
    expect(ctx.state.workflowRuns[0]?.status).toBe("running");
    expect(saveWorkflowRunMock).toHaveBeenCalledTimes(1);
  });

  it("exposes persisted workflow runs through bootstrap", async () => {
    const { registerBootstrapHandlers } = await import("../src/main/ipc/bootstrap");
    const ctx = {
      state: {
        models: [],
        sessions: [],
        employees: [],
        workflowDefinitions: {},
        workflowRuns: [
          {
            id: "run-bootstrap",
            workflowId: "workflow-boot",
            workflowVersion: 1,
            status: "running",
            currentNodeIds: ["node-1"],
            startedAt: "2026-04-06T00:00:00.000Z",
            updatedAt: "2026-04-06T00:05:00.000Z",
          },
        ],
        getDefaultModelProfileId: () => null,
        getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        myClawRootPath: "/tmp/myclaw",
        skillsRootPath: "/tmp/myclaw/skills",
        sessionsRootPath: "/tmp/myclaw/sessions",
        paths: { myClawDir: "/tmp/myclaw" },
      },
      services: {
        refreshSkills: async () => [],
        listMcpServers: () => [],
        mcpManager: null,
        appUpdater: {
          getSnapshot: () => ({
            enabled: false,
            stage: "disabled",
            currentVersion: "0.1.0",
            latestVersion: null,
            progressPercent: null,
            message: "disabled",
            feedLabel: null,
            downloadPageUrl: null,
          }),
        },
      },
      tools: {
        resolveBuiltinTools: () => [],
        resolveMcpTools: () => [],
      },
    } as any;

    registerBootstrapHandlers(ctx);
    const bootstrapHandler = findHandler("app:bootstrap");
    const payload = await bootstrapHandler(null) as { workflowRuns: Array<{ id: string; status: string }> };

    expect(payload.workflowRuns).toEqual(ctx.state.workflowRuns);
  });
});
