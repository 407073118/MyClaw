import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startSiliconDaemonSupervisor } from "../src/runtime/supervisor";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-supervisor-"));
  tempRoots.push(root);
  return root;
}

describe("daemon supervisor lock handling", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("does not delete an existing stop request when another supervisor already holds the lock", async () => {
    const runtimeRoot = await makeTempRoot();
    const lockDir = join(runtimeRoot, "platform", "daemon.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, "lock.json"), `${JSON.stringify({
      schemaVersion: 1,
      runtimeRoot,
      ownerPid: 123,
      acquiredAt: "2026-05-13T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }, null, 2)}\n`, "utf8");
    const stopPath = join(runtimeRoot, "platform", "daemon.stop");
    await writeFile(stopPath, "{}\n", "utf8");

    await expect(startSiliconDaemonSupervisor({ runtimeRoot, intervalMs: 1 })).rejects.toThrow("Daemon supervisor is already running");
    expect((await stat(stopPath)).isFile()).toBe(true);
  });
});
