import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatSession, ResolvedExecutionPlan } from "@shared/contracts";
import { SESSION_RUNTIME_VERSION } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPersistedState, resetSessionDatabase, saveSession } from "../src/main/services/state-persistence";

let testRootDir: string;

function createPaths(rootDir: string) {
  const myClawDir = join(rootDir, "myClaw");
  return {
    rootDir,
    myClawDir,
    skillsDir: join(myClawDir, "skills"),
    sessionsDir: join(myClawDir, "sessions"),
    sessionsDbFile: join(myClawDir, "sessions.db"),
    modelsDir: join(myClawDir, "models"),
    settingsFile: join(myClawDir, "settings.json"),
  };
}

beforeEach(() => {
  resetSessionDatabase();
  testRootDir = join(tmpdir(), `myclaw-session-persistence-${randomUUID()}`);
  mkdirSync(testRootDir, { recursive: true });
});

afterEach(() => {
  resetSessionDatabase();
  rmSync(testRootDir, { recursive: true, force: true });
});

describe("Phase 2 session persistence", () => {
  it("round-trips executionPlan and runtime metadata through disk persistence", async () => {
    const paths = createPaths(testRootDir);
    const executionPlan: ResolvedExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "br-minimax",
      adapterSelectionSource: "intent",
      reasoningMode: "auto",
      reasoningEnabled: true,
      reasoningEffort: "high",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn-with-reasoning",
      toolStrategy: "auto",
      degradationReason: "tool-strategy-downgraded",
      planSource: "capability",
      fallbackAdapterIds: ["openai-compatible"],
    };
    const session: ChatSession = {
      id: "session-phase2-persistence",
      title: "Phase 2 Persistence",
      modelProfileId: "profile-1",
      attachedDirectory: "/tmp/project",
      createdAt: "2026-04-06T00:00:00.000Z",
      runtimeVersion: SESSION_RUNTIME_VERSION,
      runtimeIntent: {
        reasoningMode: "auto",
        reasoningEnabled: true,
        reasoningEffort: "high",
        adapterHint: "br-minimax",
        replayPolicy: "assistant-turn-with-reasoning",
        toolStrategy: "auto",
      },
      executionPlan,
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "persist this session",
          createdAt: "2026-04-06T00:00:01.000Z",
        },
      ],
    };

    await saveSession(paths, session);

    const persisted = await loadPersistedState(paths);

    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0]).toMatchObject({
      id: session.id,
      runtimeVersion: SESSION_RUNTIME_VERSION,
      runtimeIntent: {
        reasoningEnabled: true,
        toolStrategy: "auto",
        replayPolicy: "assistant-turn-with-reasoning",
      },
      executionPlan: {
        adapterId: "br-minimax",
        reasoningEffort: "high",
        degradationReason: "tool-strategy-downgraded",
        planSource: "capability",
        fallbackAdapterIds: ["openai-compatible"],
      },
    });
    expect(persisted.sessions[0].messages).toEqual(session.messages);
  });

  it("keeps older persisted sessions loadable when phase 2 metadata is absent", async () => {
    const paths = createPaths(testRootDir);
    const sessionDir = join(paths.sessionsDir, "legacy-session");

    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "session.json"),
      JSON.stringify({
        id: "legacy-session",
        title: "Legacy Session",
        modelProfileId: "profile-legacy",
        attachedDirectory: null,
        createdAt: "2026-04-06T00:00:00.000Z",
        runtimeVersion: SESSION_RUNTIME_VERSION,
        runtimeIntent: {
          reasoningMode: "auto",
          replayPolicy: "content-only",
        },
      }),
      "utf-8",
    );
    writeFileSync(join(sessionDir, "messages.json"), JSON.stringify([]), "utf-8");

    const persisted = await loadPersistedState(paths);

    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0]).toMatchObject({
      id: "legacy-session",
      runtimeVersion: SESSION_RUNTIME_VERSION,
      runtimeIntent: {
        reasoningMode: "auto",
        replayPolicy: "content-only",
      },
    });
    expect(persisted.sessions[0].executionPlan).toBeUndefined();
    expect(persisted.sessions[0].messages).toEqual([]);
  });
});
