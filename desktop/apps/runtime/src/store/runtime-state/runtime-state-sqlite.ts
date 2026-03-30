import type initSqlJsType from "sql.js";

import { initializeRuntimeStateSchema } from "./runtime-state-schema";
import type { SqlDatabase, SqlJsRuntime } from "./runtime-state-types";

let sqlJsRuntimePromise: Promise<SqlJsRuntime> | null = null;

async function loadSqlJsRuntime(): Promise<SqlJsRuntime> {
  if (!sqlJsRuntimePromise) {
    // Use the asm build path to avoid sidecar wasm asset resolution issues in pkg snapshots.
    const initSqlJsAsm = (await import("sql.js/dist/sql-asm.js")).default as typeof initSqlJsType;
    sqlJsRuntimePromise = initSqlJsAsm();
  }

  return sqlJsRuntimePromise;
}

/** 打开 runtime-state 数据库并确保 schema 已就绪。 */
export async function openRuntimeStateDatabase(raw?: Uint8Array): Promise<SqlDatabase> {
  const sqlJsRuntime = await loadSqlJsRuntime();
  const db = raw ? new sqlJsRuntime.Database(raw) : new sqlJsRuntime.Database();
  initializeRuntimeStateSchema(db);
  return db;
}
