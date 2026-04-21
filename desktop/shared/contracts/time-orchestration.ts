import type { TimeEntitySource, TimeOwnerScope } from "./calendar";

export type ReminderStatus = "scheduled" | "delivered" | "dismissed" | "cancelled";

export const REMINDER_STATUS_VALUES = [
  "scheduled",
  "delivered",
  "dismissed",
  "cancelled",
] as const satisfies readonly ReminderStatus[];

export type Reminder = {
  id: string;
  kind: "reminder";
  title: string;
  body?: string;
  triggerAt: string;
  timezone: string;
  ownerScope: TimeOwnerScope;
  ownerId?: string;
  status: ReminderStatus;
  source: TimeEntitySource;
  externalRef?: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleJobKind = "once" | "interval" | "cron";

export const SCHEDULE_JOB_KIND_VALUES = [
  "once",
  "interval",
  "cron",
] as const satisfies readonly ScheduleJobKind[];

export type ScheduleJobStatus =
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export const SCHEDULE_JOB_STATUS_VALUES = [
  "scheduled",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly ScheduleJobStatus[];

export type ScheduleJobExecutor = "workflow" | "silicon_person" | "assistant_prompt";

export const SCHEDULE_JOB_EXECUTOR_VALUES = [
  "workflow",
  "silicon_person",
  "assistant_prompt",
] as const satisfies readonly ScheduleJobExecutor[];

export type ScheduleJob = {
  id: string;
  kind: "schedule_job";
  title: string;
  description?: string;
  scheduleKind: ScheduleJobKind;
  timezone: string;
  ownerScope: TimeOwnerScope;
  ownerId?: string;
  status: ScheduleJobStatus;
  source: TimeEntitySource;
  externalRef?: string;
  startsAt?: string;
  intervalMinutes?: number;
  cronExpression?: string;
  executor: ScheduleJobExecutor;
  executorTargetId?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export const EXECUTION_RUN_STATUS_VALUES = [
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly ExecutionRunStatus[];

export type ExecutionRun = {
  id: string;
  jobId: string;
  status: ExecutionRunStatus;
  startedAt: string;
  finishedAt?: string;
  outputSummary?: string;
  errorMessage?: string;
};

export type AvailabilityWindow = {
  weekday: number;
  start: string;
  end: string;
};

export type QuietHoursPolicy = {
  enabled: boolean;
  start: string;
  end: string;
};

export type NotificationWindow = {
  label: string;
  start: string;
  end: string;
};

export type FocusBlock = {
  label: string;
  weekday: number;
  start: string;
  end: string;
};

export type AvailabilityPolicy = {
  timezone: string;
  workingHours: AvailabilityWindow[];
  quietHours: QuietHoursPolicy;
  notificationWindows: NotificationWindow[];
  focusBlocks: FocusBlock[];
};

export type TodayBriefItemKind =
  | "reminder"
  | "calendar_event"
  | "schedule_job"
  | "task_commitment";

export type TodayBriefItem = {
  id: string;
  kind: TodayBriefItemKind;
  title: string;
  startsAt?: string;
  endsAt?: string;
  summary: string;
};

export type TodayBrief = {
  generatedAt: string;
  timezone: string;
  items: TodayBriefItem[];
};

/**
 * 为桌面端生成默认的可用时段策略，确保新用户开箱即用。
 */
export function createDefaultAvailabilityPolicy(timezone: string): AvailabilityPolicy {
  return {
    timezone,
    workingHours: [
      { weekday: 1, start: "09:00", end: "18:00" },
      { weekday: 2, start: "09:00", end: "18:00" },
      { weekday: 3, start: "09:00", end: "18:00" },
      { weekday: 4, start: "09:00", end: "18:00" },
      { weekday: 5, start: "09:00", end: "18:00" },
    ],
    quietHours: { enabled: true, start: "22:00", end: "08:00" },
    notificationWindows: [],
    focusBlocks: [],
  };
}
