import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function resolveDesktopPath(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

describe("runtime artifact truth", () => {
  it("keeps the current route probe verification assets in the repo", () => {
    expect(existsSync(resolveDesktopPath("tests/model-route-probe-ipc.test.ts"))).toBe(true);
    expect(existsSync(resolveDesktopPath("tests/model-detail-route-probe.test.ts"))).toBe(true);
    expect(existsSync(resolveDesktopPath("tests/models-page-route-badge.test.ts"))).toBe(true);
    expect(existsSync(resolveDesktopPath("tests/settings-page-route-badge.test.ts"))).toBe(true);
    expect(existsSync(resolveDesktopPath("tests/phase11-provider-capability-probers.test.ts"))).toBe(true);
  });

  it("requires the new rollout truth checklist to exist", () => {
    expect(existsSync(resolveDesktopPath("docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md"))).toBe(true);
  });

  it("reflects that old phase10-only verification files are not repo truth anymore", () => {
    expect(existsSync(resolveDesktopPath("tests/phase10-message-replay.test.ts"))).toBe(false);
    expect(existsSync(resolveDesktopPath("tests/phase10-minimax-adapter.test.ts"))).toBe(false);
    expect(existsSync(resolveDesktopPath("tests/phase10-model-settings.test.ts"))).toBe(false);
    expect(existsSync(resolveDesktopPath("tests/phase9-provider-reasoning-mapper.test.ts"))).toBe(false);
  });
});
