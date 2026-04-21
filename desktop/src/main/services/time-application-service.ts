import type {
  AvailabilityPolicy,
  CalendarEvent,
  Reminder,
  ScheduleJob,
  TaskCommitment,
  TodayBrief,
  TodayBriefItem,
} from "@shared/contracts";

import type {
  CalendarEventUpsertInput,
  ReminderUpsertInput,
  ScheduleJobUpsertInput,
  TaskCommitmentUpsertInput,
  TimeOrchestrationStore,
} from "./time-orchestration-store";
import { planTimeboxes } from "./timebox-planner";

export type TimeSnapshot = {
  calendarEvents: CalendarEvent[];
  taskCommitments: TaskCommitment[];
  reminders: Reminder[];
  scheduleJobs: ScheduleJob[];
  executionRuns: import("@shared/contracts").ExecutionRun[];
  availabilityPolicy: AvailabilityPolicy | null;
  todayBrief: TodayBrief | null;
};

export type TimeApplicationServiceDeps = {
  store: TimeOrchestrationStore;
  now?: () => Date;
};

function toLocalDateKey(iso: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(iso));
}

function buildTodayBriefItems(input: {
  reminders: Reminder[];
  events: CalendarEvent[];
  commitments: TaskCommitment[];
  jobs: ScheduleJob[];
  dateKey: string;
  timezone: string;
}): TodayBriefItem[] {
  const items: TodayBriefItem[] = [];
  for (const reminder of input.reminders) {
    if (toLocalDateKey(reminder.triggerAt, input.timezone) === input.dateKey) {
      items.push({
        id: reminder.id,
        kind: "reminder",
        title: reminder.title,
        startsAt: reminder.triggerAt,
        summary: `Reminder at ${reminder.triggerAt}`,
      });
    }
  }
  for (const event of input.events) {
    if (toLocalDateKey(event.startsAt, input.timezone) === input.dateKey) {
      items.push({
        id: event.id,
        kind: "calendar_event",
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        summary: `Event from ${event.startsAt} to ${event.endsAt}`,
      });
    }
  }
  for (const commitment of input.commitments) {
    if (commitment.dueAt && toLocalDateKey(commitment.dueAt, input.timezone) === input.dateKey) {
      items.push({
        id: commitment.id,
        kind: "task_commitment",
        title: commitment.title,
        startsAt: commitment.dueAt,
        summary: `Commitment due at ${commitment.dueAt}`,
      });
    }
  }
  for (const job of input.jobs) {
    if (job.nextRunAt && toLocalDateKey(job.nextRunAt, input.timezone) === input.dateKey) {
      items.push({
        id: job.id,
        kind: "schedule_job",
        title: job.title,
        startsAt: job.nextRunAt,
        summary: `Job runs at ${job.nextRunAt}`,
      });
    }
  }
  return items.sort((left, right) => (left.startsAt ?? "").localeCompare(right.startsAt ?? ""));
}

export type TimeApplicationService = ReturnType<typeof createTimeApplicationService>;

export function createTimeApplicationService(deps: TimeApplicationServiceDeps) {
  const now = deps.now ?? (() => new Date());

  const api = {
    /**
     * 汇总时间域快照，供 bootstrap 和时间中心首屏复用。
     */
    async getSnapshot(): Promise<TimeSnapshot> {
      console.info("[time-application] 构建时间域快照");
      const [
        calendarEvents,
        taskCommitments,
        reminders,
        scheduleJobs,
        executionRuns,
        availabilityPolicy,
      ] = await Promise.all([
        deps.store.listCalendarEvents(),
        deps.store.listTaskCommitments(),
        deps.store.listReminders(),
        deps.store.listScheduleJobs(),
        deps.store.listExecutionRuns(),
        deps.store.getAvailabilityPolicy(),
      ]);
      const timezone = availabilityPolicy?.timezone ?? "Asia/Shanghai";
      const todayBrief = await api.getTodayBrief();
      return {
        calendarEvents,
        taskCommitments,
        reminders,
        scheduleJobs,
        executionRuns,
        availabilityPolicy,
        todayBrief: todayBrief.timezone === timezone ? todayBrief : {
          ...todayBrief,
          timezone,
        },
      };
    },

    /**
     * 生成今天摘要，先聚合当日提醒、事件、承诺和计划任务。
     */
    async getTodayBrief(): Promise<TodayBrief> {
      console.info("[time-application] 生成今日摘要");
      const [
        reminders,
        events,
        commitments,
        jobs,
        availabilityPolicy,
      ] = await Promise.all([
        deps.store.listReminders(),
        deps.store.listCalendarEvents(),
        deps.store.listTaskCommitments(),
        deps.store.listScheduleJobs(),
        deps.store.getAvailabilityPolicy(),
      ]);
      const timezone = availabilityPolicy?.timezone ?? "Asia/Shanghai";
      const dateKey = toLocalDateKey(now().toISOString(), timezone);
      return {
        generatedAt: now().toISOString(),
        timezone,
        items: buildTodayBriefItems({
          reminders,
          events,
          commitments,
          jobs,
          dateKey,
          timezone,
        }),
      };
    },

    /**
     * 读取日历事件列表。
     */
    async listCalendarEvents(): Promise<CalendarEvent[]> {
      console.info("[time-application] 读取日历事件列表");
      return deps.store.listCalendarEvents();
    },

    /**
     * 创建或更新日历事件。
     */
    async saveCalendarEvent(input: CalendarEventUpsertInput): Promise<CalendarEvent> {
      console.info("[time-application] 保存日历事件", { title: input.title });
      return deps.store.upsertCalendarEvent(input);
    },

    /**
     * 读取时间承诺列表。
     */
    async listTaskCommitments(): Promise<TaskCommitment[]> {
      console.info("[time-application] 读取时间承诺列表");
      return deps.store.listTaskCommitments();
    },

    /**
     * 创建或更新时间承诺。
     */
    async saveTaskCommitment(input: TaskCommitmentUpsertInput): Promise<TaskCommitment> {
      console.info("[time-application] 保存时间承诺", { title: input.title });
      return deps.store.upsertTaskCommitment(input);
    },

    /**
     * 读取提醒列表。
     */
    async listReminders(): Promise<Reminder[]> {
      console.info("[time-application] 读取提醒列表");
      return deps.store.listReminders();
    },

    /**
     * 创建或更新提醒。
     */
    async saveReminder(input: ReminderUpsertInput): Promise<Reminder> {
      console.info("[time-application] 保存提醒", { title: input.title });
      return deps.store.upsertReminder(input);
    },

    /**
     * 删除提醒。
     */
    async deleteReminder(id: string): Promise<void> {
      console.info("[time-application] 删除提醒", { id });
      await deps.store.deleteReminder(id);
    },

    /**
     * 读取计划任务列表。
     */
    async listScheduleJobs(): Promise<ScheduleJob[]> {
      console.info("[time-application] 读取计划任务列表");
      return deps.store.listScheduleJobs();
    },

    /**
     * 创建或更新计划任务。
     */
    async saveScheduleJob(input: ScheduleJobUpsertInput): Promise<ScheduleJob> {
      console.info("[time-application] 保存计划任务", { title: input.title });
      return deps.store.upsertScheduleJob(input);
    },

    /**
     * 删除计划任务。
     */
    async deleteScheduleJob(id: string): Promise<void> {
      console.info("[time-application] 删除计划任务", { id });
      await deps.store.deleteScheduleJob(id);
    },

    /**
     * 读取可用时段策略。
     */
    async getAvailabilityPolicy(): Promise<AvailabilityPolicy | null> {
      console.info("[time-application] 读取可用时段策略");
      return deps.store.getAvailabilityPolicy();
    },

    /**
     * 保存可用时段策略。
     */
    async saveAvailabilityPolicy(policy: AvailabilityPolicy): Promise<AvailabilityPolicy> {
      console.info("[time-application] 保存可用时段策略", { timezone: policy.timezone });
      return deps.store.saveAvailabilityPolicy(policy);
    },

    /**
     * 生成时间块建议，供时间中心周视图与计划助手复用。
     */
    async suggestTimeboxes(): Promise<import("@shared/contracts").SuggestedTimebox[]> {
      console.info("[time-application] 生成时间块建议");
      const [calendarEvents, taskCommitments, availabilityPolicy] = await Promise.all([
        deps.store.listCalendarEvents(),
        deps.store.listTaskCommitments(),
        deps.store.getAvailabilityPolicy(),
      ]);
      const timezone = availabilityPolicy?.timezone ?? "Asia/Shanghai";
      return planTimeboxes({
        events: calendarEvents,
        commitments: taskCommitments,
        timezone,
        availabilityPolicy,
        now: now().toISOString(),
      });
    },
  };

  return api;
}
