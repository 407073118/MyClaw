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
  owner_scope TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT,
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

CREATE TABLE IF NOT EXISTS awareness_routines (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  cadence_minutes INTEGER NOT NULL DEFAULT 30,
  next_run_at TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS awareness_signals (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'active',
  cooldown_until TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_fingerprint ON awareness_signals(fingerprint);
CREATE INDEX IF NOT EXISTS idx_signals_status ON awareness_signals(status);

CREATE TABLE IF NOT EXISTS standing_orders (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS long_run_ledger (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_heartbeat_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'not_required',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_kind_status ON long_run_ledger(kind, status);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON long_run_ledger(kind, source_id);

CREATE TABLE IF NOT EXISTS awareness_audit_events (
  id TEXT PRIMARY KEY,
  ledger_record_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  detail TEXT NOT NULL,
  standing_order_id TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ledger ON awareness_audit_events(ledger_record_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON awareness_audit_events(timestamp);
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
  private _batchDepth = 0;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;

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
    instance.migrateScheduleJobOwnerColumns();
    instance.migrateAwarenessTables();
    instance.flush();
    return instance;
  }

  /**
   * 补齐定时任务 owner 列，确保历史 time.db 也能按主日程/硅基员工拆分查询。
   */
  private migrateScheduleJobOwnerColumns(): void {
    console.info("[time-db] 检查定时任务归属列", { dbPath: this.dbPath });
    const columnsResult = this.db.exec("PRAGMA table_info(schedule_jobs)");
    const columnNames = new Set((columnsResult[0]?.values ?? []).map((row) => String(row[1])));
    if (!columnNames.has("owner_scope")) {
      this.db.exec("ALTER TABLE schedule_jobs ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'personal';");
      this.dirty = true;
    }
    if (!columnNames.has("owner_id")) {
      this.db.exec("ALTER TABLE schedule_jobs ADD COLUMN owner_id TEXT;");
      this.dirty = true;
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_schedule_jobs_owner ON schedule_jobs(owner_scope, owner_id);");

    const rows = this.queryAll("SELECT id, payload_json FROM schedule_jobs");
    for (const row of rows) {
      try {
        const payload = JSON.parse(String(row.payload_json)) as { ownerScope?: string; ownerId?: string | null };
        const ownerScope = payload.ownerScope === "silicon_person" ? "silicon_person" : "personal";
        const ownerId = ownerScope === "silicon_person" ? payload.ownerId ?? null : null;
        this.run(
          "UPDATE schedule_jobs SET owner_scope = @owner_scope, owner_id = @owner_id WHERE id = @id",
          {
            id: String(row.id),
            owner_scope: ownerScope,
            owner_id: ownerId,
          },
        );
      } catch (error) {
        console.warn("[time-db] 回填定时任务归属列失败", {
          dbPath: this.dbPath,
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * 确保感知相关表结构完整，并保留旧库中的用户数据。
   * 旧 time.db 可能缺少后续版本新增列；这里只做按列迁移和索引补齐，禁止重建有数据的表。
   */
  private migrateAwarenessTables(): void {
    const ensureColumn = (table: string, column: string, definition: string): void => {
      const result = this.db.exec(`PRAGMA table_info(${table})`);
      const columns = new Set((result[0]?.values ?? []).map((row) => String(row[1])));
      if (columns.has(column)) return;
      console.info("[time-db] 补齐感知表缺失列", { table, column });
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      this.dirty = true;
    };

    ensureColumn("awareness_routines", "next_run_at", "TEXT");
    ensureColumn("awareness_routines", "payload_json", "TEXT");
    ensureColumn("awareness_signals", "payload_json", "TEXT");
    ensureColumn("standing_orders", "payload_json", "TEXT");
    ensureColumn("long_run_ledger", "payload_json", "TEXT");
    ensureColumn("awareness_audit_events", "payload_json", "TEXT");

    console.info("[time-db] 补齐感知表查询索引", { dbPath: this.dbPath });
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_awareness_routines_status_next_run ON awareness_routines(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_awareness_signals_fingerprint_status ON awareness_signals(fingerprint, status);
      CREATE INDEX IF NOT EXISTS idx_awareness_signals_source_status ON awareness_signals(status, source_kind, source_id);
      CREATE INDEX IF NOT EXISTS idx_signals_fingerprint ON awareness_signals(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_signals_status ON awareness_signals(status);
      CREATE INDEX IF NOT EXISTS idx_ledger_kind_status ON long_run_ledger(kind, status);
      CREATE INDEX IF NOT EXISTS idx_ledger_source ON long_run_ledger(kind, source_id);
      CREATE INDEX IF NOT EXISTS idx_long_run_ledger_status_updated ON long_run_ledger(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_audit_ledger ON awareness_audit_events(ledger_record_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON awareness_audit_events(timestamp);
    `);
    this.dirty = true;
  }

  /**
   * 执行写入语句，标记脏数据并安排延迟落盘。
   * 在 batch 回调内时不会触发独立 flush，由 batch 结束时统一落盘。
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
    // batch 内不单独 flush，由 batch 结束统一落盘
    if (this._batchDepth === 0) {
      this._scheduleDeferredFlush();
    }
  }

  /**
   * 批量执行写入操作，在整个回调结束后统一落盘一次，
   * 避免多次 run() 各自触发独立序列化。
   */
  batch<T>(fn: () => T): T {
    this._batchDepth++;
    // 进入 batch 后取消待执行的延迟 flush，由 batch 结束时统一处理
    if (this._batchDepth === 1 && this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    try {
      return fn();
    } finally {
      this._batchDepth--;
      if (this._batchDepth === 0) {
        this.flush();
      }
    }
  }

  /**
   * 安排 1 秒后自动 flush，确保不在 batch 内的单次写入也能最终落盘。
   */
  private _scheduleDeferredFlush(): void {
    if (this._flushTimer !== null) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, 1000);
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
    const stmt = this.db.prepare(sql);
    try {
      const bound = bindParams(params);
      if (bound) {
        stmt.bind(bound as any);
      }
      if (stmt.step()) {
        return stmt.getAsObject() as Record<string, unknown>;
      }
      return null;
    } finally {
      stmt.free();
    }
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
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this.dirty) {
      this.flush();
    }
    this.db.close();
  }
}
