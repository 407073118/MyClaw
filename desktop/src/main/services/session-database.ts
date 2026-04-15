/**
 * 统一会话数据库服务。
 *
 * 使用 sql.js（纯 WASM SQLite）统一存储所有会话 + 消息，
 * 覆盖主聊天会话与硅基员工会话，提供：
 *   - 按日期分组 / 置顶 / 归档 / 搜索
 *   - FTS5 全文检索（消息内容 + 会话标题）
 *   - 按需加载消息（启动只读元数据）
 *
 * sql.js 是纯 JavaScript/WASM 实现，无需 C++ 编译，
 * 不会出现 NODE_MODULE_VERSION 不匹配的问题。
 */

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ArtifactEventRecord,
  ArtifactLink,
  ArtifactRecord,
  ArtifactScopeItem,
  ArtifactScopeKind,
  ChatMessage,
  ChatMessageContent,
  ChatMessageToolCall,
  ChatSession,
  MessageTokenUsage,
  SessionRuntimeVersion,
  Task,
} from "@shared/contracts";
import type { A2UiPayload } from "@shared/contracts";

// ─── 序列化辅助 ──────────────────────────────────────────────────────────────

/** 将 ChatMessageContent 序列化为字符串，纯文本原样保存，多模态数组序列化为 JSON。 */
function serializeContent(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/** 将存储的字符串反序列化为 ChatMessageContent。 */
function deserializeContent(stored: string): ChatMessageContent {
  if (!stored || !stored.startsWith("[")) return stored;
  try {
    const parsed = JSON.parse(stored);
    // 合法的多模态数组元素必须是含 type 字段的对象，防止将 ["hello"] 等纯文本误判为多模态
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      typeof parsed[0] === "object" &&
      parsed[0] !== null &&
      "type" in parsed[0]
    ) {
      return parsed as ChatMessageContent;
    }
  } catch {
    // 不是合法 JSON，当纯文本处理
  }
  return stored;
}

/** 从 ChatMessageContent 中提取纯文本用于全文搜索索引。 */
function extractText(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/** 将对象序列化为 JSON 字符串，undefined 返回 SQL NULL，null 序列化为 "null"。 */
function jsonOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

/**
 * 对需要区分 undefined/null 的可选字段做序列化。
 * 检查属性是否存在：不存在 → SQL NULL；存在（含 null） → JSON.stringify。
 */
function jsonOrNullOwn(obj: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  return JSON.stringify(obj[key]) ?? null;
}

/** 安全解析 JSON 字符串，SQL NULL 返回 undefined（保持字段缺省语义）。 */
function parseJsonOrUndef<T>(str: string | null | undefined): T | undefined {
  if (str == null) return undefined;
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}

/** 推导 session 最后活跃时间：取最后一条消息的 createdAt，无消息则用 session 的 createdAt。 */
function deriveUpdatedAt(session: ChatSession): string {
  const len = session.messages.length;
  if (len > 0) {
    return session.messages[len - 1].createdAt;
  }
  return session.createdAt;
}

/** 统计 session 中所有消息的 token 总量。 */
function deriveTotalTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += m.usage?.totalTokens ?? 0;
  }
  return total;
}

/** sql.js 绑定参数需要加 @ 前缀：{key: val} → {'@key': val}，undefined 转 null */
function bp(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[`@${key}`] = value === undefined ? null : value;
  }
  return result;
}

// ─── 导出类型 ────────────────────────────────────────────────────────────────

/** 消息全文搜索结果。 */
export type MessageSearchResult = {
  sessionId: string;
  sessionTitle: string;
  siliconPersonId: string | null;
  messageId: string;
  role: string;
  matchPreview: string;
  createdAt: string;
};

/** 会话搜索结果。 */
export type SessionSearchResult = {
  id: string;
  title: string;
  siliconPersonId: string | null;
  matchPreview: string;
  updatedAt: string;
};

/** 会话列表项元数据（不含消息内容）。 */
export type SessionListItem = {
  id: string;
  title: string;
  modelProfileId: string;
  siliconPersonId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  messageCount: number;
  totalTokens: number;
  summary: string | null;
  dateGroup: string;
  createdAt: string;
  updatedAt: string;
};

// ─── 常量 ────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 2;

// ─── Schema SQL ──────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- 版本跟踪
CREATE TABLE IF NOT EXISTS _schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 会话表（主聊天 + 硅基员工共用，silicon_person_id 为空则为主聊天）
CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL DEFAULT '新对话',
  model_profile_id    TEXT,
  attached_directory  TEXT,
  silicon_person_id   TEXT,
  is_pinned           INTEGER NOT NULL DEFAULT 0,
  is_archived         INTEGER NOT NULL DEFAULT 0,
  folder              TEXT,
  tags                TEXT DEFAULT '[]',
  message_count       INTEGER NOT NULL DEFAULT 0,
  total_tokens        INTEGER NOT NULL DEFAULT 0,
  summary             TEXT,
  runtime_version     INTEGER,
  runtime_intent      TEXT,
  execution_plan      TEXT,
  turn_execution_plan TEXT,
  last_turn_outcome_id TEXT,
  plan_mode_state     TEXT,
  plan_state          TEXT,
  chat_run_state      TEXT,
  tasks               TEXT,
  sp_status           TEXT,
  sp_unread_count     INTEGER DEFAULT 0,
  sp_has_unread       INTEGER DEFAULT 0,
  sp_needs_approval   INTEGER DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_person  ON sessions(silicon_person_id);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT NOT NULL,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  content_text  TEXT NOT NULL DEFAULT '',
  reasoning     TEXT,
  tool_calls    TEXT,
  tool_call_id  TEXT,
  ui_payload    TEXT,
  usage_prompt     INTEGER DEFAULT 0,
  usage_completion INTEGER DEFAULT 0,
  usage_total      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_session_seq ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_msg_id          ON messages(id);

CREATE TABLE IF NOT EXISTS artifacts (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL,
  mime_type      TEXT,
  storage_class  TEXT NOT NULL,
  lifecycle      TEXT NOT NULL,
  status         TEXT NOT NULL,
  relative_path  TEXT NOT NULL,
  size_bytes     INTEGER,
  sha256         TEXT,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_opened_at TEXT,
  open_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_artifacts_updated_at
  ON artifacts(updated_at DESC);

CREATE TABLE IF NOT EXISTS artifact_links (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  scope_kind  TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  relation    TEXT NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (artifact_id, scope_kind, scope_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_artifact_links_scope
  ON artifact_links(scope_kind, scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS artifact_events (
  id          TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  payload_json TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_events_artifact
  ON artifact_events(artifact_id, created_at DESC);
`;

/**
 * FTS5 及触发器不支持 IF NOT EXISTS 的虚拟表 content-sync 模式，
 * 放在独立语句中，由 initSchema() 做幂等判断后执行。
 */
const FTS_SCHEMA_SQL = `
-- 消息全文搜索
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content_text,
  content=messages,
  content_rowid=rowid,
  tokenize='unicode61'
);

CREATE TRIGGER msg_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content_text) VALUES (new.rowid, new.content_text);
END;

CREATE TRIGGER msg_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content_text)
  VALUES('delete', old.rowid, old.content_text);
END;

CREATE TRIGGER msg_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content_text)
  VALUES('delete', old.rowid, old.content_text);
  INSERT INTO messages_fts(rowid, content_text) VALUES (new.rowid, new.content_text);
END;

-- 会话标题/摘要全文搜索
CREATE VIRTUAL TABLE sessions_fts USING fts5(
  title,
  summary,
  content=sessions,
  content_rowid=rowid,
  tokenize='unicode61'
);

CREATE TRIGGER session_fts_ai AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts(rowid, title, summary)
  VALUES (new.rowid, new.title, COALESCE(new.summary, ''));
END;

CREATE TRIGGER session_fts_ad AFTER DELETE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, title, summary)
  VALUES('delete', old.rowid, old.title, COALESCE(old.summary, ''));
END;

CREATE TRIGGER session_fts_au AFTER UPDATE OF title, summary ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, title, summary)
  VALUES('delete', old.rowid, old.title, COALESCE(old.summary, ''));
  INSERT INTO sessions_fts(rowid, title, summary)
  VALUES (new.rowid, new.title, COALESCE(new.summary, ''));
END;
`;

// ─── SQL 语句 ────────────────────────────────────────────────────────────────

const UPSERT_SESSION_SQL = `
  INSERT INTO sessions (
    id, title, model_profile_id, attached_directory, silicon_person_id,
    is_pinned, is_archived, folder, tags,
    message_count, total_tokens, summary,
    runtime_version, runtime_intent, execution_plan, turn_execution_plan,
    last_turn_outcome_id, plan_mode_state, plan_state, chat_run_state, tasks,
    sp_status, sp_unread_count, sp_has_unread, sp_needs_approval,
    created_at, updated_at
  ) VALUES (
    @id, @title, @model_profile_id, @attached_directory, @silicon_person_id,
    0, 0, NULL, '[]',
    @message_count, @total_tokens, NULL,
    @runtime_version, @runtime_intent, @execution_plan, @turn_execution_plan,
    @last_turn_outcome_id, @plan_mode_state, @plan_state, @chat_run_state, @tasks,
    @sp_status, @sp_unread_count, @sp_has_unread, @sp_needs_approval,
    @created_at, @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    title               = excluded.title,
    model_profile_id    = excluded.model_profile_id,
    attached_directory  = excluded.attached_directory,
    silicon_person_id   = excluded.silicon_person_id,
    message_count       = excluded.message_count,
    total_tokens        = excluded.total_tokens,
    runtime_version     = excluded.runtime_version,
    runtime_intent      = excluded.runtime_intent,
    execution_plan      = excluded.execution_plan,
    turn_execution_plan = excluded.turn_execution_plan,
    last_turn_outcome_id = excluded.last_turn_outcome_id,
    plan_mode_state     = excluded.plan_mode_state,
    plan_state          = excluded.plan_state,
    chat_run_state      = excluded.chat_run_state,
    tasks               = excluded.tasks,
    updated_at          = excluded.updated_at
`;

const INSERT_MESSAGE_SQL = `
  INSERT INTO messages (
    id, session_id, seq, role, content, content_text,
    reasoning, tool_calls, tool_call_id, ui_payload,
    usage_prompt, usage_completion, usage_total, created_at
  ) VALUES (
    @id, @session_id, @seq, @role, @content, @content_text,
    @reasoning, @tool_calls, @tool_call_id, @ui_payload,
    @usage_prompt, @usage_completion, @usage_total, @created_at
  )
`;

// ─── sql.js 引擎缓存 ────────────────────────────────────────────────────────

/** 缓存 sql.js 初始化 Promise，确保并发调用只加载一次 WASM。 */
let _sqlJsPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;
let _cachedSqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function ensureSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (_cachedSqlJs) return _cachedSqlJs;
  if (!_sqlJsPromise) {
    _sqlJsPromise = initSqlJs();
  }
  _cachedSqlJs = await _sqlJsPromise;
  return _cachedSqlJs;
}

// ─── 主类 ────────────────────────────────────────────────────────────────────

export class SessionDatabase {
  private db: Database;
  private dbPath: string;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /** 异步工厂方法：加载 WASM 引擎并初始化数据库。 */
  static async create(dbPath: string): Promise<SessionDatabase> {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const SQL = await ensureSqlJs();
    return SessionDatabase._createWithModule(SQL, dbPath);
  }

  /** 同步工厂方法：复用已加载的 WASM 引擎（仅在 create 曾被调用后可用）。 */
  static createSync(dbPath: string): SessionDatabase {
    if (!_cachedSqlJs) {
      throw new Error("[session-database] sql.js 引擎未初始化，请先调用 SessionDatabase.create()");
    }
    return SessionDatabase._createWithModule(_cachedSqlJs, dbPath);
  }

  private static _createWithModule(SQL: Awaited<ReturnType<typeof initSqlJs>>, dbPath: string): SessionDatabase {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    let db: Database;
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
    const instance = new SessionDatabase(db, dbPath);
    instance.db.run("PRAGMA foreign_keys = ON");
    instance.initSchema();
    return instance;
  }

  // ─── 底层辅助 ─────────────────────────────────────────────────────────────

  /**
   * 将内存数据库原子写入磁盘。
   * 先写临时文件，再 rename，防止崩溃时写半截导致文件损坏。
   */
  private flush(): void {
    const data = this.db.export();
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.dbPath}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, Buffer.from(data));
    renameSync(tmpPath, this.dbPath);
  }

  /** 执行写操作（INSERT/UPDATE/DELETE）。 */
  private run(sql: string, params?: Record<string, unknown>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.db.run(sql, params ? bp(params) as any : undefined);
  }

  /** 查询单行，无结果返回 undefined。 */
  private queryOne(sql: string, params?: Record<string, unknown>): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(sql);
    try {
      // sql.js 运行时支持 named object params，但 TS 类型定义只声明了 array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (params) stmt.bind(bp(params) as any);
      return stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
    } finally {
      stmt.free();
    }
  }

  /** 查询多行。 */
  private queryAll(sql: string, params?: Record<string, unknown>): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (params) stmt.bind(bp(params) as any);
      const results: Record<string, unknown>[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  /** 在事务中执行回调，失败自动回滚。 */
  private transaction(fn: () => void): void {
    this.db.run("BEGIN TRANSACTION");
    try {
      fn();
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
  }

  // ─── Schema 初始化 ───────────────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);

    // FTS5 全文搜索：sql.js 默认 WASM 构建不含 fts5 模块。
    // 检测 fts5 是否可用；不可用时必须清理旧数据库中可能残留的 FTS 触发器和虚拟表，
    // 否则 INSERT/UPDATE/DELETE 会因触发器引用不存在的 fts5 模块而报错。
    let fts5Available = false;
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(x)");
      this.db.exec("DROP TABLE IF EXISTS _fts5_probe");
      fts5Available = true;
    } catch {
      // fts5 模块不可用
    }

    if (fts5Available) {
      const hasFts = this.queryOne(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'",
      );
      if (!hasFts) {
        this.db.exec(FTS_SCHEMA_SQL);
      }
    } else {
      // 清理可能由 better-sqlite3 时代创建的 FTS 触发器和虚拟表
      this.db.exec(`
        DROP TRIGGER IF EXISTS msg_fts_ai;
        DROP TRIGGER IF EXISTS msg_fts_ad;
        DROP TRIGGER IF EXISTS msg_fts_au;
        DROP TRIGGER IF EXISTS session_fts_ai;
        DROP TRIGGER IF EXISTS session_fts_ad;
        DROP TRIGGER IF EXISTS session_fts_au;
      `);
      // 虚拟表需要单独 try-catch，因为 DROP 也可能触发 fts5 模块加载
      for (const table of ["messages_fts", "sessions_fts"]) {
        try {
          this.db.exec(`DROP TABLE IF EXISTS ${table}`);
        } catch {
          // 虚拟表删除失败不影响核心功能
        }
      }
      console.warn("[session-database] FTS5 不可用，已清理残留的 FTS 索引，全文搜索功能禁用");
    }

    // 写入 schema 版本
    this.run(
      "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES (@key, @value)",
      { key: "version", value: String(SCHEMA_VERSION) },
    );

    this.flush();
  }

  // ─── 会话总数（用于迁移判断） ──────────────────────────────────────────────

  getSessionCount(): number {
    const row = this.queryOne("SELECT COUNT(*) AS cnt FROM sessions");
    return (row?.cnt as number) ?? 0;
  }

  // ─── 保存会话（元数据 + 消息） ─────────────────────────────────────────────

  /** 保存完整会话，包括元数据和消息列表。使用事务保证原子性。 */
  saveSession(session: ChatSession): void {
    this.transaction(() => this._saveSessionInner(session));
    this.flush();
  }

  private _saveSessionInner(session: ChatSession): void {
    const updatedAt = deriveUpdatedAt(session);
    const totalTokens = deriveTotalTokens(session.messages);

    // 1. Upsert 会话元数据
    this.run(UPSERT_SESSION_SQL, {
      id: session.id,
      title: session.title,
      model_profile_id: session.modelProfileId || null,
      attached_directory: session.attachedDirectory ?? null,
      silicon_person_id: session.siliconPersonId ?? null,
      message_count: session.messages.length,
      total_tokens: totalTokens,
      runtime_version: session.runtimeVersion ?? null,
      runtime_intent: jsonOrNull(session.runtimeIntent),
      execution_plan: jsonOrNull(session.executionPlan),
      turn_execution_plan: jsonOrNull(session.turnExecutionPlan),
      last_turn_outcome_id: session.lastTurnOutcomeId ?? null,
      plan_mode_state: jsonOrNullOwn(session as unknown as Record<string, unknown>, "planModeState"),
      plan_state: jsonOrNullOwn(session as unknown as Record<string, unknown>, "planState"),
      chat_run_state: jsonOrNull(session.chatRunState),
      tasks: jsonOrNullOwn(session as unknown as Record<string, unknown>, "tasks"),
      sp_status: null,
      sp_unread_count: 0,
      sp_has_unread: 0,
      sp_needs_approval: 0,
      created_at: session.createdAt,
      updated_at: updatedAt,
    });

    // 2. 全量替换消息（删除旧消息后重新插入）
    this.run("DELETE FROM messages WHERE session_id = @session_id", { session_id: session.id });

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      this.run(INSERT_MESSAGE_SQL, {
        id: msg.id,
        session_id: session.id,
        seq: i,
        role: msg.role,
        content: serializeContent(msg.content),
        content_text: extractText(msg.content),
        reasoning: msg.reasoning ?? null,
        tool_calls: jsonOrNull(msg.tool_calls),
        tool_call_id: msg.tool_call_id ?? null,
        ui_payload: jsonOrNull(msg.ui),
        usage_prompt: msg.usage?.promptTokens ?? 0,
        usage_completion: msg.usage?.completionTokens ?? 0,
        usage_total: msg.usage?.totalTokens ?? 0,
        created_at: msg.createdAt,
      });
    }
  }

  // ─── 加载会话 ──────────────────────────────────────────────────────────────

  /** 从 DB 行还原完整 ChatSession 对象。 */
  private hydrateSession(row: Record<string, unknown>, messages: ChatMessage[]): ChatSession {
    const session: ChatSession = {
      id: row.id as string,
      title: row.title as string,
      modelProfileId: (row.model_profile_id as string) || "",
      attachedDirectory: (row.attached_directory as string) || null,
      createdAt: row.created_at as string,
      messages,
    };

    // 可选字段：仅在 DB 中有值时才赋予，保持与旧 JSON hydrate 行为一致
    if (row.silicon_person_id != null) {
      session.siliconPersonId = row.silicon_person_id as string;
    }
    if (row.runtime_version != null) {
      session.runtimeVersion = row.runtime_version as SessionRuntimeVersion;
    }
    if (row.runtime_intent != null) {
      session.runtimeIntent = parseJsonOrUndef(row.runtime_intent as string) ?? null;
    }
    if (row.execution_plan != null) {
      session.executionPlan = parseJsonOrUndef(row.execution_plan as string) ?? null;
    }
    if (row.turn_execution_plan != null) {
      session.turnExecutionPlan = parseJsonOrUndef(row.turn_execution_plan as string) ?? null;
    }
    if (row.last_turn_outcome_id != null) {
      session.lastTurnOutcomeId = row.last_turn_outcome_id as string;
    }
    // planModeState / planState / tasks 需要区分 undefined（字段不存在）和 null（显式置空）
    // SQL NULL → 不设置（undefined）；JSON 字符串 "null" → null；JSON 对象 → 对象值
    if (row.plan_mode_state != null) {
      session.planModeState = JSON.parse(row.plan_mode_state as string);
    }
    if (row.plan_state != null) {
      session.planState = JSON.parse(row.plan_state as string);
    }
    if (row.chat_run_state != null) {
      session.chatRunState = parseJsonOrUndef(row.chat_run_state as string) ?? null;
    }
    if (row.tasks != null) {
      session.tasks = JSON.parse(row.tasks as string);
    }

    return session;
  }

  /** 从 DB 行还原 ChatMessage 对象。 */
  private hydrateMessage(row: Record<string, unknown>): ChatMessage {
    const msg: ChatMessage = {
      id: row.id as string,
      role: row.role as ChatMessage["role"],
      content: deserializeContent(row.content as string),
      createdAt: row.created_at as string,
    };
    if (row.reasoning) {
      msg.reasoning = row.reasoning as string;
    }
    if (row.tool_calls) {
      msg.tool_calls = JSON.parse(row.tool_calls as string) as ChatMessageToolCall[];
    }
    if (row.tool_call_id) {
      msg.tool_call_id = row.tool_call_id as string;
    }
    if (row.ui_payload) {
      msg.ui = JSON.parse(row.ui_payload as string) as A2UiPayload;
    }
    const promptTokens = row.usage_prompt as number;
    const completionTokens = row.usage_completion as number;
    const totalTokens = row.usage_total as number;
    if (totalTokens > 0 || promptTokens > 0 || completionTokens > 0) {
      msg.usage = {
        promptTokens,
        completionTokens,
        totalTokens,
      } as MessageTokenUsage;
    }
    return msg;
  }

  /** 将 DB 行还原为 ArtifactRecord。 */
  private hydrateArtifact(row: Record<string, unknown>): ArtifactRecord {
    return {
      id: row.id as string,
      title: row.title as string,
      kind: row.kind as ArtifactRecord["kind"],
      mimeType: (row.mime_type as string) || null,
      storageClass: row.storage_class as ArtifactRecord["storageClass"],
      lifecycle: row.lifecycle as ArtifactRecord["lifecycle"],
      status: row.status as ArtifactRecord["status"],
      relativePath: row.relative_path as string,
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      sha256: (row.sha256 as string) || null,
      metadata: parseJsonOrUndef<Record<string, unknown>>(row.metadata_json as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      lastOpenedAt: (row.last_opened_at as string) || null,
      openCount: Number(row.open_count ?? 0),
    };
  }

  /** 将 DB 行还原为 ArtifactLink。 */
  private hydrateArtifactLink(row: Record<string, unknown>): ArtifactLink {
    return {
      artifactId: row.artifact_id as string,
      scopeKind: row.scope_kind as ArtifactScopeKind,
      scopeId: row.scope_id as string,
      relation: row.relation as ArtifactLink["relation"],
      isPrimary: Number(row.is_primary ?? 0) === 1,
      createdAt: row.created_at as string,
    };
  }

  /** 将 DB 行还原为 ArtifactEventRecord。 */
  private hydrateArtifactEvent(row: Record<string, unknown>): ArtifactEventRecord {
    return {
      id: row.id as string,
      artifactId: row.artifact_id as string,
      eventType: row.event_type as ArtifactEventRecord["eventType"],
      payload: parseJsonOrUndef<Record<string, unknown>>(row.payload_json as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  }

  /** 加载所有会话（含消息）。启动时调用。 */
  loadAllSessions(): ChatSession[] {
    const sessionRows = this.queryAll(
      "SELECT * FROM sessions ORDER BY is_pinned DESC, updated_at DESC",
    );
    if (sessionRows.length === 0) return [];

    // 一次性加载所有消息并按 session_id 分组，避免 N+1
    const allMessages = this.queryAll(
      "SELECT * FROM messages ORDER BY session_id, seq ASC",
    );

    const messagesBySession = new Map<string, ChatMessage[]>();
    for (const row of allMessages) {
      const sessionId = row.session_id as string;
      let list = messagesBySession.get(sessionId);
      if (!list) {
        list = [];
        messagesBySession.set(sessionId, list);
      }
      list.push(this.hydrateMessage(row));
    }

    return sessionRows.map((row) =>
      this.hydrateSession(row, messagesBySession.get(row.id as string) ?? []),
    );
  }

  /** 加载单个会话（含消息）。 */
  getSession(id: string): ChatSession | null {
    const row = this.queryOne("SELECT * FROM sessions WHERE id = @id", { id });
    if (!row) return null;

    const messageRows = this.queryAll(
      "SELECT * FROM messages WHERE session_id = @session_id ORDER BY seq ASC",
      { session_id: id },
    );
    const messages = messageRows.map((r) => this.hydrateMessage(r));
    return this.hydrateSession(row, messages);
  }

  /** 获取指定会话的消息（分页加载）。 */
  getMessages(sessionId: string, limit: number, offset: number): ChatMessage[] {
    const rows = this.queryAll(
      "SELECT * FROM messages WHERE session_id = @session_id ORDER BY seq ASC LIMIT @limit OFFSET @offset",
      { session_id: sessionId, limit, offset },
    );
    return rows.map((r) => this.hydrateMessage(r));
  }

  // ─── 删除会话 ──────────────────────────────────────────────────────────────

  /** 删除会话及其所有消息（CASCADE 自动清理消息和 FTS）。 */
  deleteSession(id: string): void {
    this.run("DELETE FROM sessions WHERE id = @id", { id });
    this.flush();
  }

  // ─── 会话管理 ──────────────────────────────────────────────────────────────

  /** 置顶/取消置顶。 */
  pinSession(id: string, pinned: boolean): void {
    this.run("UPDATE sessions SET is_pinned = @is_pinned WHERE id = @id", {
      id,
      is_pinned: pinned ? 1 : 0,
    });
    this.flush();
  }

  /** 归档/取消归档。 */
  archiveSession(id: string, archived: boolean): void {
    this.run("UPDATE sessions SET is_archived = @is_archived WHERE id = @id", {
      id,
      is_archived: archived ? 1 : 0,
    });
    this.flush();
  }

  /** 重命名会话。 */
  renameSession(id: string, title: string): void {
    this.run("UPDATE sessions SET title = @title, updated_at = @updated_at WHERE id = @id", {
      id,
      title,
      updated_at: new Date().toISOString(),
    });
    this.flush();
  }

  /** 更新硅基员工会话状态字段。 */
  updateSiliconPersonSessionStatus(
    sessionId: string,
    status: {
      spStatus: string | null;
      spUnreadCount: number;
      spHasUnread: boolean;
      spNeedsApproval: boolean;
    },
  ): void {
    this.run(
      `UPDATE sessions SET
        sp_status         = @sp_status,
        sp_unread_count   = @sp_unread_count,
        sp_has_unread     = @sp_has_unread,
        sp_needs_approval = @sp_needs_approval
      WHERE id = @id`,
      {
        id: sessionId,
        sp_status: status.spStatus,
        sp_unread_count: status.spUnreadCount,
        sp_has_unread: status.spHasUnread ? 1 : 0,
        sp_needs_approval: status.spNeedsApproval ? 1 : 0,
      },
    );
    this.flush();
  }

  // ─── 会话列表（元数据，不含消息） ──────────────────────────────────────────

  /** 返回按日期分组的会话元数据列表，供侧边栏展示。 */
  listSessionMetas(filter?: {
    siliconPersonId?: string | null;
    includeArchived?: boolean;
  }): SessionListItem[] {
    let sql = `
      SELECT *,
        CASE
          WHEN date(updated_at, 'localtime') = date('now', 'localtime') THEN '今天'
          WHEN date(updated_at, 'localtime') = date('now', '-1 day', 'localtime') THEN '昨天'
          WHEN updated_at >= date('now', '-7 days', 'localtime') THEN '本周'
          WHEN updated_at >= date('now', '-30 days', 'localtime') THEN '本月'
          ELSE '更早'
        END AS date_group
      FROM sessions
      WHERE 1=1
    `;
    const params: Record<string, unknown> = {};

    if (filter?.siliconPersonId === null) {
      sql += " AND silicon_person_id IS NULL";
    } else if (filter?.siliconPersonId) {
      sql += " AND silicon_person_id = @silicon_person_id";
      params.silicon_person_id = filter.siliconPersonId;
    }

    if (!filter?.includeArchived) {
      sql += " AND is_archived = 0";
    }

    sql += " ORDER BY is_pinned DESC, updated_at DESC";

    const rows = this.queryAll(sql, Object.keys(params).length > 0 ? params : undefined);
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      modelProfileId: (row.model_profile_id as string) || "",
      siliconPersonId: (row.silicon_person_id as string) || null,
      isPinned: (row.is_pinned as number) === 1,
      isArchived: (row.is_archived as number) === 1,
      messageCount: row.message_count as number,
      totalTokens: row.total_tokens as number,
      summary: (row.summary as string) || null,
      dateGroup: row.date_group as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  // ─── 全文搜索 ──────────────────────────────────────────────────────────────

  /** 搜索消息内容，返回匹配片段及所属会话信息。 */
  searchMessages(query: string, limit = 20): MessageSearchResult[] {
    if (!query.trim()) return [];
    try {
      const rows = this.queryAll(
        `SELECT
          m.id          AS message_id,
          m.session_id  AS session_id,
          m.role        AS role,
          m.created_at  AS created_at,
          s.title       AS session_title,
          s.silicon_person_id AS silicon_person_id,
          snippet(messages_fts, 0, '<mark>', '</mark>', '…', 48) AS match_preview
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        JOIN sessions s ON m.session_id = s.id
        WHERE messages_fts MATCH @query
        ORDER BY messages_fts.rank
        LIMIT @limit`,
        { query, limit },
      );
      return rows.map((row) => ({
        sessionId: row.session_id as string,
        sessionTitle: row.session_title as string,
        siliconPersonId: (row.silicon_person_id as string) || null,
        messageId: row.message_id as string,
        role: row.role as string,
        matchPreview: row.match_preview as string,
        createdAt: row.created_at as string,
      }));
    } catch {
      // FTS query 语法错误时返回空结果（用户输入可能包含特殊字符）
      return [];
    }
  }

  /** 搜索会话标题和摘要。 */
  searchSessions(query: string, limit = 20): SessionSearchResult[] {
    if (!query.trim()) return [];
    try {
      const rows = this.queryAll(
        `SELECT
          s.id                AS id,
          s.silicon_person_id AS silicon_person_id,
          s.updated_at        AS updated_at,
          snippet(sessions_fts, 0, '<mark>', '</mark>', '…', 32) AS title_preview,
          snippet(sessions_fts, 1, '<mark>', '</mark>', '…', 32) AS summary_preview
        FROM sessions_fts
        JOIN sessions s ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH @query
        ORDER BY sessions_fts.rank
        LIMIT @limit`,
        { query, limit },
      );
      return rows.map((row) => ({
        id: row.id as string,
        title: (row.title_preview as string) || "",
        siliconPersonId: (row.silicon_person_id as string) || null,
        matchPreview: (row.title_preview as string) || (row.summary_preview as string) || "",
        updatedAt: row.updated_at as string,
      }));
    } catch {
      return [];
    }
  }

  // ─── 批量迁移 ──────────────────────────────────────────────────────────────

  /** 从旧 JSON 会话批量导入。在事务中完成以保证原子性。 */
  /** 保存或更新 artifact 元数据。 */
  saveArtifact(artifact: ArtifactRecord): void {
    this.run(
      `INSERT INTO artifacts (
        id, title, kind, mime_type, storage_class, lifecycle, status,
        relative_path, size_bytes, sha256, metadata_json,
        created_at, updated_at, last_opened_at, open_count
      ) VALUES (
        @id, @title, @kind, @mime_type, @storage_class, @lifecycle, @status,
        @relative_path, @size_bytes, @sha256, @metadata_json,
        @created_at, @updated_at, @last_opened_at, @open_count
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        kind = excluded.kind,
        mime_type = excluded.mime_type,
        storage_class = excluded.storage_class,
        lifecycle = excluded.lifecycle,
        status = excluded.status,
        relative_path = excluded.relative_path,
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at,
        open_count = excluded.open_count`,
      {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        mime_type: artifact.mimeType,
        storage_class: artifact.storageClass,
        lifecycle: artifact.lifecycle,
        status: artifact.status,
        relative_path: artifact.relativePath,
        size_bytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        metadata_json: jsonOrNull(artifact.metadata),
        created_at: artifact.createdAt,
        updated_at: artifact.updatedAt,
        last_opened_at: artifact.lastOpenedAt,
        open_count: artifact.openCount,
      },
    );
    this.flush();
  }

  /** 读取单个 artifact。 */
  getArtifact(id: string): ArtifactRecord | null {
    const row = this.queryOne("SELECT * FROM artifacts WHERE id = @id", { id });
    return row ? this.hydrateArtifact(row) : null;
  }

  /** 列出最近更新的 artifacts。 */
  listRecentArtifacts(limit = 20): ArtifactRecord[] {
    return this.queryAll(
      "SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT @limit",
      { limit },
    ).map((row) => this.hydrateArtifact(row));
  }

  /** 按 scope 列出 artifacts，并附带关联信息。 */
  listArtifactsByScope(scopeKind: ArtifactScopeKind, scopeId: string): ArtifactScopeItem[] {
    const rows = this.queryAll(
      `SELECT a.*
       FROM artifact_links l
       JOIN artifacts a ON a.id = l.artifact_id
       WHERE l.scope_kind = @scope_kind AND l.scope_id = @scope_id
       GROUP BY a.id
       ORDER BY a.updated_at DESC`,
      {
        scope_kind: scopeKind,
        scope_id: scopeId,
      },
    );

    return rows.map((row) => {
      const artifact = this.hydrateArtifact(row);
      return {
        ...artifact,
        links: this.listArtifactLinks(artifact.id),
      };
    });
  }

  /** 保存 artifact 与 scope 的关联。 */
  saveArtifactLink(link: ArtifactLink): void {
    this.run(
      `INSERT INTO artifact_links (
        artifact_id, scope_kind, scope_id, relation, is_primary, created_at
      ) VALUES (
        @artifact_id, @scope_kind, @scope_id, @relation, @is_primary, @created_at
      )
      ON CONFLICT(artifact_id, scope_kind, scope_id, relation) DO UPDATE SET
        is_primary = excluded.is_primary,
        created_at = excluded.created_at`,
      {
        artifact_id: link.artifactId,
        scope_kind: link.scopeKind,
        scope_id: link.scopeId,
        relation: link.relation,
        is_primary: link.isPrimary ? 1 : 0,
        created_at: link.createdAt,
      },
    );
    this.flush();
  }

  /** 查询单个 artifact 的全部关联。 */
  listArtifactLinks(artifactId: string): ArtifactLink[] {
    return this.queryAll(
      `SELECT * FROM artifact_links
       WHERE artifact_id = @artifact_id
       ORDER BY created_at DESC`,
      { artifact_id: artifactId },
    ).map((row) => this.hydrateArtifactLink(row));
  }

  /** 保存 artifact 生命周期事件。 */
  saveArtifactEvent(event: ArtifactEventRecord): void {
    this.run(
      `INSERT INTO artifact_events (
        id, artifact_id, event_type, payload_json, created_at
      ) VALUES (
        @id, @artifact_id, @event_type, @payload_json, @created_at
      )`,
      {
        id: event.id,
        artifact_id: event.artifactId,
        event_type: event.eventType,
        payload_json: jsonOrNull(event.payload),
        created_at: event.createdAt,
      },
    );
    this.flush();
  }

  /** 读取 artifact 生命周期事件。 */
  listArtifactEvents(artifactId: string, limit = 20): ArtifactEventRecord[] {
    return this.queryAll(
      `SELECT * FROM artifact_events
       WHERE artifact_id = @artifact_id
       ORDER BY created_at DESC
       LIMIT @limit`,
      {
        artifact_id: artifactId,
        limit,
      },
    ).map((row) => this.hydrateArtifactEvent(row));
  }

  /** 更新 artifact 打开统计。 */
  markArtifactOpened(id: string, openedAt: string): void {
    this.run(
      `UPDATE artifacts
       SET last_opened_at = @opened_at,
           open_count = open_count + 1,
           updated_at = CASE
             WHEN updated_at > @opened_at THEN updated_at
             ELSE @opened_at
           END
       WHERE id = @id`,
      {
        id,
        opened_at: openedAt,
      },
    );
    this.flush();
  }

  migrateFromJson(sessions: ChatSession[]): void {
    this.transaction(() => {
      for (const session of sessions) {
        this._saveSessionInner(session);
      }
    });
    this.flush();
  }

  // ─── 生命周期 ──────────────────────────────────────────────────────────────

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close();
  }
}
