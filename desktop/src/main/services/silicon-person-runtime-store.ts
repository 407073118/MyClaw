import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ChatSession,
  ChatMessage,
  ChatMessageContent,
  Task,
  ApprovalRequest,
} from "@shared/contracts";

// ── SQL schema ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  model_profile_id TEXT,
  runtime_version INTEGER DEFAULT 2,
  silicon_person_id TEXT,
  runtime_intent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  reasoning TEXT,
  created_at TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls TEXT,
  usage TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  owner TEXT,
  blocks TEXT DEFAULT '[]',
  blocked_by TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT,
  risk_category TEXT,
  arguments TEXT,
  decision TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id);

CREATE TABLE IF NOT EXISTS kv_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// ── Helpers ──

/** 将 ChatMessageContent 序列化为字符串：纯文本直接存储，多模态数组 JSON 序列化。 */
function serializeContent(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/** 反序列化 content：尝试 JSON.parse 还原多模态数组，失败则视为纯文本。 */
function deserializeContent(raw: string): ChatMessageContent {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 不是 JSON，返回原始字符串
  }
  return raw;
}

/** 安全解析 JSON 字符串，失败或 null 时返回 null。 */
function parseJsonOrNull(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── SiliconPersonRuntimeStore ──

export class SiliconPersonRuntimeStore {
  private db: Database | null = null;
  private dirty = false;

  constructor(private readonly dbPath: string) {}

  /** 必须在任何操作前调用一次，加载 WASM 并初始化数据库 */
  async init(): Promise<void> {
    const SQL = await initSqlJs();
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.db = new SQL.Database();
    }
    this.ensureDb().exec(SCHEMA_SQL);
    this.migrateSchema();
    this.flush();
  }

  /** 将数据库内容持久化到磁盘 */
  flush(): void {
    if (!this.db) return;
    const data = this.db.export();
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.dbPath, Buffer.from(data));
    this.dirty = false;
  }

  /** 关闭数据库连接，若有未持久化变更会先 flush */
  close(): void {
    if (this.dirty) this.flush();
    this.db?.close();
    this.db = null;
  }

  // ── Sessions ──

  /** 插入或更新 session 记录 */
  upsertSession(personId: string, session: ChatSession): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT OR REPLACE INTO sessions
       (id, person_id, title, status, model_profile_id, runtime_version, silicon_person_id, runtime_intent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        personId,
        session.title || "",
        "idle",
        session.modelProfileId || null,
        session.runtimeVersion ?? 2,
        session.siliconPersonId ?? null,
        session.runtimeIntent ? JSON.stringify(session.runtimeIntent) : null,
        session.createdAt || now,
        now,
      ],
    );
    this.dirty = true;
  }

  /** 根据 sessionId 获取单个 session 记录 */
  getSession(sessionId: string): Record<string, unknown> | null {
    const db = this.ensureDb();
    const stmt = db.prepare(
      `SELECT id, person_id, title, status, model_profile_id, runtime_version,
              silicon_person_id, runtime_intent, created_at, updated_at
       FROM sessions WHERE id = ?`,
    );
    stmt.bind([sessionId]);

    let result: Record<string, unknown> | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result = {
        id: row.id as string,
        personId: row.person_id as string,
        title: row.title as string,
        status: row.status as string,
        modelProfileId: (row.model_profile_id as string) || null,
        runtimeVersion: row.runtime_version as number,
        siliconPersonId: (row.silicon_person_id as string) || null,
        runtimeIntent: parseJsonOrNull(row.runtime_intent as string | null),
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };
    }
    stmt.free();
    return result;
  }

  /** 列出指定 personId 的所有 session，按创建时间倒序 */
  listSessions(personId: string): Array<Record<string, unknown>> {
    const db = this.ensureDb();
    const sessions: Array<Record<string, unknown>> = [];

    const stmt = db.prepare(
      `SELECT id, person_id, title, status, model_profile_id, runtime_version,
              silicon_person_id, runtime_intent, created_at, updated_at
       FROM sessions WHERE person_id = ?
       ORDER BY created_at DESC`,
    );
    stmt.bind([personId]);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      sessions.push({
        id: row.id as string,
        personId: row.person_id as string,
        title: row.title as string,
        status: row.status as string,
        modelProfileId: (row.model_profile_id as string) || null,
        runtimeVersion: row.runtime_version as number,
        siliconPersonId: (row.silicon_person_id as string) || null,
        runtimeIntent: parseJsonOrNull(row.runtime_intent as string | null),
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      });
    }
    stmt.free();
    return sessions;
  }

  // ── Messages ──

  /** 插入一条消息 */
  insertMessage(sessionId: string, message: ChatMessage): void {
    const db = this.ensureDb();
    db.run(
      `INSERT INTO messages
       (id, session_id, role, content, reasoning, created_at, tool_call_id, tool_calls, usage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        sessionId,
        message.role,
        serializeContent(message.content),
        message.reasoning ?? null,
        message.createdAt,
        message.tool_call_id ?? null,
        message.tool_calls ? JSON.stringify(message.tool_calls) : null,
        message.usage ? JSON.stringify(message.usage) : null,
      ],
    );
    this.dirty = true;
  }

  /** 获取指定 session 的所有消息，按创建时间正序 */
  getMessages(sessionId: string): ChatMessage[] {
    const db = this.ensureDb();
    const messages: ChatMessage[] = [];

    const stmt = db.prepare(
      `SELECT id, session_id, role, content, reasoning, created_at,
              tool_call_id, tool_calls, usage
       FROM messages WHERE session_id = ?
       ORDER BY created_at ASC`,
    );
    stmt.bind([sessionId]);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const msg: ChatMessage = {
        id: row.id as string,
        role: row.role as ChatMessage["role"],
        content: deserializeContent(row.content as string),
        createdAt: row.created_at as string,
      };
      if (row.reasoning) msg.reasoning = row.reasoning as string;
      if (row.tool_call_id) msg.tool_call_id = row.tool_call_id as string;
      if (row.tool_calls) msg.tool_calls = JSON.parse(row.tool_calls as string);
      if (row.usage) msg.usage = JSON.parse(row.usage as string);
      messages.push(msg);
    }
    stmt.free();
    return messages;
  }

  /** 获取指定 session 的消息总数 */
  getMessageCount(sessionId: string): number {
    const db = this.ensureDb();
    const stmt = db.prepare(
      "SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ?",
    );
    stmt.bind([sessionId]);

    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      count = row.cnt as number;
    }
    stmt.free();
    return count;
  }

  // ── Tasks ──

  /** 插入或更新任务 */
  upsertTask(sessionId: string, task: Task): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT OR REPLACE INTO tasks
       (id, session_id, subject, description, status, owner, blocks, blocked_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        sessionId,
        task.subject,
        task.description || "",
        task.status,
        task.owner ?? null,
        JSON.stringify(task.blocks || []),
        JSON.stringify(task.blockedBy || []),
        now,
        now,
      ],
    );
    this.dirty = true;
  }

  /** 列出指定 session 的所有任务 */
  listTasks(sessionId: string): Task[] {
    const db = this.ensureDb();
    const tasks: Task[] = [];

    const stmt = db.prepare(
      `SELECT id, session_id, subject, description, status, owner,
              blocks, blocked_by, created_at, updated_at
       FROM tasks WHERE session_id = ?
       ORDER BY created_at ASC`,
    );
    stmt.bind([sessionId]);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      tasks.push({
        id: row.id as string,
        subject: row.subject as string,
        description: (row.description as string) || "",
        status: row.status as Task["status"],
        owner: (row.owner as string) || undefined,
        blocks: JSON.parse((row.blocks as string) || "[]"),
        blockedBy: JSON.parse((row.blocked_by as string) || "[]"),
      });
    }
    stmt.free();
    return tasks;
  }

  // ── Approvals ──

  /** 插入一条审批请求记录 */
  insertApproval(sessionId: string, approval: ApprovalRequest): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO approvals
       (id, session_id, tool_call_id, tool_name, risk_category, arguments, decision, decided_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        approval.id,
        sessionId,
        approval.toolId ?? null,
        approval.toolName ?? null,
        approval.risk ?? null,
        approval.arguments ? JSON.stringify(approval.arguments) : null,
        null,
        null,
        now,
      ],
    );
    this.dirty = true;
  }

  /** 列出指定 session 的所有审批请求 */
  listApprovals(sessionId: string): ApprovalRequest[] {
    const db = this.ensureDb();
    const approvals: ApprovalRequest[] = [];

    const stmt = db.prepare(
      `SELECT id, session_id, tool_call_id, tool_name, risk_category,
              arguments, decision, decided_at, created_at
       FROM approvals WHERE session_id = ?
       ORDER BY created_at ASC`,
    );
    stmt.bind([sessionId]);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const item: ApprovalRequest = {
        id: row.id as string,
        sessionId: row.session_id as string,
        source: "builtin-tool",
        toolId: (row.tool_call_id as string) || "",
        label: "",
        risk: (row.risk_category as ApprovalRequest["risk"]) || "read" as ApprovalRequest["risk"],
        detail: "",
      };
      if (row.tool_name) item.toolName = row.tool_name as string;
      if (row.arguments) item.arguments = JSON.parse(row.arguments as string);
      approvals.push(item);
    }
    stmt.free();
    return approvals;
  }

  // ── KV State ──

  /** 设置一个 key-value 对 */
  setKV(key: string, value: string): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT OR REPLACE INTO kv_state (key, value, updated_at)
       VALUES (?, ?, ?)`,
      [key, value, now],
    );
    this.dirty = true;
  }

  /** 获取指定 key 的值，不存在返回 null */
  getKV(key: string): string | null {
    const db = this.ensureDb();
    const stmt = db.prepare(
      "SELECT value FROM kv_state WHERE key = ?",
    );
    stmt.bind([key]);

    let result: string | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result = row.value as string;
    }
    stmt.free();
    return result;
  }

  // ── Private helpers ──

  /** 对已有数据库补充缺少的列（向前兼容旧版 schema）。 */
  private migrateSchema(): void {
    const db = this.ensureDb();
    try {
      const stmt = db.prepare("SELECT runtime_intent FROM sessions LIMIT 0");
      stmt.free();
    } catch {
      db.run("ALTER TABLE sessions ADD COLUMN runtime_intent TEXT");
    }
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error("[silicon-person-runtime-store] 数据库未初始化，请先调用 init()");
    }
    return this.db;
  }
}
