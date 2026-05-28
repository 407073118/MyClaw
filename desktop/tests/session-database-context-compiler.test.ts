import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextCheckpoint, ContextCompactionMetadata } from "@shared/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { SessionDatabase } from "../src/main/services/session-database";

let testRootDir: string;

/** 创建隔离数据库路径，避免上下文元数据持久化测试互相污染。 */
function createDbPath(): string {
  testRootDir = join(tmpdir(), `myclaw-context-compiler-db-${randomUUID()}`);
  mkdirSync(testRootDir, { recursive: true });
  return join(testRootDir, "sessions.db");
}

/** 构造最小 checkpoint，聚焦持久化字段是否无损往返。 */
function makeCheckpoint(): ContextCheckpoint {
  return {
    id: "checkpoint-1",
    sessionId: "session-1",
    turnId: "turn-1",
    createdAt: "2026-05-23T00:00:00.000Z",
    taskGoal: "实现 Context Compiler",
    currentPhase: "implementation",
    completedActions: ["写入 RED 测试"],
    activeAssumptions: ["原始会话不删除"],
    decisions: ["本地 compiler 为主链"],
    touchedFiles: ["desktop/src/main/services/context-compiler.ts"],
    toolOutcomes: [{ tool: "rg", summary: "定位上下文主链", sourceMessageIds: ["m1"] }],
    openItems: ["接入 UI"],
    blockers: [],
    nextGoal: "实现最小通过代码",
    sourceMessageIds: ["m1", "m2"],
    checksum: "checksum-1",
  };
}

/** 构造最小 compaction metadata，验证可观测数据可恢复。 */
function makeMetadata(): ContextCompactionMetadata {
  return {
    id: "metadata-1",
    sessionId: "session-1",
    turnId: "turn-1",
    createdAt: "2026-05-23T00:00:01.000Z",
    trigger: "token_threshold",
    strategy: ["exact_keep", "tool_mask", "checkpoint"],
    budgetUsed: 180,
    budgetLimit: 220,
    removedMessageIds: ["m1"],
    maskedToolOutputIds: ["tool-1"],
    checkpointId: "checkpoint-1",
    memoryIds: ["memory-m2"],
    providerNativeCompactionUsed: false,
    reason: "compactTriggerTokens reached",
  };
}

afterEach(() => {
  if (testRootDir) {
    rmSync(testRootDir, { recursive: true, force: true });
  }
});

describe("SessionDatabase context compiler persistence", () => {
  it("round-trips checkpoints and compaction metadata through SQLite", async () => {
    const db = await SessionDatabase.create(createDbPath());
    const checkpoint = makeCheckpoint();
    const metadata = makeMetadata();

    db.saveContextCheckpoint(checkpoint);
    db.saveContextCompactionMetadata(metadata);
    db.flushNow("context-compiler-test");

    const reopened = await SessionDatabase.create(join(testRootDir, "sessions.db"));
    expect(reopened.listContextCheckpoints("session-1")).toEqual([checkpoint]);
    expect(reopened.getLatestContextCheckpoint("session-1")).toEqual(checkpoint);
    expect(reopened.listContextCompactionMetadata("session-1")).toEqual([metadata]);
    expect(reopened.getLatestContextCompactionMetadata("session-1")).toEqual(metadata);

    db.close();
    reopened.close();
  });
});
