import type { AvailabilityPolicy, Reminder, ScheduleJob } from "@shared/contracts";

import { weekdayFromDateKey } from "../../../shared/time/local-time";

type DueReminder = Pick<Reminder, "id" | "title" | "body" | "triggerAt" | "timezone" | "status">;
type DueScheduleJob = ScheduleJob;

export type TimeExecutionRunInput = {
  entityKind: "reminder" | "schedule_job";
  entityId: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  note?: string;
};

export type TimeSchedulerDeps = {
  now?: () => Date;
  intervalMs?: number;
  listDueReminders: (at: Date) => Promise<DueReminder[]>;
  listDueJobs: (at: Date) => Promise<DueScheduleJob[]>;
  notifyReminder: (reminder: DueReminder, policy: AvailabilityPolicy | null) => Promise<boolean | void>;
  markReminderDelivered: (id: string, deliveredAt: string) => Promise<void>;
  recordExecutionRun: (run: TimeExecutionRunInput) => Promise<void>;
  getAvailabilityPolicy: () => Promise<AvailabilityPolicy | null>;
  saveScheduleJob: (job: ScheduleJob) => Promise<void>;
  runScheduleJob?: (job: DueScheduleJob) => Promise<void>;
};

export type TimeScheduler = ReturnType<typeof createTimeScheduler>;

/** 读取 cron 表达式五段，当前只支持标准 minute hour day month weekday。 */
function parseCronExpression(expression: string): string[] | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  return fields.length === 5 ? fields : null;
}

/** 判断单个 cron 字段是否命中当前值，支持通配、步长、逗号列表和单值。 */
function matchesCronField(field: string, value: number): boolean {
  return field.split(",").some((rawPart) => {
    const part = rawPart.trim();
    if (!part || part === "*") {
      return true;
    }
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    const expected = Number(part);
    if (!Number.isFinite(expected)) {
      return false;
    }
    if (value === 0 && expected === 7) {
      return true;
    }
    return value === expected;
  });
}

/** 把 UTC 时间投影到指定时区的分钟颗粒，供 cron 匹配复用。 */
function readCronCandidateParts(date: Date, timeZone: string): {
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    month,
    day,
    hour,
    minute,
    weekday: weekdayFromDateKey(dateKey),
  };
}

/** 计算 cron 任务下一次运行时间；找不到时返回 null。 */
function findNextCronRunAt(
  expression: string,
  reference: Date,
  timeZone: string,
): string | null {
  const fields = parseCronExpression(expression);
  if (!fields) {
    return null;
  }
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  let candidate = new Date(reference.getTime() + 60_000);
  candidate.setUTCSeconds(0, 0);

  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    const parts = readCronCandidateParts(candidate, timeZone);
    if (
      matchesCronField(minuteField, parts.minute)
      && matchesCronField(hourField, parts.hour)
      && matchesCronField(dayField, parts.day)
      && matchesCronField(monthField, parts.month)
      && matchesCronField(weekdayField, parts.weekday)
    ) {
      return candidate.toISOString();
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return null;
}

/** 根据任务类型和本次执行结果，计算应落库的下一版计划任务状态。 */
function buildNextScheduleJobState(
  job: ScheduleJob,
  finishedAt: string,
  succeeded: boolean,
): ScheduleJob {
  if (job.scheduleKind === "once") {
    return {
      ...job,
      lastRunAt: finishedAt,
      nextRunAt: undefined,
      status: succeeded ? "completed" : "failed",
      updatedAt: finishedAt,
    };
  }

  if (job.scheduleKind === "interval" && job.intervalMinutes && job.intervalMinutes > 0) {
    return {
      ...job,
      lastRunAt: finishedAt,
      nextRunAt: new Date(Date.parse(finishedAt) + job.intervalMinutes * 60_000).toISOString(),
      status: "scheduled",
      updatedAt: finishedAt,
    };
  }

  if (job.scheduleKind === "cron" && job.cronExpression) {
    const nextRunAt = findNextCronRunAt(job.cronExpression, new Date(finishedAt), job.timezone);
    return {
      ...job,
      lastRunAt: finishedAt,
      nextRunAt: nextRunAt ?? undefined,
      status: nextRunAt ? "scheduled" : (succeeded ? "completed" : "failed"),
      updatedAt: finishedAt,
    };
  }

  return {
    ...job,
    lastRunAt: finishedAt,
    nextRunAt: undefined,
    status: succeeded ? "completed" : "failed",
    updatedAt: finishedAt,
  };
}

export function createTimeScheduler(deps: TimeSchedulerDeps) {
  const now = deps.now ?? (() => new Date());
  const intervalMs = deps.intervalMs ?? 30_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const api = {
    /**
     * 启动桌面时间调度轮询，周期检查到期提醒与计划任务。
     */
    start(): void {
      console.info("[time-scheduler] 启动时间调度器", { intervalMs });
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        void api.tick();
      }, intervalMs);
    },

    /**
     * 停止桌面时间调度轮询，供应用退出或热重载时调用。
     */
    stop(): void {
      console.info("[time-scheduler] 停止时间调度器");
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },

    /**
     * 执行一次调度扫描，处理到期提醒并推进计划任务的下一次运行时间。
     */
    async tick(): Promise<void> {
      if (running) {
        console.info("[time-scheduler] 上一轮调度尚未结束，跳过本轮");
        return;
      }
      running = true;
      const current = now();
      console.info("[time-scheduler] 执行调度轮询", { at: current.toISOString() });

      try {
        const policy = await deps.getAvailabilityPolicy();
        const reminders = await deps.listDueReminders(current);
        for (const reminder of reminders) {
          const startedAt = now().toISOString();
          const delivered = await deps.notifyReminder(reminder, policy);
          if (delivered === false) {
            continue;
          }
          const finishedAt = now().toISOString();
          await deps.markReminderDelivered(reminder.id, finishedAt);
          await deps.recordExecutionRun({
            entityKind: "reminder",
            entityId: reminder.id,
            status: "completed",
            startedAt,
            finishedAt,
          });
        }

        const jobs = await deps.listDueJobs(current);
        if (deps.runScheduleJob) {
          for (const job of jobs) {
            const startedAt = now().toISOString();
            let succeeded = true;
            let failureNote: string | undefined;

            try {
              await deps.runScheduleJob(job);
            } catch (error) {
              succeeded = false;
              failureNote = error instanceof Error ? error.message : String(error);
            }

            const finishedAt = now().toISOString();
            await deps.recordExecutionRun({
              entityKind: "schedule_job",
              entityId: job.id,
              status: succeeded ? "completed" : "failed",
              startedAt,
              finishedAt,
              note: failureNote,
            });
            await deps.saveScheduleJob(buildNextScheduleJobState(job, finishedAt, succeeded));
          }
        }
      } finally {
        running = false;
      }
    },
  };

  return api;
}
