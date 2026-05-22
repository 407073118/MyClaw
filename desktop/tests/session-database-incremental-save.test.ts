import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatMessage, ChatSession } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionDatabase } from "../src/main/services/session-database";

let testRootDir: string;
const originalIncrementalEnv = process.env.MYCLAW_SESSION_INCREMENTAL_SAVE;
const originalDebounceEnv = process.env.MYCLAW_SESSION_DEBOUNCED_FLUSH;
const originalDebounceMsEnv = process.env.MYCLAW_SESSION_FLUSH_DEBOUNCE_MS;

/** 创建隔离测试数据库路径，避免不同用例共享 sql.js 导出文件。 */
function createDbPath(): string {
  testRootDir = join(tmpdir(), `myclaw-session-db-${randomUUID()}`);
  mkdirSync(testRootDir, { recursive: true });
  return join(testRootDir, "sessions.db");
}

/** 构造稳定消息，便于断言 seq 后缀增量写入行为。 */
function makeMessage(index: number, content = `message-${index}`): ChatMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    createdAt: `2026-05-21T00:00:0${index}.000Z`,
  };
}

/** 构造会话对象，默认只变化 messages 列表。 */
function makeSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "session-incremental",
    title: "Incremental Save",
    modelProfileId: "profile-1",
    attachedDirectory: null,
    createdAt: "2026-05-21T00:00:00.000Z",
    messages,
  };
}

/** 提取测试期间写入 messages 表的 SQL，排除 schema 初始化噪声。 */
function messageWriteCalls(runSpy: ReturnType<typeof vi.spyOn>): Array<{ sql: string; params: Record<string, unknown> | undefined }> {
  return runSpy.mock.calls
    .map(([sql, params]) => ({
      sql: String(sql).replace(/\s+/g, " ").trim(),
      params: params as Record<string, unknown> | undefined,
    }))
    .filter((call) => call.sql.includes("messages"));
}

beforeEach(() => {
  vi.useRealTimers();
  process.env.MYCLAW_SESSION_INCREMENTAL_SAVE = "1";
  process.env.MYCLAW_SESSION_DEBOUNCED_FLUSH = "0";
  delete process.env.MYCLAW_SESSION_FLUSH_DEBOUNCE_MS;
});

afterEach(() => {
  vi.useRealTimers();
  process.env.MYCLAW_SESSION_INCREMENTAL_SAVE = originalIncrementalEnv;
  process.env.MYCLAW_SESSION_DEBOUNCED_FLUSH = originalDebounceEnv;
  process.env.MYCLAW_SESSION_FLUSH_DEBOUNCE_MS = originalDebounceMsEnv;
  if (testRootDir) {
    rmSync(testRootDir, { recursive: true, force: true });
  }
});

describe("SessionDatabase incremental session save", () => {
  it("appends only new messages when persisted prefix is unchanged", async () => {
    const db = await SessionDatabase.create(createDbPath());
    db.saveSession(makeSession([makeMessage(0), makeMessage(1)]));

    const runSpy = vi.spyOn(db as unknown as { run: (sql: string, params?: Record<string, unknown>) => void }, "run");
    db.saveSession(makeSession([makeMessage(0), makeMessage(1), makeMessage(2)]));

    const calls = messageWriteCalls(runSpy);
    expect(calls.some((call) => call.sql.startsWith("DELETE FROM messages"))).toBe(false);
    expect(calls.filter((call) => call.sql.startsWith("INSERT INTO messages"))).toHaveLength(1);
    expect(db.getSession("session-incremental")?.messages).toEqual([makeMessage(0), makeMessage(1), makeMessage(2)]);
    db.close();
  });

  it("rewrites only the changed suffix when a middle message differs", async () => {
    const db = await SessionDatabase.create(createDbPath());
    db.saveSession(makeSession([makeMessage(0), makeMessage(1), makeMessage(2)]));

    const runSpy = vi.spyOn(db as unknown as { run: (sql: string, params?: Record<string, unknown>) => void }, "run");
    const changed = makeMessage(1, "message-1-edited");
    db.saveSession(makeSession([makeMessage(0), changed, makeMessage(2)]));

    const calls = messageWriteCalls(runSpy);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sql: "DELETE FROM messages WHERE session_id = @session_id AND seq >= @seq",
        params: expect.objectContaining({ session_id: "session-incremental", seq: 1 }),
      }),
    ]));
    expect(calls.filter((call) => call.sql.startsWith("INSERT INTO messages"))).toHaveLength(2);
    expect(db.getSession("session-incremental")?.messages).toEqual([makeMessage(0), changed, makeMessage(2)]);
    db.close();
  });

  it("keeps the full rewrite rollback path when incremental save is disabled", async () => {
    const db = await SessionDatabase.create(createDbPath());
    db.saveSession(makeSession([makeMessage(0), makeMessage(1)]));
    process.env.MYCLAW_SESSION_INCREMENTAL_SAVE = "0";

    const runSpy = vi.spyOn(db as unknown as { run: (sql: string, params?: Record<string, unknown>) => void }, "run");
    db.saveSession(makeSession([makeMessage(0), makeMessage(1), makeMessage(2)]));

    const calls = messageWriteCalls(runSpy);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sql: "DELETE FROM messages WHERE session_id = @session_id",
        params: expect.objectContaining({ session_id: "session-incremental" }),
      }),
    ]));
    expect(calls.filter((call) => call.sql.startsWith("INSERT INTO messages"))).toHaveLength(3);
    db.close();
  });

  it("coalesces save flushes until debounce expires and supports flushNow", async () => {
    vi.useFakeTimers();
    process.env.MYCLAW_SESSION_DEBOUNCED_FLUSH = "1";
    process.env.MYCLAW_SESSION_FLUSH_DEBOUNCE_MS = "50";
    const db = await SessionDatabase.create(createDbPath());
    const flushSpy = vi.spyOn(db as unknown as { flush: () => void }, "flush");

    db.saveSession(makeSession([makeMessage(0)]));
    db.saveSession(makeSession([makeMessage(0), makeMessage(1)]));

    expect(flushSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(49);
    expect(flushSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flushSpy).toHaveBeenCalledTimes(1);

    db.saveSession(makeSession([makeMessage(0), makeMessage(1), makeMessage(2)]));
    expect(typeof (db as unknown as { flushNow?: () => void }).flushNow).toBe("function");
    (db as unknown as { flushNow: () => void }).flushNow();
    expect(flushSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(flushSpy).toHaveBeenCalledTimes(2);
    db.close();
  });
});
