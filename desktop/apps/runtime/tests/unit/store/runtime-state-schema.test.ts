import { describe, expect, it } from "vitest";
import initSqlJsType from "sql.js";

import { initializeRuntimeStateSchema } from "../../../src/store/runtime-state/runtime-state-schema";

describe("runtime state schema", () => {
  it("creates all required runtime-state tables", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();

    initializeRuntimeStateSchema(db);

    const tableRows =
      db.exec(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name ASC
      `)[0]?.values ?? [];
    db.close();

    expect(tableRows.map((row) => String(row[0]))).toEqual([
      "app_state",
      "approval_policy",
      "approval_requests",
      "builtin_tool_preferences",
      "employees",
      "mcp_server_configs",
      "mcp_tool_preferences",
      "memory_records",
      "messages",
      "model_profiles",
      "pending_work_items",
      "sessions",
      "workflow_library_roots",
      "workflows",
    ]);
  });

  it("backfills required additive columns for legacy schema", async () => {
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    const sql = await initSqlJsAsm();
    const db = new sql.Database();

    db.run(`
      CREATE TABLE messages (
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );

      CREATE TABLE model_profiles (
        position INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        headers_json TEXT
      );

      CREATE TABLE approval_requests (
        position INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        label TEXT NOT NULL,
        risk TEXT NOT NULL,
        detail TEXT NOT NULL
      );

      CREATE TABLE pending_work_items (
        position INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        workflow_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        due_at TEXT,
        attempt_count INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        resume_policy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE workflows (
        position INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    initializeRuntimeStateSchema(db);

    const messageColumns = db.exec("PRAGMA table_info(messages)")[0]?.values?.map((row) => String(row[1])) ?? [];
    const modelColumns = db.exec("PRAGMA table_info(model_profiles)")[0]?.values?.map((row) => String(row[1])) ?? [];
    const requestColumns =
      db.exec("PRAGMA table_info(approval_requests)")[0]?.values?.map((row) => String(row[1])) ?? [];
    const pendingColumns =
      db.exec("PRAGMA table_info(pending_work_items)")[0]?.values?.map((row) => String(row[1])) ?? [];
    const workflowColumns = db.exec("PRAGMA table_info(workflows)")[0]?.values?.map((row) => String(row[1])) ?? [];
    db.close();

    expect(messageColumns).toContain("reasoning");
    expect(messageColumns).toContain("ui_json");
    expect(modelColumns).toContain("request_body_json");
    expect(requestColumns).toContain("arguments_json");
    expect(requestColumns).toContain("resume_conversation");
    expect(pendingColumns).toContain("expires_at");
    expect(workflowColumns).toContain("version");
    expect(workflowColumns).toContain("node_count");
    expect(workflowColumns).toContain("edge_count");
    expect(workflowColumns).toContain("library_root_id");
  });
});
