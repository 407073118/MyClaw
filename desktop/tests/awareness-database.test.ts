import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";

import { TimeOrchestrationDatabase } from "../src/main/services/time-orchestration-database";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function createLegacyAwarenessDatabase(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-awareness-db-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "time.db");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE awareness_routines (
      id TEXT PRIMARY KEY,
      scope_kind TEXT NOT NULL,
      owner_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enabled',
      cadence_minutes INTEGER NOT NULL DEFAULT 30,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO awareness_routines (
      id, scope_kind, owner_id, name, status, cadence_minutes, payload_json, created_at, updated_at
    ) VALUES (
      'routine-legacy', 'personal', NULL, '旧值守', 'enabled', 30,
      '{"id":"routine-legacy","name":"旧值守","scope":{"kind":"personal"},"purpose":"保留旧数据","cadenceMinutes":30,"signalSources":[],"decisionPolicy":{"useModelForCrossSource":true,"useModelForActionSuggestion":true,"maxModelCallsPerTick":1},"actionPolicy":{"autoAllow":["log_only"],"requireApproval":["notify_user"],"alwaysDeny":[]},"deliveryPolicy":{"notifyOnSignal":false,"notifyOnDecision":true,"deliveryChannel":"today_catchup","quietHoursRespected":true,"criticalOverridesQuietHours":true},"budgetPolicy":{"maxModelCallsPerDay":50,"maxModelCallsPerRoutinePerDay":10,"pausedOnBudgetExceeded":true},"standingOrderIds":[],"status":"enabled","consecutiveFailures":0,"createdAt":"2026-05-16T00:00:00.000Z","updatedAt":"2026-05-16T00:00:00.000Z"}',
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z'
    );
  `);
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  return dbPath;
}

describe("awareness database migration", () => {
  it("preserves existing awareness routine rows while adding missing migration columns and indexes", async () => {
    const dbPath = await createLegacyAwarenessDatabase();

    const db = await TimeOrchestrationDatabase.create(dbPath);
    try {
      const row = db.queryOne("SELECT id, next_run_at, payload_json FROM awareness_routines WHERE id = @id", {
        id: "routine-legacy",
      });
      const columns = db.queryAll("PRAGMA table_info(awareness_routines)").map((item) => String(item.name));
      const indexes = db.queryAll("PRAGMA index_list(awareness_routines)").map((item) => String(item.name));

      expect(row?.id).toBe("routine-legacy");
      expect(JSON.parse(String(row?.payload_json)).purpose).toBe("保留旧数据");
      expect(columns).toContain("next_run_at");
      expect(indexes).toContain("idx_awareness_routines_status_next_run");
    } finally {
      db.close();
    }
  });
});
