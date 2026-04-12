import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

describe("model runtime scorecard script", () => {
  const tempRoots: string[] = [];
  const scriptPath = fileURLToPath(new URL("../../../scripts/model-runtime-scorecard.js", import.meta.url));

  afterEach(() => {
    for (const dir of tempRoots.splice(0, tempRoots.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs without --myclaw-dir when MYCLAW_DATA_ROOT is set", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "myclaw-scorecard-root-"));
    tempRoots.push(dataRoot);
    const myClawDir = join(dataRoot, "myClaw");
    mkdirSync(join(myClawDir, "turn-outcomes"), { recursive: true });
    writeFileSync(join(myClawDir, "turn-outcomes", "turn-1.json"), JSON.stringify({
      id: "turn-1",
      providerFamily: "generic-openai-compatible",
      vendorFamily: "generic-openai-compatible",
      protocolTarget: "openai-chat-compatible",
      modelProfileId: "profile-1",
      experienceProfileId: "balanced",
      retryCount: 0,
      toolCompileMode: "relaxed",
      replayMode: "none",
      startedAt: "2026-04-10T00:00:00.000Z",
      finishedAt: "2026-04-10T00:00:01.000Z",
      success: true,
      latencyMs: 100,
    }), "utf-8");
    writeFileSync(join(myClawDir, "turn-telemetry.jsonl"), "{\"event\":\"turn\"}\n", "utf-8");

    const stdout = execFileSync(
      process.execPath,
      [scriptPath],
      {
        cwd: dirname(dirname(scriptPath)),
        env: {
          ...process.env,
          MYCLAW_DATA_ROOT: dataRoot,
        },
        encoding: "utf-8",
      },
    );

    const report = JSON.parse(stdout) as {
      myClawDir: string;
      outcomeCount: number;
      telemetryCount: number;
      scorecards: Array<{ providerFamily: string; sampleSize: number }>;
      vendorProtocolScorecards: Array<{ vendorFamily: string; protocolTarget: string; sampleSize: number }>;
    };
    expect(report.myClawDir).toBe(myClawDir);
    expect(report.outcomeCount).toBe(1);
    expect(report.telemetryCount).toBe(1);
    expect(report.scorecards).toEqual([
      expect.objectContaining({
        providerFamily: "generic-openai-compatible",
        sampleSize: 1,
      }),
    ]);
    expect(report.vendorProtocolScorecards).toEqual([
      expect.objectContaining({
        vendorFamily: "generic-openai-compatible",
        protocolTarget: "openai-chat-compatible",
        sampleSize: 1,
      }),
    ]);
  });
});
