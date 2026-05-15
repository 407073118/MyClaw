import { describe, expect, it } from "vitest";

import { createDefaultAvailabilityPolicy } from "@shared/contracts";

import { createTimeScheduler } from "../src/main/services/time-scheduler";

describe("time scheduler", () => {
  it("runs a due reminder exactly once and records an execution run", async () => {
    const delivered: string[] = [];
    const recorded: Array<{ entityId: string; status: string }> = [];

    const scheduler = createTimeScheduler({
      now: () => new Date("2026-04-20T07:00:00.000Z"),
      listDueJobs: async () => [],
      listDueReminders: async () => [
        {
          id: "rem-1",
          title: "Call doctor",
          triggerAt: "2026-04-20T07:00:00.000Z",
          timezone: "Asia/Shanghai",
          status: "scheduled",
        },
      ],
      notifyReminder: async (reminder) => {
        delivered.push(reminder.id);
      },
      markReminderDelivered: async () => undefined,
      recordExecutionRun: async (run) => {
        recorded.push({ entityId: run.entityId, status: run.status });
      },
      getAvailabilityPolicy: async () => createDefaultAvailabilityPolicy("Asia/Shanghai"),
      saveScheduleJob: async () => undefined,
    });

    await scheduler.tick();

    expect(delivered).toEqual(["rem-1"]);
    expect(recorded).toEqual([{ entityId: "rem-1", status: "completed" }]);
  });

  it("runs a due interval job and saves the next run time", async () => {
    const savedJobs: Array<{ id: string; status: string; nextRunAt?: string; lastRunAt?: string }> = [];
    const recorded: Array<{ entityId: string; status: string; sessionId?: string }> = [];

    const scheduler = createTimeScheduler({
      now: () => new Date("2026-04-20T07:00:00.000Z"),
      listDueReminders: async () => [],
      listDueJobs: async () => [
        {
          id: "job-1",
          kind: "schedule_job",
          title: "周报执行",
          scheduleKind: "interval",
          timezone: "Asia/Shanghai",
          ownerScope: "silicon_person",
          ownerId: "sp-1",
          status: "scheduled",
          source: "manual",
          intervalMinutes: 60,
          executor: "assistant_prompt",
          sessionMode: "per_run",
          nextRunAt: "2026-04-20T07:00:00.000Z",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
      notifyReminder: async () => true,
      markReminderDelivered: async () => undefined,
      recordExecutionRun: async (run) => {
        recorded.push({ entityId: run.entityId, status: run.status, sessionId: run.sessionId });
      },
      getAvailabilityPolicy: async () => createDefaultAvailabilityPolicy("Asia/Shanghai"),
      saveScheduleJob: async (job) => {
        savedJobs.push({
          id: job.id,
          status: job.status,
          nextRunAt: job.nextRunAt,
          lastRunAt: job.lastRunAt,
        });
      },
      runScheduleJob: async () => ({ outputSummary: "y", sessionId: "sess-y" }),
    });

    await scheduler.tick();

    expect(recorded).toEqual([{ entityId: "job-1", status: "completed", sessionId: "sess-y" }]);
    expect(savedJobs).toEqual([
      {
        id: "job-1",
        status: "scheduled",
        nextRunAt: "2026-04-20T08:00:00.000Z",
        lastRunAt: "2026-04-20T07:00:00.000Z",
      },
    ]);
  });

  it("keeps weekday cron jobs scheduled after a successful run", async () => {
    const savedJobs: Array<{ id: string; status: string; nextRunAt?: string; lastRunAt?: string }> = [];

    const scheduler = createTimeScheduler({
      now: () => new Date("2026-04-20T01:00:00.000Z"),
      listDueReminders: async () => [],
      listDueJobs: async () => [
        {
          id: "job-weekday",
          kind: "schedule_job",
          title: "工作日巡检",
          scheduleKind: "cron",
          timezone: "Asia/Shanghai",
          ownerScope: "personal",
          status: "scheduled",
          source: "manual",
          cronExpression: "0 9 * * 1-5",
          executor: "assistant_prompt",
          sessionMode: "per_run",
          nextRunAt: "2026-04-20T01:00:00.000Z",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
      notifyReminder: async () => true,
      markReminderDelivered: async () => undefined,
      recordExecutionRun: async () => undefined,
      getAvailabilityPolicy: async () => createDefaultAvailabilityPolicy("Asia/Shanghai"),
      saveScheduleJob: async (job) => {
        savedJobs.push({
          id: job.id,
          status: job.status,
          nextRunAt: job.nextRunAt,
          lastRunAt: job.lastRunAt,
        });
      },
      runScheduleJob: async () => ({ outputSummary: "ok", sessionId: "sess-cron" }),
    });

    await scheduler.tick();

    expect(savedJobs).toEqual([
      {
        id: "job-weekday",
        status: "scheduled",
        nextRunAt: "2026-04-21T01:00:00.000Z",
        lastRunAt: "2026-04-20T01:00:00.000Z",
      },
    ]);
  });
});
