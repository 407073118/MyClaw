import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcHandleRegistry = new Map<string, (...args: unknown[]) => unknown>();
const gatewayExecuteMock = vi.fn();
const { loadTurnOutcomeMock } = vi.hoisted(() => ({
  loadTurnOutcomeMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => ipcHandleRegistry.set(channel, handler)) },
  webContents: { getAllWebContents: () => [] },
}));

vi.mock("../../../src/main/services/model-runtime/execution-gateway", () => ({
  createExecutionGateway: () => ({ executeTurn: gatewayExecuteMock }),
}));

vi.mock("../../../src/main/services/context-assembler", () => ({ assembleContext: vi.fn(() => ({ messages: [{ role: "user", content: "hello" }], budgetUsed: 1, wasCompacted: false, compactionReason: null, removedCount: 0, maskedToolOutputCount: 0, shouldSuggestNewChat: false })) }));
vi.mock("../../../src/main/services/model-capability-resolver", () => ({ resolveModelCapability: vi.fn(() => ({ effective: { supportsReasoning: true, source: "registry" } })) }));
vi.mock("../../../src/main/services/reasoning-runtime", () => ({ resolveSessionRuntimeIntent: vi.fn(() => ({ reasoningMode: "auto", reasoningEffort: "medium", adapterHint: "auto", replayPolicy: "content-only", workflowMode: "default" })), buildExecutionPlan: vi.fn(() => ({ runtimeVersion: 1, adapterId: "openai-compatible", adapterSelectionSource: "profile", reasoningMode: "auto", replayPolicy: "content-only", fallbackAdapterIds: [], planSource: "profile", degradationReason: null })) }));
vi.mock("../../../src/main/services/state-persistence", () => ({ saveSession: vi.fn(), saveSiliconPerson: vi.fn(), saveWorkflowRun: vi.fn(), deleteWorkflowRunFile: vi.fn(), deleteSessionFiles: vi.fn() }));
vi.mock("../../../src/main/services/model-runtime/turn-outcome-store", () => ({
  updateTurnOutcome: vi.fn(() => Promise.resolve()),
  loadTurnOutcome: loadTurnOutcomeMock,
}));
vi.mock("../../../src/main/services/tool-schemas", () => ({ buildToolSchemas: vi.fn(() => []), functionNameToToolId: vi.fn((name: string) => name), buildToolLabel: vi.fn((name: string) => name) }));
vi.mock("../../../src/main/services/builtin-tool-executor", () => ({ BuiltinToolExecutor: class { setSkills() {} setAllowExternalPaths() {} async shutdown() {} isOutsideWorkspace() { return false; } } }));

import { registerSessionHandlers } from "../../../src/main/ipc/sessions";
import { makeProfile } from "../contracts/test-helpers";

describe("sessions execution gateway", () => {
  beforeEach(() => {
    ipcHandleRegistry.clear();
    gatewayExecuteMock.mockReset();
    loadTurnOutcomeMock.mockReset();
    gatewayExecuteMock.mockResolvedValue({
      content: "assistant reply",
      toolCalls: [],
      finishReason: "stop",
      plan: { providerFamily: "generic-openai-compatible" },
      outcome: { id: "outcome-1" },
    });
  });

  it("routes session model turns through the shared execution gateway", async () => {
    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile()],
        sessions: [{ id: "session-1", title: "Test", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z", messages: [] }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:send-message");
    await handler?.({}, "session-1", { content: "hello", attachedDirectory: null });

    expect(gatewayExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: "canonical",
      plan: expect.objectContaining({
        providerFamily: "generic-openai-compatible",
        protocolTarget: "openai-chat-compatible",
      }),
      content: expect.objectContaining({
        systemSections: expect.any(Array),
      }),
      toolSpecs: [],
    }));
  });

  it("passes previousResponseId into canonical execution when server-state continuation is enabled", async () => {
    loadTurnOutcomeMock.mockReturnValue({
      id: "turn-1",
      responseId: "resp_prev_123",
    });
    gatewayExecuteMock.mockResolvedValue({
      content: "assistant reply",
      toolCalls: [],
      finishReason: "stop",
      plan: { providerFamily: "openai-native", protocolTarget: "openai-responses" },
      outcome: { id: "outcome-2", responseId: "resp_456" },
    });

    const ctx: any = {
      runtime: { myClawRootPath: "/tmp", skillsRootPath: "/tmp/skills", sessionsRootPath: "/tmp/sessions", paths: { myClawDir: "/tmp" } },
      state: {
        models: [makeProfile({
          providerFlavor: "openai",
          baseUrl: "https://api.openai.com/v1",
          responsesApiConfig: {
            useServerState: true,
          },
        })],
        sessions: [{
          id: "session-1",
          title: "Test",
          modelProfileId: "profile-1",
          attachedDirectory: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          messages: [],
          lastTurnOutcomeId: "turn-1",
        }],
        siliconPersons: [], skills: [], workflowDefinitions: {}, workflowRuns: [], activeWorkflowRuns: new Map(), activeSessionRuns: new Map(),
        getDefaultModelProfileId: () => "profile-1", setDefaultModelProfileId: () => {}, getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [], setApprovalRequests: () => {},
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }), setPersonalPromptProfile: () => {},
      },
      services: { refreshSkills: async () => [], listMcpServers: () => [], mcpManager: null, appUpdater: { getSnapshot: () => ({ status: "idle" }) } },
      tools: { resolveBuiltinTools: () => [], resolveMcpTools: () => [] },
    };

    registerSessionHandlers(ctx);
    const handler = ipcHandleRegistry.get("session:send-message");
    await handler?.({}, "session-1", { content: "hello", attachedDirectory: null });

    expect(loadTurnOutcomeMock).toHaveBeenCalledWith(ctx.runtime.paths, "turn-1");
    expect(gatewayExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
      previousResponseId: "resp_prev_123",
      plan: expect.objectContaining({
        protocolTarget: "openai-responses",
      }),
    }));
  });
});
