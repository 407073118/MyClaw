import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSessionsSnapshot, saveSessionsSnapshot } from "./session-persistence";

describe("session persistence", () => {
  let tempDir: string;
  let sessionsRootPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-session-persistence-"));
    sessionsRootPath = join(tempDir, "sessions");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists session metadata and messages into per-session folders", async () => {
    const sessions = [
      {
        id: "session-default",
        title: "欢迎会话",
        modelProfileId: "model-default",
        attachedDirectory: null,
        createdAt: "2026-03-26T08:00:00.000Z",
        messages: [
          {
            id: "msg-welcome",
            role: "assistant" as const,
            content: "运行时已经就绪。",
            createdAt: "2026-03-26T08:00:01.000Z",
          },
        ],
      },
      {
        id: "session-project",
        title: "项目会话",
        modelProfileId: "model-default",
        attachedDirectory: "F:/project",
        createdAt: "2026-03-26T08:05:00.000Z",
        messages: [
          {
            id: "msg-user-1",
            role: "user" as const,
            content: "请检查这个项目。",
            createdAt: "2026-03-26T08:05:01.000Z",
          },
          {
            id: "msg-assistant-1",
            role: "assistant" as const,
            content: "我先读取目录结构。",
            createdAt: "2026-03-26T08:05:02.000Z",
          },
        ],
      },
    ];

    await saveSessionsSnapshot(sessionsRootPath, sessions);

    await expect(loadSessionsSnapshot(sessionsRootPath)).resolves.toEqual(sessions);
  });

  it("removes stale session folders that no longer exist in memory", async () => {
    await saveSessionsSnapshot(sessionsRootPath, [
      {
        id: "session-default",
        title: "欢迎会话",
        modelProfileId: "model-default",
        attachedDirectory: null,
        createdAt: "2026-03-26T08:00:00.000Z",
        messages: [],
      },
      {
        id: "session-stale",
        title: "待删除会话",
        modelProfileId: "model-default",
        attachedDirectory: null,
        createdAt: "2026-03-26T08:10:00.000Z",
        messages: [],
      },
    ]);

    await saveSessionsSnapshot(sessionsRootPath, [
      {
        id: "session-default",
        title: "欢迎会话",
        modelProfileId: "model-default",
        attachedDirectory: null,
        createdAt: "2026-03-26T08:00:00.000Z",
        messages: [],
      },
    ]);

    await expect(loadSessionsSnapshot(sessionsRootPath)).resolves.toEqual([
      {
        id: "session-default",
        title: "欢迎会话",
        modelProfileId: "model-default",
        attachedDirectory: null,
        createdAt: "2026-03-26T08:00:00.000Z",
        messages: [],
      },
    ]);
  });
});
