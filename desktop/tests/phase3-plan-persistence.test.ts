import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatSession } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPersistedState, saveSession } from "../src/main/services/state-persistence";

let testRootDir: string;

function createPaths(rootDir: string) {
  const myClawDir = join(rootDir, "myClaw");
  return {
    rootDir,
    myClawDir,
    skillsDir: join(myClawDir, "skills"),
    sessionsDir: join(myClawDir, "sessions"),
    modelsDir: join(myClawDir, "models"),
    settingsFile: join(myClawDir, "settings.json"),
  };
}

beforeEach(() => {
  testRootDir = join(tmpdir(), `myclaw-plan-persistence-${randomUUID()}`);
  mkdirSync(testRootDir, { recursive: true });
});

afterEach(() => {
  rmSync(testRootDir, { recursive: true, force: true });
});

describe("Phase 3 plan persistence", () => {
  it("round-trips persisted planState through session metadata and disk reloads", async () => {
    const paths = createPaths(testRootDir);
    const session: ChatSession = {
      id: "session-phase3-plan-state",
      title: "Phase 3 Plan Persistence",
      modelProfileId: "profile-1",
      attachedDirectory: "/tmp/project",
      createdAt: "2026-04-06T00:00:00.000Z",
      planState: {
        tasks: [
          {
            id: "task-collect-context",
            title: "Collect context",
            status: "completed",
            detail: "Files reviewed",
          },
          {
            id: "task-run-verification",
            title: "Run verification",
            status: "blocked",
            blocker: "Waiting for runtime implementation",
          },
        ],
        updatedAt: "2026-04-06T00:00:02.000Z",
      },
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "persist the plan state",
          createdAt: "2026-04-06T00:00:01.000Z",
        },
      ],
    };

    await saveSession(paths, session);

    const rawMeta = JSON.parse(
      readFileSync(join(paths.sessionsDir, session.id, "session.json"), "utf-8"),
    ) as Omit<ChatSession, "messages">;

    expect(rawMeta).not.toHaveProperty("messages");
    expect(rawMeta.planState).toEqual(session.planState);

    const persisted = loadPersistedState(paths);

    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0]).toMatchObject({
      id: session.id,
      planState: {
        updatedAt: "2026-04-06T00:00:02.000Z",
        tasks: [
          {
            id: "task-collect-context",
            status: "completed",
            detail: "Files reviewed",
          },
          {
            id: "task-run-verification",
            status: "blocked",
            blocker: "Waiting for runtime implementation",
          },
        ],
      },
    });
    expect(persisted.sessions[0].messages).toEqual(session.messages);
  });

  it("preserves omitted and null planState shapes across real save/load round-trips", async () => {
    const paths = createPaths(testRootDir);
    const sessionWithoutPlanState: ChatSession = {
      id: "session-without-plan-state",
      title: "Session Without Plan State",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      messages: [],
    };
    const sessionWithNullPlanState: ChatSession = {
      id: "session-with-null-plan-state",
      title: "Session With Null Plan State",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      planState: null,
      messages: [],
    };

    await saveSession(paths, sessionWithoutPlanState);
    await saveSession(paths, sessionWithNullPlanState);

    const rawMetaWithoutPlanState = JSON.parse(
      readFileSync(join(paths.sessionsDir, sessionWithoutPlanState.id, "session.json"), "utf-8"),
    ) as Omit<ChatSession, "messages">;
    const rawMetaWithNullPlanState = JSON.parse(
      readFileSync(join(paths.sessionsDir, sessionWithNullPlanState.id, "session.json"), "utf-8"),
    ) as Omit<ChatSession, "messages">;

    expect(rawMetaWithoutPlanState).not.toHaveProperty("planState");
    expect(rawMetaWithNullPlanState).toHaveProperty("planState", null);

    const persisted = loadPersistedState(paths);
    const reloadedWithoutPlanState = persisted.sessions.find((session) => session.id === sessionWithoutPlanState.id);
    const reloadedWithNullPlanState = persisted.sessions.find((session) => session.id === sessionWithNullPlanState.id);

    expect(reloadedWithoutPlanState).toBeDefined();
    expect(reloadedWithoutPlanState?.planState).toBeUndefined();
    expect(reloadedWithoutPlanState?.messages).toEqual([]);

    expect(reloadedWithNullPlanState).toBeDefined();
    expect(reloadedWithNullPlanState?.planState).toBeNull();
    expect(reloadedWithNullPlanState?.messages).toEqual([]);
  });

  it("keeps older persisted sessions loadable when planState is missing", () => {
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
      }),
      "utf-8",
    );
    writeFileSync(join(sessionDir, "messages.json"), JSON.stringify([]), "utf-8");

    const persisted = loadPersistedState(paths);

    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0]).toMatchObject({
      id: "legacy-session",
      title: "Legacy Session",
    });
    expect(persisted.sessions[0].planState).toBeUndefined();
    expect(persisted.sessions[0].messages).toEqual([]);
  });

  it("round-trips persisted planModeState metadata and structured plan drafts through disk reloads", async () => {
    const paths = createPaths(testRootDir);
    const session = {
      id: "session-with-plan-mode",
      title: "Session With Plan Mode",
      modelProfileId: "profile-1",
      attachedDirectory: "/tmp/project",
      createdAt: "2026-04-06T00:00:00.000Z",
      planState: {
        tasks: [
          {
            id: "task-analyze",
            title: "Analyze request",
            status: "completed",
          },
          {
            id: "task-await-approval",
            title: "Wait for approval",
            status: "pending",
          },
        ],
        updatedAt: "2026-04-06T00:00:02.000Z",
      },
      planModeState: {
        mode: "awaiting_approval",
        approvalStatus: "pending",
        planVersion: 3,
        lastPlanMessageId: "assistant-plan-message",
        approvedAt: null,
        structuredPlan: {
          goal: "Ship plan mode MVP",
          summary: "Generate a visible plan before execution",
          assumptions: ["The existing planner task runtime remains reusable"],
          openQuestions: ["Should execution auto-start after approval?"],
          acceptanceCriteria: ["The user must approve before execution begins"],
          steps: [
            {
              id: "step-analyze",
              title: "Analyze request",
              status: "completed",
              kind: "analysis",
            },
            {
              id: "step-approve",
              title: "Await approval",
              status: "pending",
              kind: "user_confirmation",
            },
          ],
        },
      },
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Plan draft ready",
          createdAt: "2026-04-06T00:00:01.000Z",
        },
      ],
    } as ChatSession;

    await saveSession(paths, session);

    const rawMeta = JSON.parse(
      readFileSync(join(paths.sessionsDir, session.id, "session.json"), "utf-8"),
    ) as Omit<ChatSession, "messages"> & Record<string, unknown>;

    expect(rawMeta.planModeState).toMatchObject({
      mode: "awaiting_approval",
      approvalStatus: "pending",
      planVersion: 3,
      lastPlanMessageId: "assistant-plan-message",
    });

    const persisted = loadPersistedState(paths);
    expect(persisted.sessions).toHaveLength(1);
    expect((persisted.sessions[0] as ChatSession & Record<string, unknown>).planModeState).toMatchObject({
      mode: "awaiting_approval",
      approvalStatus: "pending",
      planVersion: 3,
      structuredPlan: {
        goal: "Ship plan mode MVP",
        steps: [
          {
            id: "step-analyze",
            kind: "analysis",
          },
          {
            id: "step-approve",
            kind: "user_confirmation",
          },
        ],
      },
    });
  });
});
