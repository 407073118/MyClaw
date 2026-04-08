import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WorkflowRunSummary, WorkflowCheckpointSummary } from "@shared/contracts/workflow-run";

// ── SQL schema ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  config TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  total_steps INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  parent_id TEXT,
  step INTEGER NOT NULL,
  status TEXT NOT NULL,
  channel_versions TEXT NOT NULL,
  versions_seen TEXT NOT NULL,
  triggered_nodes TEXT NOT NULL,
  duration_ms INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  interrupt_payload TEXT,
  PRIMARY KEY (thread_id, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS channel_blobs (
  thread_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (thread_id, channel_name, version)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_thread ON checkpoints(thread_id, step);
CREATE INDEX IF NOT EXISTS idx_runs_workflow ON workflow_runs(workflow_id);
`;

// ── Types ──

export type CreateRunInput = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  config: unknown;
};

export type SaveCheckpointInput = {
  runId: string;
  checkpointId: string;
  parentId: string | null;
  step: number;
  status: string;
  channelVersions: Record<string, number>;
  versionsSeen: Record<string, Record<string, number>>;
  triggeredNodes: string[];
  durationMs: number;
  interruptPayload?: unknown;
  channelData: Map<string, { version: number; value: unknown }>;
};

export type LatestCheckpointResult = {
  checkpointId: string;
  parentId: string | null;
  step: number;
  status: string;
  channelVersions: Record<string, number>;
  versionsSeen: Record<string, Record<string, number>>;
  triggeredNodes: string[];
  durationMs: number;
  createdAt: string;
  interruptPayload?: unknown;
};

// ── SqliteCheckpointer ──

export class SqliteCheckpointer {
  private db: Database | null = null;
  private dbPath: string;
  private dirty = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /** 必须在任何操作前调用一次，加载 WASM 并初始化数据库 */
  async init(): Promise<void> {
    const SQL = await initSqlJs();
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      // 确保目标目录存在
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.db = new SQL.Database();
    }
    this.createTables();
  }

  private createTables(): void {
    this.ensureDb().exec(SCHEMA_SQL);
  }

  /** 将数据库内容持久化到磁盘 */
  flush(): void {
    if (!this.db || !this.dirty) return;
    const data = this.db.export();
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.dbPath, Buffer.from(data));
    this.dirty = false;
  }

  // ── Run management ──

  createRun(input: CreateRunInput): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO workflow_runs (id, workflow_id, workflow_version, status, config, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.workflowId,
        input.workflowVersion,
        "queued",
        input.config != null ? JSON.stringify(input.config) : null,
        now,
        now,
      ],
    );
    this.dirty = true;
    this.flush();
  }

  updateRunStatus(
    runId: string,
    status: string,
    extra?: { error?: string; totalSteps?: number; finishedAt?: string },
  ): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const finishedAt = extra?.finishedAt ?? (isTerminalStatus(status) ? now : null);

    db.run(
      `UPDATE workflow_runs
       SET status = ?,
           updated_at = ?,
           finished_at = COALESCE(?, finished_at),
           total_steps = COALESCE(?, total_steps),
           error = COALESCE(?, error)
       WHERE id = ?`,
      [
        status,
        now,
        finishedAt,
        extra?.totalSteps ?? null,
        extra?.error ?? null,
        runId,
      ],
    );
    this.dirty = true;
    this.flush();
  }

  getRun(runId: string): WorkflowRunSummary | null {
    const db = this.ensureDb();
    const stmt = db.prepare(
      `SELECT id, workflow_id, workflow_version, status, started_at, updated_at,
              finished_at, total_steps, error
       FROM workflow_runs WHERE id = ?`,
    );
    stmt.bind([runId]);

    let result: WorkflowRunSummary | null = null;
    if (stmt.step()) {
      result = rowToRunSummary(stmt.getAsObject());
    }
    stmt.free();
    return result;
  }

  listRuns(workflowId?: string): WorkflowRunSummary[] {
    const db = this.ensureDb();
    const runs: WorkflowRunSummary[] = [];

    let sql = `SELECT id, workflow_id, workflow_version, status, started_at, updated_at,
                      finished_at, total_steps, error
               FROM workflow_runs`;
    const params: unknown[] = [];

    if (workflowId) {
      sql += " WHERE workflow_id = ?";
      params.push(workflowId);
    }
    sql += " ORDER BY started_at DESC";

    const stmt = db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {
      runs.push(rowToRunSummary(stmt.getAsObject()));
    }
    stmt.free();
    return runs;
  }

  // ── Checkpoint management ──

  saveCheckpoint(input: SaveCheckpointInput): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    db.run("BEGIN TRANSACTION");
    try {
      // 写入 checkpoint 记录
      db.run(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_id, parent_id, step, status, channel_versions,
          versions_seen, triggered_nodes, duration_ms, created_at, interrupt_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.runId,
          input.checkpointId,
          input.parentId,
          input.step,
          input.status,
          JSON.stringify(input.channelVersions),
          JSON.stringify(input.versionsSeen),
          JSON.stringify(input.triggeredNodes),
          input.durationMs,
          now,
          input.interruptPayload != null ? JSON.stringify(input.interruptPayload) : null,
        ],
      );

      // 写入每个变更过的 channel blob
      for (const [channelName, blob] of input.channelData) {
        db.run(
          `INSERT OR IGNORE INTO channel_blobs (thread_id, channel_name, version, value)
           VALUES (?, ?, ?, ?)`,
          [
            input.runId,
            channelName,
            blob.version,
            JSON.stringify(blob.value),
          ],
        );
      }

      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
    this.dirty = true;
    this.flush();
  }

  getLatestCheckpoint(runId: string): LatestCheckpointResult | null {
    const db = this.ensureDb();
    const stmt = db.prepare(
      `SELECT checkpoint_id, parent_id, step, status, channel_versions,
              versions_seen, triggered_nodes, duration_ms, created_at, interrupt_payload
       FROM checkpoints
       WHERE thread_id = ?
       ORDER BY step DESC
       LIMIT 1`,
    );
    stmt.bind([runId]);

    let result: LatestCheckpointResult | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result = {
        checkpointId: row.checkpoint_id as string,
        parentId: (row.parent_id as string) || null,
        step: row.step as number,
        status: row.status as string,
        channelVersions: JSON.parse(row.channel_versions as string),
        versionsSeen: JSON.parse(row.versions_seen as string),
        triggeredNodes: JSON.parse(row.triggered_nodes as string),
        durationMs: row.duration_ms as number,
        createdAt: row.created_at as string,
        interruptPayload: row.interrupt_payload
          ? JSON.parse(row.interrupt_payload as string)
          : undefined,
      };
    }
    stmt.free();
    return result;
  }

  listCheckpoints(runId: string): WorkflowCheckpointSummary[] {
    const db = this.ensureDb();
    const summaries: WorkflowCheckpointSummary[] = [];

    const stmt = db.prepare(
      `SELECT checkpoint_id, step, status, triggered_nodes, duration_ms,
              created_at, interrupt_payload
       FROM checkpoints
       WHERE thread_id = ?
       ORDER BY step DESC`,
    );
    stmt.bind([runId]);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      summaries.push({
        checkpointId: row.checkpoint_id as string,
        step: row.step as number,
        status: row.status as WorkflowCheckpointSummary["status"],
        triggeredNodes: JSON.parse(row.triggered_nodes as string),
        durationMs: row.duration_ms as number,
        createdAt: row.created_at as string,
        interruptPayload: row.interrupt_payload
          ? JSON.parse(row.interrupt_payload as string)
          : undefined,
      });
    }
    stmt.free();
    return summaries;
  }

  restoreChannelData(
    runId: string,
    channelVersions: Record<string, number>,
  ): Map<string, unknown> {
    const db = this.ensureDb();
    const result = new Map<string, unknown>();

    for (const [channelName, version] of Object.entries(channelVersions)) {
      const stmt = db.prepare(
        `SELECT value FROM channel_blobs
         WHERE thread_id = ? AND channel_name = ? AND version = ?`,
      );
      stmt.bind([runId, channelName, version]);

      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        result.set(channelName, JSON.parse(row.value as string));
      }
      stmt.free();
    }
    return result;
  }

  // ── Cleanup ──

  deleteRunData(runId: string): void {
    const db = this.ensureDb();
    db.run("BEGIN TRANSACTION");
    try {
      db.run("DELETE FROM channel_blobs WHERE thread_id = ?", [runId]);
      db.run("DELETE FROM checkpoints WHERE thread_id = ?", [runId]);
      db.run("DELETE FROM workflow_runs WHERE id = ?", [runId]);
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
    this.dirty = true;
    this.flush();
  }

  /** 保留最近 keepLastN 条 checkpoint，删除更早的及其 channel blob */
  cleanup(runId: string, keepLastN: number): void {
    const db = this.ensureDb();

    // 找到需要保留的最小 step 值
    const stmt = db.prepare(
      `SELECT step FROM checkpoints
       WHERE thread_id = ?
       ORDER BY step DESC
       LIMIT 1 OFFSET ?`,
    );
    stmt.bind([runId, keepLastN - 1]);

    let cutoffStep: number | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      cutoffStep = row.step as number;
    }
    stmt.free();

    if (cutoffStep == null) {
      // checkpoint 总数不足 keepLastN，无需清理
      return;
    }

    db.run("BEGIN TRANSACTION");
    try {
      // 获取将被删除的 checkpoint 的 channel version 信息，以清理孤立 blob
      // 先删除比 cutoffStep 更旧的 checkpoint 对应的 channel_blobs
      // 这里使用子查询找到旧 checkpoint 关联的 channel_versions
      const oldCheckpoints = db.prepare(
        `SELECT channel_versions FROM checkpoints
         WHERE thread_id = ? AND step < ?`,
      );
      oldCheckpoints.bind([runId, cutoffStep]);

      const blobsToKeep = new Set<string>(); // "channelName:version"
      // 收集需要保留的 checkpoint 的 channel versions
      const keepCheckpoints = db.prepare(
        `SELECT channel_versions FROM checkpoints
         WHERE thread_id = ? AND step >= ?`,
      );
      keepCheckpoints.bind([runId, cutoffStep]);
      while (keepCheckpoints.step()) {
        const row = keepCheckpoints.getAsObject() as Record<string, unknown>;
        const versions = JSON.parse(row.channel_versions as string) as Record<string, number>;
        for (const [ch, ver] of Object.entries(versions)) {
          blobsToKeep.add(`${ch}:${ver}`);
        }
      }
      keepCheckpoints.free();

      // 删除旧 checkpoint 专有的 channel blobs
      while (oldCheckpoints.step()) {
        const row = oldCheckpoints.getAsObject() as Record<string, unknown>;
        const versions = JSON.parse(row.channel_versions as string) as Record<string, number>;
        for (const [ch, ver] of Object.entries(versions)) {
          if (!blobsToKeep.has(`${ch}:${ver}`)) {
            db.run(
              "DELETE FROM channel_blobs WHERE thread_id = ? AND channel_name = ? AND version = ?",
              [runId, ch, ver],
            );
          }
        }
      }
      oldCheckpoints.free();

      // 删除旧 checkpoint 记录
      db.run(
        "DELETE FROM checkpoints WHERE thread_id = ? AND step < ?",
        [runId, cutoffStep],
      );

      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
    this.dirty = true;
    this.flush();
  }

  close(): void {
    this.flush();
    this.db?.close();
    this.db = null;
  }

  // ── Private helpers ──

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error("[sqlite-checkpointer] 数据库未初始化，请先调用 init()");
    }
    return this.db;
  }
}

// ── Helpers ──

function isTerminalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function rowToRunSummary(row: Record<string, unknown>): WorkflowRunSummary {
  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    workflowVersion: row.workflow_version as number,
    status: row.status as WorkflowRunSummary["status"],
    currentNodeIds: [],
    startedAt: row.started_at as string,
    updatedAt: row.updated_at as string,
    finishedAt: (row.finished_at as string) || undefined,
    totalSteps: (row.total_steps as number) || undefined,
    error: (row.error as string) || undefined,
  };
}
