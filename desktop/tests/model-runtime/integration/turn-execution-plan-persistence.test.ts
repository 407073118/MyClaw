import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { derivePaths } from "../../../src/main/services/directory-service";
import { loadPersistedState, saveSession } from "../../../src/main/services/state-persistence";

describe("turn execution plan persistence", () => {
  it("persists turn execution plans inside session metadata", async () => {
    const paths = derivePaths(mkdtempSync(join(tmpdir(), "myclaw-turn-plan-")));
    await saveSession(paths, { id: "session-1", title: "Session", modelProfileId: "profile-1", attachedDirectory: null, createdAt: "2026-04-10T00:00:00.000Z", messages: [], turnExecutionPlan: { providerFamily: "openai-native", protocolTarget: "openai-responses" }, lastTurnOutcomeId: "turn-1" } as any);

    const persisted = loadPersistedState(paths);
    expect((persisted.sessions[0] as any).turnExecutionPlan.protocolTarget).toBe("openai-responses");
  });
});
