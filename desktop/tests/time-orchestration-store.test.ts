import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
});
