import type { SqlDatabase } from "./runtime-state-types";

/** 初始化 runtime-state SQLite schema，并补齐历史版本新增列。 */
export function initializeRuntimeStateSchema(db: SqlDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_profiles (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      headers_json TEXT,
      request_body_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      attached_directory TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reasoning TEXT,
      ui_json TEXT,
      PRIMARY KEY (session_id, id)
    );

    CREATE TABLE IF NOT EXISTS approval_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL,
      auto_approve_read_only INTEGER NOT NULL,
      auto_approve_skills INTEGER NOT NULL,
      always_allowed_tools_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_server_configs (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      transport TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      command TEXT,
      args_json TEXT,
      cwd TEXT,
      env_json TEXT,
      url TEXT,
      headers_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mcp_tool_preferences (
      tool_id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      exposed_to_model INTEGER NOT NULL,
      approval_mode_override TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS builtin_tool_preferences (
      tool_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      exposed_to_model INTEGER NOT NULL,
      approval_mode_override TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      label TEXT NOT NULL,
      risk TEXT NOT NULL,
      detail TEXT NOT NULL,
      arguments_json TEXT,
      resume_conversation INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS employees (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      workflow_ids_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      node_count INTEGER NOT NULL DEFAULT 0,
      edge_count INTEGER NOT NULL DEFAULT 0,
      library_root_id TEXT NOT NULL DEFAULT 'personal'
    );

    CREATE TABLE IF NOT EXISTS workflow_library_roots (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      writable INTEGER NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_records (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_work_items (
      position INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      workflow_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      due_at TEXT,
      expires_at TEXT,
      attempt_count INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      resume_policy_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureTableColumn(db, "messages", "ui_json", "TEXT");
  ensureTableColumn(db, "messages", "reasoning", "TEXT");
  ensureTableColumn(db, "model_profiles", "request_body_json", "TEXT");
  ensureTableColumn(db, "approval_requests", "arguments_json", "TEXT");
  ensureTableColumn(db, "approval_requests", "resume_conversation", "INTEGER NOT NULL DEFAULT 0");
  ensureTableColumn(db, "pending_work_items", "expires_at", "TEXT");
  ensureTableColumn(db, "workflows", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureTableColumn(db, "workflows", "node_count", "INTEGER NOT NULL DEFAULT 0");
  ensureTableColumn(db, "workflows", "edge_count", "INTEGER NOT NULL DEFAULT 0");
  ensureTableColumn(db, "workflows", "library_root_id", "TEXT NOT NULL DEFAULT 'personal'");
}

function ensureTableColumn(
  db: SqlDatabase,
  tableName: string,
  columnName: string,
  columnTypeDefinition: string,
): void {
  const columns = db.exec(`PRAGMA table_info(${tableName})`)[0]?.values ?? [];
  const hasColumn = columns.some((column) => String(column[1] ?? "") === columnName);
  if (!hasColumn) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnTypeDefinition}`);
  }
}
