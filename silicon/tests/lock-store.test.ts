import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireEmployeeLock, releaseEmployeeLock } from "../src/core/lock-store";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-lock-"));
  tempRoots.push(root);
  return root;
}

describe("employee lock store", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("writes lock metadata and rejects a fresh duplicate lock", async () => {
    const employeeDir = await makeTempRoot();
    const lock = await acquireEmployeeLock(employeeDir, "heartbeat", {
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      ttlMs: 60_000,
    });

    const metadata = JSON.parse(await readFile(join(lock.lockDir, "lock.json"), "utf8"));
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      lockName: "heartbeat",
      ownerPid: process.pid,
      acquiredAt: "2026-05-13T00:00:00.000Z",
      expiresAt: "2026-05-13T00:01:00.000Z",
    });
    await expect(acquireEmployeeLock(employeeDir, "heartbeat", {
      now: () => new Date("2026-05-13T00:00:30.000Z"),
      ttlMs: 60_000,
    })).rejects.toThrow("Employee lock is already held");

    await releaseEmployeeLock(lock);
  });

  it("removes stale lock metadata and allows reacquire after expiry", async () => {
    const employeeDir = await makeTempRoot();
    await acquireEmployeeLock(employeeDir, "heartbeat", {
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      ttlMs: 60_000,
    });

    const reacquired = await acquireEmployeeLock(employeeDir, "heartbeat", {
      now: () => new Date("2026-05-13T00:02:00.000Z"),
      ttlMs: 60_000,
    });

    const metadata = JSON.parse(await readFile(join(reacquired.lockDir, "lock.json"), "utf8"));
    expect(metadata).toMatchObject({
      acquiredAt: "2026-05-13T00:02:00.000Z",
      expiresAt: "2026-05-13T00:03:00.000Z",
    });
    await releaseEmployeeLock(reacquired);
  });
});
