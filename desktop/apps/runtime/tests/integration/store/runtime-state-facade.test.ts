import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadRuntimeState,
  resolveRuntimeStateFilePath,
  runtimeStateExists,
  saveRuntimeState,
} from "../../../src/store/runtime-state-store";

describe("runtime state facade", () => {
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-state-facade-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("keeps public file-path resolving behavior unchanged", () => {
    expect(resolveRuntimeStateFilePath("D:/custom/runtime-state.db")).toBe("D:/custom/runtime-state.db");
  });

  it("creates and persists default runtime state when file does not exist", async () => {
    expect(await runtimeStateExists(stateFilePath)).toBe(false);

    const loaded = await loadRuntimeState(stateFilePath);

    expect(await runtimeStateExists(stateFilePath)).toBe(true);
    expect(loaded.models.length).toBeGreaterThan(0);
    expect(loaded.sessions.length).toBeGreaterThan(0);
    expect(loaded.workflowLibraryRoots?.[0]?.id).toBe("personal");
  });

  it("roundtrips runtime state through facade save/load", async () => {
    const base = await loadRuntimeState(stateFilePath);
    const next = {
      ...base,
      approvalRequests: [
        {
          id: "approval-a",
          sessionId: base.sessions[0]?.id ?? "session-default",
          source: "builtin-tool",
          toolId: "exec.command",
          label: "echo test",
          risk: "exec",
          detail: "facade integration",
          resumeConversation: true,
          arguments: {
            cwd: "C:/workspace",
          },
        },
      ],
    };

    await saveRuntimeState(next, stateFilePath);
    const reloaded = await loadRuntimeState(stateFilePath);

    expect(reloaded.approvalRequests).toEqual(next.approvalRequests);
  });
});
