import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  handleMock,
  createExecutionGatewayMock,
  workflowGatewayExecuteMock,
  saveWorkflowMock,
  saveWorkflowRunMock,
  updateTurnOutcomeMock,
  loadTurnOutcomeMock,
} = vi.hoisted(() => {
  const handleMock = vi.fn();
  const workflowGatewayExecuteMock = vi.fn(async () => ({ content: "workflow-reply", toolCalls: [], finishReason: "stop", usage: null, retryCount: 0, fallbackEvents: [], requestVariantId: "primary", fallbackReason: null }));
  const createExecutionGatewayMock = vi.fn(() => {
    return {
      executeTurn: workflowGatewayExecuteMock,
    };
  });
  const saveWorkflowMock = vi.fn(() => Promise.resolve());
  const saveWorkflowRunMock = vi.fn(() => Promise.resolve());
  const updateTurnOutcomeMock = vi.fn(() => Promise.resolve());
  const loadTurnOutcomeMock = vi.fn();

  return {
    handleMock,
    createExecutionGatewayMock,
    workflowGatewayExecuteMock,
    saveWorkflowMock,
    saveWorkflowRunMock,
    updateTurnOutcomeMock,
    loadTurnOutcomeMock,
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock("../../../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: createExecutionGatewayMock,
}));

vi.mock("../../../src/main/services/state-persistence", () => ({
  saveWorkflow: saveWorkflowMock,
  saveWorkflowRun: saveWorkflowRunMock,
}));

vi.mock("../../../src/main/services/model-runtime/turn-outcome-store", () => ({
  updateTurnOutcome: updateTurnOutcomeMock,
  loadTurnOutcome: loadTurnOutcomeMock,
}));

import { registerWorkflowHandlers } from "../../../src/main/ipc/workflows";
import { makeProfile } from "../contracts/test-helpers";

function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`handler not found: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("workflows execution gateway", () => {
  beforeEach(() => {
    handleMock.mockClear();
    createExecutionGatewayMock.mockClear();
    workflowGatewayExecuteMock.mockReset();
    workflowGatewayExecuteMock.mockResolvedValue({
      content: "workflow-reply",
      toolCalls: [],
      finishReason: "stop",
      usage: null,
      retryCount: 0,
      fallbackEvents: [],
      requestVariantId: "primary",
      fallbackReason: null,
    });
    saveWorkflowMock.mockClear();
    saveWorkflowRunMock.mockClear();
    updateTurnOutcomeMock.mockClear();
    loadTurnOutcomeMock.mockClear();
  });

  it("builds workflow model callers on the shared execution gateway", async () => {
    const workflow = {
      id: "wf-1",
      name: "Workflow",
      description: "test",
      status: "draft",
      source: "personal",
      version: 1,
      nodeCount: 2,
      edgeCount: 1,
      libraryRootId: "",
      updatedAt: "2026-04-10T00:00:00.000Z",
    };
    const ctx: any = {
      runtime: { paths: { myClawDir: "/tmp" }, myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions" },
      state: {
        models: [makeProfile()],
        sessions: [],
        siliconPersons: [],
        skills: [],
        workflowDefinitions: {
          "wf-1": {
            ...workflow,
            entryNodeId: "start",
            nodes: [{ id: "start", kind: "start", label: "Start" }, { id: "end", kind: "end", label: "End" }],
            edges: [{ id: "edge-1", fromNodeId: "start", toNodeId: "end", kind: "normal" }],
            stateSchema: [],
          },
        },
        workflowRuns: [],
        activeWorkflowRuns: new Map(),
        activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1",
        setDefaultModelProfileId: () => {},
        getWorkflows: () => [workflow],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
        setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerWorkflowHandlers(ctx);
    const startRunHandler = findHandler("workflow:start-run");
    await startRunHandler(null, { workflowId: "wf-1" });

    expect(createExecutionGatewayMock).toHaveBeenCalled();
  });

  it("passes workflow llm experience overrides into the shared execution gateway plan", async () => {
    const workflow = {
      id: "wf-2",
      name: "Workflow With Overrides",
      description: "test",
      status: "draft",
      source: "personal",
      version: 1,
      nodeCount: 3,
      edgeCount: 2,
      libraryRootId: "",
      updatedAt: "2026-04-10T00:00:00.000Z",
    };
    const ctx: any = {
      runtime: { paths: { myClawDir: "/tmp" }, myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions" },
      state: {
        models: [makeProfile()],
        sessions: [],
        siliconPersons: [],
        skills: [],
        workflowDefinitions: {
          "wf-2": {
            ...workflow,
            entryNodeId: "start",
            nodes: [
              { id: "start", kind: "start", label: "Start" },
              {
                id: "llm-1",
                kind: "llm",
                label: "Think",
                llm: {
                  prompt: "hello",
                  providerFamily: "anthropic-native",
                  protocolTarget: "anthropic-messages",
                  experienceProfileId: "claude-best",
                },
              },
              { id: "end", kind: "end", label: "End" },
            ],
            edges: [
              { id: "edge-1", fromNodeId: "start", toNodeId: "llm-1", kind: "normal" },
              { id: "edge-2", fromNodeId: "llm-1", toNodeId: "end", kind: "normal" },
            ],
            stateSchema: [],
          },
        },
        workflowRuns: [],
        activeWorkflowRuns: new Map(),
        activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1",
        setDefaultModelProfileId: () => {},
        getWorkflows: () => [workflow],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
        setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerWorkflowHandlers(ctx);
    const startRunHandler = findHandler("workflow:start-run");
    await startRunHandler(null, { workflowId: "wf-2" });

    expect(createExecutionGatewayMock).toHaveBeenCalled();
  });

  it("persists lastTurnOutcomeId after the workflow reaches a terminal summary", async () => {
    let resolveTurn: ((value: {
      content: string;
      outcome: { id: string };
      toolCalls: never[];
      finishReason: string;
      usage: null;
      retryCount: number;
      fallbackEvents: never[];
      requestVariantId: string;
      fallbackReason: null;
    }) => void) | null = null;
    createExecutionGatewayMock.mockImplementationOnce(() => {
      return {
        executeTurn: vi.fn(() => new Promise((resolve) => {
          resolveTurn = resolve;
        })),
      };
    });

    const workflow = {
      id: "wf-3",
      name: "Workflow With Outcome",
      description: "test",
      status: "draft",
      source: "personal",
      version: 1,
      nodeCount: 3,
      edgeCount: 2,
      libraryRootId: "",
      updatedAt: "2026-04-10T00:00:00.000Z",
    };
    const ctx: any = {
      runtime: { paths: { myClawDir: "/tmp" }, myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions" },
      state: {
        models: [makeProfile()],
        sessions: [],
        siliconPersons: [],
        skills: [],
        workflowDefinitions: {
          "wf-3": {
            ...workflow,
            entryNodeId: "start",
            nodes: [
              { id: "start", kind: "start", label: "Start" },
              {
                id: "llm-1",
                kind: "llm",
                label: "Think",
                llm: {
                  prompt: "hello",
                  outputKey: "reply",
                },
              },
              { id: "end", kind: "end", label: "End" },
            ],
            edges: [
              { id: "edge-1", fromNodeId: "start", toNodeId: "llm-1", kind: "normal" },
              { id: "edge-2", fromNodeId: "llm-1", toNodeId: "end", kind: "normal" },
            ],
            stateSchema: [],
          },
        },
        workflowRuns: [],
        activeWorkflowRuns: new Map(),
        activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1",
        setDefaultModelProfileId: () => {},
        getWorkflows: () => [workflow],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
        setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerWorkflowHandlers(ctx);
    const startRunHandler = findHandler("workflow:start-run");
    const started = await startRunHandler(null, { workflowId: "wf-3" }) as { runId: string };

    await vi.waitFor(() => {
      expect(resolveTurn).not.toBeNull();
    });
    const existingIndex = ctx.state.workflowRuns.findIndex((item: { id: string }) => item.id === started.runId);
    ctx.state.workflowRuns[existingIndex] = {
      ...ctx.state.workflowRuns[existingIndex],
      currentNodeIds: ["llm-1"],
    };
    resolveTurn!({
      content: "workflow-reply",
      outcome: {
        id: "outcome-42",
        contextStability: true,
        toolCallCount: 0,
        toolSuccessCount: 0,
      },
      toolCalls: [],
      finishReason: "stop",
      usage: null,
      retryCount: 0,
      fallbackEvents: [],
      requestVariantId: "primary",
      fallbackReason: null,
    });

    await vi.waitFor(() => {
      const run = ctx.state.workflowRuns.find((item: { id: string }) => item.id === started.runId);
      expect(run).toMatchObject({
        id: started.runId,
        status: "succeeded",
        lastTurnOutcomeId: "outcome-42",
      });
    });

    expect(saveWorkflowRunMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: started.runId,
        status: "succeeded",
        lastTurnOutcomeId: "outcome-42",
      }),
    );
    expect(updateTurnOutcomeMock).toHaveBeenCalledWith(
      ctx.runtime.paths,
      expect.objectContaining({
        id: "outcome-42",
        toolCallCount: 0,
        toolSuccessCount: 0,
        contextStability: true,
      }),
    );
  });

  it("passes previousResponseId into the second workflow LLM turn when Responses server-state is enabled", async () => {
    loadTurnOutcomeMock.mockImplementation((_paths, outcomeId: string) => {
      if (outcomeId === "outcome-1") {
        return {
          id: "outcome-1",
          responseId: "resp_prev_123",
        };
      }
      return null;
    });
    workflowGatewayExecuteMock
      .mockResolvedValueOnce({
        content: "first reply",
        outcome: { id: "outcome-1", responseId: "resp_prev_123" },
        toolCalls: [],
        finishReason: "stop",
        usage: null,
        retryCount: 0,
        fallbackEvents: [],
        requestVariantId: "primary",
        fallbackReason: null,
      })
      .mockResolvedValueOnce({
        content: "second reply",
        outcome: { id: "outcome-2", responseId: "resp_456" },
        toolCalls: [],
        finishReason: "stop",
        usage: null,
        retryCount: 0,
        fallbackEvents: [],
        requestVariantId: "primary",
        fallbackReason: null,
      });

    const workflow = {
      id: "wf-4",
      name: "Workflow With Responses Continuation",
      description: "test",
      status: "draft",
      source: "personal",
      version: 1,
      nodeCount: 4,
      edgeCount: 3,
      libraryRootId: "",
      updatedAt: "2026-04-10T00:00:00.000Z",
    };
    const ctx: any = {
      runtime: { paths: { myClawDir: "/tmp" }, myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions" },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          baseUrl: "https://api.openai.com/v1",
          responsesApiConfig: {
            useServerState: true,
          },
        })],
        sessions: [],
        siliconPersons: [],
        skills: [],
        workflowDefinitions: {
          "wf-4": {
            ...workflow,
            entryNodeId: "start",
            nodes: [
              { id: "start", kind: "start", label: "Start" },
              {
                id: "llm-1",
                kind: "llm",
                label: "First",
                llm: {
                  prompt: "hello",
                  outputKey: "reply1",
                  providerFamily: "openai-native",
                  protocolTarget: "openai-responses",
                },
              },
              {
                id: "llm-2",
                kind: "llm",
                label: "Second",
                llm: {
                  prompt: "follow up {{reply1}}",
                  outputKey: "reply2",
                  providerFamily: "openai-native",
                  protocolTarget: "openai-responses",
                },
              },
              { id: "end", kind: "end", label: "End" },
            ],
            edges: [
              { id: "edge-1", fromNodeId: "start", toNodeId: "llm-1", kind: "normal" },
              { id: "edge-2", fromNodeId: "llm-1", toNodeId: "llm-2", kind: "normal" },
              { id: "edge-3", fromNodeId: "llm-2", toNodeId: "end", kind: "normal" },
            ],
            stateSchema: [],
          },
        },
        workflowRuns: [],
        activeWorkflowRuns: new Map(),
        activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1",
        setDefaultModelProfileId: () => {},
        getWorkflows: () => [workflow],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
        setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerWorkflowHandlers(ctx);
    const startRunHandler = findHandler("workflow:start-run");
    const started = await startRunHandler(null, { workflowId: "wf-4" }) as { runId: string };

    await vi.waitFor(() => {
      expect(workflowGatewayExecuteMock).toHaveBeenCalledTimes(2);
    });

    expect(workflowGatewayExecuteMock.mock.calls[0]?.[0]).toMatchObject({
      workflowRunId: started.runId,
      plan: expect.objectContaining({
        protocolTarget: "openai-responses",
      }),
    });
    expect(loadTurnOutcomeMock).toHaveBeenCalledWith(ctx.runtime.paths, "outcome-1");
    expect(workflowGatewayExecuteMock.mock.calls[1]?.[0]).toMatchObject({
      workflowRunId: started.runId,
      previousResponseId: "resp_prev_123",
      plan: expect.objectContaining({
        protocolTarget: "openai-responses",
      }),
    });
  });

});
