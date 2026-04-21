import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  trigger_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_trigger_at ON reminders(trigger_at);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_commitments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  due_at TEXT,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  schedule_kind TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  next_run_at TEXT,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_policies (
  id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
`;

function bindParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const bound: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    bound[`@${key}`] = value === undefined ? null : value;
  }
  return bound;
}

export class TimeOrchestrationDatabase {
  private dirty = false;

  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
  ) {}

  /**
   * 创建并初始化时间编排数据库，负责加载磁盘数据与建表。
   */
  static async create(dbPath: string): Promise<TimeOrchestrationDatabase> {
    console.info("[time-db] 初始化时间编排数据库", { dbPath });
    const SQL = await initSqlJs();
    let db: Database;
    if (existsSync(dbPath)) {
      db = new SQL.Database(readFileSync(dbPath));
    } else {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      db = new SQL.Database();
    }

    const instance = new TimeOrchestrationDatabase(db, dbPath);
    instance.db.exec(SCHEMA_SQL);
    instance.flush();
    return instance;
  }

  /**
   * 执行写入语句，并在成功后立即落盘到 `time.db`。
   */
  run(sql: string, params?: Record<string, unknown>): void {
    console.info("[time-db] 执行写入语句", { dbPath: this.dbPath });
    const stmt = this.db.prepare(sql);
    try {
      const bound = bindParams(params);
      if (bound) {
        stmt.bind(bound as any);
      }
      stmt.step();
      this.dirty = true;
    } finally {
      stmt.free();
    }
    this.flush();
  }

  /**
   * 查询多行记录，供上层 store 组装领域对象。
   */
  queryAll(sql: string, params?: Record<string, unknown>): Array<Record<string, unknown>> {
    console.info("[time-db] 查询多行记录", { dbPath: this.dbPath });
    const stmt = this.db.prepare(sql);
    try {
      const bound = bindParams(params);
      if (bound) {
        stmt.bind(bound as any);
      }
      const rows: Array<Record<string, unknown>> = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  /**
   * 查询单行记录，未命中时返回 `null`。
   */
  queryOne(sql: string, params?: Record<string, unknown>): Record<string, unknown> | null {
    console.info("[time-db] 查询单行记录", { dbPath: this.dbPath });
    return this.queryAll(sql, params)[0] ?? null;
  }

  /**
   * 将内存数据库导出到磁盘，保证桌面端重启后状态可恢复。
   */
  flush(): void {
    if (!this.dirty && existsSync(this.dbPath)) {
      return;
    }
    console.info("[time-db] 持久化时间编排数据库", { dbPath: this.dbPath });
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
    this.dirty = false;
  }

  /**
   * 关闭数据库连接，并在必要时补做最后一次持久化。
   */
  close(): void {
    console.info("[time-db] 关闭时间编排数据库", { dbPath: this.dbPath });
    if (this.dirty) {
      this.flush();
    }
    this.db.close();
  }
}
