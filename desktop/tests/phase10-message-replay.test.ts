import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelProfile } from "@shared/contracts";
import type { MyClawPaths } from "../src/main/services/directory-service";

const registeredSessionHandlers = new Map<string, (...args: any[]) => Promise<any>>();

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
      return { success: true, output: "tool-ok" };
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
    id: "phase10-profile",
    name: "Phase 10 Profile",
    provider: "openai-compatible",
    providerFlavor: "minimax-anthropic",
    baseUrl: "https://api.minimaxi.com",
    baseUrlMode: "provider-root",
    apiKey: "test-key",
    model: "MiniMax-M2.5",
    capabilityOverrides: {
      supportsReasoning: true,
      supportsEffort: true,
      requiresReasoningReplay: true,
      preferredProtocol: "anthropic",
      raw: {
        supportsReasoningSplit: true,
      },
    },
    ...overrides,
  };
}

function makePaths(): MyClawPaths {
  const rootDir = mkdtempSync(join(tmpdir(), "myclaw-phase10-"));
  return {
    rootDir,
    myClawDir: join(rootDir, "myClaw"),
    skillsDir: join(rootDir, "myClaw", "skills"),
    sessionsDir: join(rootDir, "myClaw", "sessions"),
    modelsDir: join(rootDir, "myClaw", "models"),
    settingsFile: join(rootDir, "myClaw", "settings.json"),
  };
}

function createSseResponse(chunks: unknown[]): Response {
  const body = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("") + "data: [DONE]\n\n";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

beforeEach(() => {
  registeredSessionHandlers.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("phase 10 message replay", () => {
  it("replays the stored assistant payload through the sessions tool loop", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const callIndex = fetchMock.mock.calls.length;
      const requestBody = JSON.parse(String(init?.body));

      if (callIndex === 2) {
        const replayedAssistant = requestBody.messages.find(
          (message: Record<string, unknown>) => message.role === "assistant" && Array.isArray(message.tool_calls),
        );
        expect(replayedAssistant?.reasoning).toBe("plan carefully");
        expect(replayedAssistant?.tool_calls).toHaveLength(1);

        return createSseResponse([
          {
            choices: [{
              delta: {
                content: "All set",
                reasoning_content: "finished",
              },
              finish_reason: "stop",
            }],
          },
        ]);
      }

      return createSseResponse([
        {
          choices: [{
            delta: {
              content: "Use tool",
              reasoning_content: "plan carefully",
              tool_calls: [{
                index: 0,
                id: "tool-1",
                function: {
                  name: "fs.read",
                  arguments: "{\"path\":\"README.md\"}",
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const paths = makePaths();

    try {
      const { registerSessionHandlers } = await import("../src/main/ipc/sessions");
      const session = {
        id: "session-1",
        title: "Replay",
        modelProfileId: "profile-1",
        attachedDirectory: null,
        thinkingEnabled: true,
        thinkingSource: "user-toggle",
        createdAt: "2026-04-04T00:00:00.000Z",
        messages: [],
      };
      const modelProfile = buildProfile({
        id: "profile-1",
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

      await sendHandler?.(null, "session-1", { content: "Please inspect the file." });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const assistantWithToolCall = session.messages.find(
        (message: { role: string; tool_calls?: unknown[] }) => message.role === "assistant" && Array.isArray(message.tool_calls),
      );
      expect(assistantWithToolCall?.reasoning).toBe("plan carefully");
      expect(session.messages.at(-1)?.content).toBe("All set");
      expect(session.messages.at(-1)?.reasoning).toBe("finished");
    } finally {
      rmSync(paths.rootDir, { recursive: true, force: true });
    }
  });
});
