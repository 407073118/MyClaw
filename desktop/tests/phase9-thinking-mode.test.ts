import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelProfile } from "@shared/contracts";
import type { MyClawPaths } from "../src/main/services/directory-service";
import { resolveModelCapability } from "../src/main/services/model-capability-resolver";
import { buildReasoningExecutionPlan, resolveSessionThinkingState } from "../src/main/services/reasoning-runtime";
import { loadPersistedState, saveSession } from "../src/main/services/state-persistence";

const registeredSessionHandlers = new Map<string, (...args: any[]) => Promise<any>>();
const callModelMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<any>) => {
      registeredSessionHandlers.set(channel, handler);
    }),
  },
  webContents: {
    getAllWebContents: () => [],
  },
}));

vi.mock("../src/main/services/model-client", () => ({
  callModel: callModelMock,
}));

vi.mock("../src/main/services/tool-schemas", () => ({
  buildToolSchemas: () => [],
  functionNameToToolId: (name: string) => name,
  buildToolLabel: (name: string) => name,
}));

vi.mock("../src/main/services/builtin-tool-executor", () => ({
  BuiltinToolExecutor: class {
    setSkills(): void {}
    setAllowExternalPaths(): void {}
    async shutdown(): Promise<void> {}
    isOutsideWorkspace(): boolean { return false; }
    async execute(): Promise<{ success: boolean; output: string }> {
      return { success: true, output: "ok" };
    }
  },
}));

vi.mock("../src/main/services/context-assembler", () => ({
  assembleContext: vi.fn(({ session }: { session: { messages: unknown[] } }) => ({
    messages: session.messages,
    wasCompacted: false,
    removedCount: 0,
    compactionReason: null,
    budgetUsed: 0,
  })),
}));

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "phase9-profile",
    name: "Phase 9 Profile",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    ...overrides,
  };
}

function makePaths(): MyClawPaths {
  const rootDir = mkdtempSync(join(tmpdir(), "myclaw-phase9-"));
  return {
    rootDir,
    myClawDir: join(rootDir, "myClaw"),
    skillsDir: join(rootDir, "myClaw", "skills"),
    sessionsDir: join(rootDir, "myClaw", "sessions"),
    modelsDir: join(rootDir, "myClaw", "models"),
    settingsFile: join(rootDir, "myClaw", "settings.json"),
  };
}

beforeEach(() => {
  registeredSessionHandlers.clear();
  callModelMock.mockReset();
});

describe("phase 9 thinking mode groundwork", () => {
  it("defaults reasoning-specific capability flags to disabled for unknown providers", () => {
    const profile = buildProfile({
      providerFlavor: "generic-openai-compatible",
      model: "custom-model",
    });

    const resolved = resolveModelCapability(profile, { registryCapability: null });

    expect(resolved.effective.supportsReasoning).toBe(false);
    expect(resolved.effective.supportsEffort).toBe(false);
    expect(resolved.effective.requiresReasoningReplay).toBe(false);
    expect(resolved.effective.preferredProtocol).toBe("openai-compatible");
  });

  it("infers anthropic protocol preference from provider metadata", () => {
    const profile = buildProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
    });

    const resolved = resolveModelCapability(profile);

    expect(resolved.effective.preferredProtocol).toBe("anthropic");
  });

  it("builds an openai-compatible reasoning patch when thinking is enabled", () => {
    const thinkingState = resolveSessionThinkingState({
      thinkingEnabled: true,
      thinkingSource: "user-toggle",
    });

    const plan = buildReasoningExecutionPlan({
      thinkingState,
      capability: {
        source: "manual-override",
        supportsReasoning: true,
        supportsEffort: true,
        preferredProtocol: "openai-compatible",
        requiresReasoningReplay: false,
      },
      profile: {
        provider: "openai-compatible",
        providerFlavor: "openai",
        model: "gpt-5.4",
      },
    });

    expect(plan.enabled).toBe(true);
    expect(plan.degradedReason).toBeNull();
    expect(plan.bodyPatch).toEqual({
      reasoning: {
        effort: "medium",
      },
    });
  });

  it("normalizes persisted sessions with default thinking state", async () => {
    const paths = makePaths();

    try {
      await saveSession(paths, {
        id: "session-1",
        title: "Phase 9 Session",
        modelProfileId: "profile-1",
        attachedDirectory: null,
        createdAt: "2026-04-04T00:00:00.000Z",
        messages: [],
      });

      const state = loadPersistedState(paths);

      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.thinkingEnabled).toBe(false);
      expect(state.sessions[0]?.thinkingSource).toBe("default");
    } finally {
      rmSync(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("defaults new sessions to product-level thinking state", async () => {
    const paths = makePaths();

    try {
      const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
      const ctx = {
        runtime: {
          paths,
          myClawRootPath: paths.myClawDir,
        },
        state: {
          sessions: [],
          models: [],
          skills: [],
          getDefaultModelProfileId: () => "profile-1",
          getApprovals: () => ({ mode: "default", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
          getApprovalRequests: () => [],
          setApprovalRequests: () => undefined,
        },
        services: {
          mcpManager: null,
        },
      } as any;

      registerSessionHandlers(ctx);
      const createHandler = registeredSessionHandlers.get("session:create");
      expect(createHandler).toBeTypeOf("function");

      const payload = await createHandler?.(null, {});

      expect(payload.session.thinkingEnabled).toBe(false);
      expect(payload.session.thinkingSource).toBe("default");
    } finally {
      rmSync(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("passes the reasoning body patch from session state into callModel", async () => {
    const paths = makePaths();
    callModelMock.mockResolvedValue({
      content: "Done",
      toolCalls: [],
      finishReason: "stop",
    });

    try {
      const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
      const session = {
        id: "session-1",
        title: "Test",
        modelProfileId: "profile-1",
        attachedDirectory: null,
        thinkingEnabled: true,
        thinkingSource: "user-toggle",
        createdAt: "2026-04-04T00:00:00.000Z",
        messages: [],
      };
      const modelProfile = buildProfile({
        id: "profile-1",
        providerFlavor: "openai",
        model: "gpt-5.4",
        capabilityOverrides: {
          supportsReasoning: true,
          supportsEffort: true,
          preferredProtocol: "openai-compatible",
        },
      });
      const ctx = {
        runtime: {
          paths,
          myClawRootPath: paths.myClawDir,
        },
        state: {
          sessions: [session],
          models: [modelProfile],
          skills: [],
          getDefaultModelProfileId: () => "profile-1",
          getApprovals: () => ({ mode: "default", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
          getApprovalRequests: () => [],
          setApprovalRequests: () => undefined,
        },
        services: {
          mcpManager: null,
        },
      } as any;

      registerSessionHandlers(ctx);
      const sendHandler = registeredSessionHandlers.get("session:send-message");
      expect(sendHandler).toBeTypeOf("function");

      await sendHandler?.(null, "session-1", { content: "Please reason carefully." });

      expect(callModelMock).toHaveBeenCalledTimes(1);
      expect(callModelMock.mock.calls[0]?.[0]?.bodyPatch).toEqual({
        reasoning: {
          effort: "medium",
        },
      });
    } finally {
      rmSync(paths.rootDir, { recursive: true, force: true });
    }
  });
});
