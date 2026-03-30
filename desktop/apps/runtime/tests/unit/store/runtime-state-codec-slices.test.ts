import { describe, expect, it } from "vitest";
import initSqlJsType from "sql.js";

import { initializeRuntimeStateSchema } from "../../../src/store/runtime-state/runtime-state-schema";
import {
  readApprovalRequestsFromDatabase,
  writeApprovalRequestsToDatabase,
} from "../../../src/store/runtime-state/codecs/runtime-state-approval-codec";
import {
  readSessionsFromDatabase,
  writeSessionsToDatabase,
} from "../../../src/store/runtime-state/codecs/runtime-state-session-codec";
import {
  readBuiltinToolPreferencesFromDatabase,
  writeBuiltinToolPreferencesToDatabase,
} from "../../../src/store/runtime-state/codecs/runtime-state-builtin-tool-codec";

describe("runtime state codec slices", () => {
  it("roundtrips approval requests with resume arguments", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();
    initializeRuntimeStateSchema(db);

    writeApprovalRequestsToDatabase(db, [
      {
        id: "request-a",
        sessionId: "session-a",
        source: "builtin-tool",
        toolId: "exec.command",
        label: "run",
        risk: "exec",
        detail: "detail",
        arguments: { cwd: "C:/workspace" },
        resumeConversation: true,
      },
    ]);

    const rows = readApprovalRequestsFromDatabase(db);
    db.close();

    expect(rows).toEqual([
      {
        id: "request-a",
        sessionId: "session-a",
        source: "builtin-tool",
        toolId: "exec.command",
        label: "run",
        risk: "exec",
        detail: "detail",
        arguments: { cwd: "C:/workspace" },
        resumeConversation: true,
      },
    ]);
  });

  it("roundtrips sessions with message reasoning", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();
    initializeRuntimeStateSchema(db);

    writeSessionsToDatabase(db, [
      {
        id: "session-a",
        title: "A",
        modelProfileId: "model-a",
        attachedDirectory: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        messages: [
          {
            id: "msg-a",
            role: "assistant",
            content: "hello",
            reasoning: "inspect files",
            createdAt: "2026-03-27T00:00:00.000Z",
          },
        ],
      },
    ]);

    const rows = readSessionsFromDatabase(db);
    db.close();

    expect(rows[0]?.messages[0]?.reasoning).toBe("inspect files");
    expect(rows[0]?.messages[0]?.content).toBe("hello");
  });

  it("roundtrips builtin tool preferences", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();
    initializeRuntimeStateSchema(db);

    writeBuiltinToolPreferencesToDatabase(db, [
      {
        toolId: "exec.command",
        enabled: true,
        exposedToModel: false,
        approvalModeOverride: "always-ask",
        updatedAt: "2026-03-27T00:00:00.000Z",
      },
    ]);

    const rows = readBuiltinToolPreferencesFromDatabase(db);
    db.close();

    expect(rows).toEqual([
      {
        toolId: "exec.command",
        enabled: true,
        exposedToModel: false,
        approvalModeOverride: "always-ask",
        updatedAt: "2026-03-27T00:00:00.000Z",
      },
    ]);
  });
});
