import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";

import { derivePaths } from "../src/main/services/directory-service";
import { TimeOrchestrationStore } from "../src/main/services/time-orchestration-store";

describe("TimeOrchestrationStore", () => {
  it("persists reminders and availability policy in time.db", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);

    const reminder = await store.upsertReminder({
      title: "Call doctor",
      triggerAt: "2026-04-20T07:00:00.000Z",
      timezone: "Asia/Shanghai",
    });

    const policy = await store.saveAvailabilityPolicy({
      timezone: "Asia/Shanghai",
      workingHours: [{ weekday: 1, start: "09:00", end: "18:00" }],
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
      notificationWindows: [],
      focusBlocks: [],
    });

    expect((await store.listReminders())[0]?.id).toBe(reminder.id);
    expect((await store.getAvailabilityPolicy())?.timezone).toBe(policy.timezone);

    await store.recordExecutionRun({
      entityKind: "schedule_job",
      entityId: "job-record",
      jobId: "job-record",
      status: "completed",
      startedAt: "2026-04-20T07:00:00.000Z",
      finishedAt: "2026-04-20T07:00:01.000Z",
      outputSummary: "ok",
      sessionId: "sess-record",
    });
    const runs = await store.listExecutionRuns();
    expect(runs[0]?.jobId).toBe("job-record");
    expect(runs[0]?.sessionId).toBe("sess-record");

    store.close();
  });

  it("treats local no-offset reminder trigger times as due in their timezone", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-local-reminder-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);

    const reminder = await store.upsertReminder({
      title: "本地时间提醒",
      triggerAt: "2026-05-19T14:01:42",
      timezone: "Asia/Shanghai",
    });

    const due = await store.listDueReminders(new Date("2026-05-19T06:02:00.000Z"));
    expect(due.map((item) => item.id)).toContain(reminder.id);

    store.close();
  });

  it("treats legacy local reminder rows as due after reopening time.db", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-legacy-local-reminder-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);
    store.close();

    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(paths.timeDbFile));
    const payload = JSON.stringify({
      id: "legacy-local-reminder",
      kind: "reminder",
      title: "旧本地提醒",
      triggerAt: "2026-05-19T14:01:42",
      timezone: "Asia/Shanghai",
      ownerScope: "personal",
      status: "scheduled",
      source: "agent",
      createdAt: "2026-05-19T05:56:52.447Z",
      updatedAt: "2026-05-19T05:56:52.447Z",
    }).replace(/'/g, "''");
    db.exec(`
      INSERT INTO reminders (
        id, title, trigger_at, timezone, status, updated_at, payload_json
      ) VALUES (
        'legacy-local-reminder',
        '旧本地提醒',
        '2026-05-19T14:01:42',
        'Asia/Shanghai',
        'scheduled',
        '2026-05-19T05:56:52.447Z',
        '${payload}'
      );
    `);
    writeFileSync(paths.timeDbFile, Buffer.from(db.export()));
    db.close();

    const reopenedStore = await TimeOrchestrationStore.create(paths);
    const due = await reopenedStore.listDueReminders(new Date("2026-05-19T06:02:00.000Z"));
    expect(due.map((item) => item.id)).toContain("legacy-local-reminder");

    reopenedStore.close();
  });

  it("migrateAssistantPromptSessionMode backfills legacy assistant_prompt jobs and is idempotent", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-migrate-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);

    // 老 job A：已经跑过（有 sessionId、缺 sessionMode）→ 应该被回填为 shared
    const jobA = await store.upsertScheduleJob({
      title: "老 job 累积",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      intervalMinutes: 60,
      executor: "assistant_prompt",
      sessionId: "sess-legacy-A",
    });
    // 老 job B：未跑过（无 sessionId、缺 sessionMode）→ 应该被回填为 per_run
    const jobB = await store.upsertScheduleJob({
      title: "老 job 未执行",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      intervalMinutes: 60,
      executor: "assistant_prompt",
    });
    // 非 prompt 任务：应当被忽略
    await store.upsertScheduleJob({
      title: "工作流任务",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      intervalMinutes: 60,
      executor: "workflow",
      executorTargetId: "wf-1",
    });

    const first = await store.migrateAssistantPromptSessionMode();
    expect(first.migrated).toBe(2);

    const all = await store.listScheduleJobs();
    const migratedA = all.find((item) => item.id === jobA.id);
    const migratedB = all.find((item) => item.id === jobB.id);
    expect(migratedA?.sessionMode).toBe("shared");
    expect(migratedB?.sessionMode).toBe("per_run");

    // 幂等：再次调用不应再迁移任何 job
    const second = await store.migrateAssistantPromptSessionMode();
    expect(second.migrated).toBe(0);

    store.close();
  });

  it("persists schedule job ownership columns for silicon person separation", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-owner-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);

    const personalJob = await store.upsertScheduleJob({
      title: "个人日报",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      intervalMinutes: 60,
      executor: "assistant_prompt",
    });
    const siliconPersonJob = await store.upsertScheduleJob({
      title: "运营助手巡检",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      ownerScope: "silicon_person",
      ownerId: "sp-1",
      intervalMinutes: 120,
      executor: "workflow",
      executorTargetId: "wf-1",
    });
    store.close();

    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(paths.timeDbFile));
    const columns = db.exec("PRAGMA table_info(schedule_jobs)")[0]?.values.map((row) => row[1]);
    expect(columns).toContain("owner_scope");
    expect(columns).toContain("owner_id");

    const rows = db.exec("SELECT id, owner_scope, owner_id FROM schedule_jobs ORDER BY id")[0]?.values ?? [];
    expect(rows).toContainEqual([personalJob.id, "personal", null]);
    expect(rows).toContainEqual([siliconPersonJob.id, "silicon_person", "sp-1"]);
    db.close();
  });

  it("initializes next run time when creating schedule jobs from editor fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-next-run-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);
    const beforeCreate = Date.now();

    const onceStartsAt = "2026-04-20T07:00:00.000Z";
    const onceJob = await store.upsertScheduleJob({
      title: "一次性任务",
      scheduleKind: "once",
      timezone: "Asia/Shanghai",
      startsAt: onceStartsAt,
      executor: "assistant_prompt",
    });
    const intervalJob = await store.upsertScheduleJob({
      title: "间隔任务",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      intervalMinutes: 60,
      executor: "assistant_prompt",
    });
    const cronJob = await store.upsertScheduleJob({
      title: "每分钟任务",
      scheduleKind: "cron",
      timezone: "Asia/Shanghai",
      cronExpression: "* * * * *",
      executor: "assistant_prompt",
    });

    expect(onceJob.nextRunAt).toBe(onceStartsAt);
    expect(intervalJob.nextRunAt).toBeDefined();
    expect(Date.parse(intervalJob.nextRunAt ?? "")).toBeGreaterThanOrEqual(beforeCreate + 60 * 60_000);
    expect(cronJob.nextRunAt).toBeDefined();

    const dueOnceJobs = await store.listDueScheduleJobs(new Date(onceStartsAt));
    const dueIntervalJobs = await store.listDueScheduleJobs(new Date(Date.now() + 61 * 60_000));
    const dueCronJobs = await store.listDueScheduleJobs(new Date(cronJob.nextRunAt ?? ""));

    expect(dueOnceJobs.map((job) => job.id)).toContain(onceJob.id);
    expect(dueIntervalJobs.map((job) => job.id)).toContain(intervalJob.id);
    expect(dueCronJobs.map((job) => job.id)).toContain(cronJob.id);

    store.close();
  });

  it("migrates legacy schedule job tables and backfills owner columns from payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-owner-legacy-"));
    const paths = derivePaths(root);
    const SQL = await initSqlJs();
    const legacyDb = new SQL.Database();
    legacyDb.exec(`
      CREATE TABLE schedule_jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        schedule_kind TEXT NOT NULL,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL,
        next_run_at TEXT,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    const legacyPayload = JSON.stringify({
      id: "job-legacy",
      kind: "schedule_job",
      title: "历史员工任务",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      ownerScope: "silicon_person",
      ownerId: "sp-legacy",
      status: "scheduled",
      source: "manual",
      intervalMinutes: 60,
      executor: "workflow",
      executorTargetId: "wf-legacy",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    }).replace(/'/g, "''");
    legacyDb.exec(`
      INSERT INTO schedule_jobs (
        id, title, schedule_kind, timezone, status, next_run_at, updated_at, payload_json
      ) VALUES (
        'job-legacy', '历史员工任务', 'interval', 'Asia/Shanghai', 'scheduled', NULL, '2026-04-20T00:00:00.000Z', '${legacyPayload}'
      );
    `);
    mkdirSync(dirname(paths.timeDbFile), { recursive: true });
    writeFileSync(paths.timeDbFile, Buffer.from(legacyDb.export()));
    legacyDb.close();

    const store = await TimeOrchestrationStore.create(paths);
    store.close();

    const migratedDb = new SQL.Database(readFileSync(paths.timeDbFile));
    const row = migratedDb.exec("SELECT owner_scope, owner_id FROM schedule_jobs WHERE id = 'job-legacy'")[0]?.values[0];
    expect(row).toEqual(["silicon_person", "sp-legacy"]);
    migratedDb.close();
  });
});
