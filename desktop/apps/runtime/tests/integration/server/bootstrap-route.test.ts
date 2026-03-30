import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "../../../src/server";

describe("bootstrap route integration", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await dispose?.();
    dispose = undefined;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("returns bootstrap payload through the routed bootstrap module", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-bootstrap-"));
    const stateFilePath = join(tempDir, "runtime-state.json");
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/bootstrap`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.app).toBe("myclaw-desktop");
    expect(Array.isArray(payload.services)).toBe(true);
    expect(payload.services).toContain("runtime-api");
    expect(payload.runtimeStateFilePath).toBe(stateFilePath);
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(Array.isArray(payload.skills.items)).toBe(true);
  });
});
