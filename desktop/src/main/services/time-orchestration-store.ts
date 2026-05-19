import { randomUUID } from "node:crypto";

import type {
  AvailabilityPolicy,
  CalendarEvent,
  CalendarEventStatus,
  ExecutionRun,
  Reminder,
  ReminderStatus,
  ScheduleJob,
  ScheduleJobExecutor,
  ScheduleJobKind,
  ScheduleJobStatus,
  TaskCommitment,
  TaskCommitmentPriority,
  TaskCommitmentStatus,
  TimeEntitySource,
  TimeOwnerScope,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import { findNextCronRunAt } from "./schedule-job-next-run";
import { TimeOrchestrationDatabase } from "./time-orchestration-database";

function parseReminder(row: Record<string, unknown>): Reminder {
  return JSON.parse(String(row.payload_json)) as Reminder;
}

function parseAvailabilityPolicy(row: Record<string, unknown>): AvailabilityPolicy {
  return JSON.parse(String(row.payload_json)) as AvailabilityPolicy;
}

function parseScheduleJob(row: Record<string, unknown>): ScheduleJob {
  return JSON.parse(String(row.payload_json)) as ScheduleJob;
}

function parseCalendarEvent(row: Record<string, unknown>): CalendarEvent {
  return JSON.parse(String(row.payload_json)) as CalendarEvent;
}

function parseTaskCommitment(row: Record<string, unknown>): TaskCommitment {
  return JSON.parse(String(row.payload_json)) as TaskCommitment;
}

function parseExecutionRun(row: Record<string, unknown>): ExecutionRun {
  return JSON.parse(String(row.payload_json)) as ExecutionRun;
}

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const EXPLICIT_TIMEZONE_PATTERN = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** 统一推导定时任务归属，避免硅基员工任务被误存到主日程 personal 分区。 */
function resolveScheduleJobOwner(input: ScheduleJobUpsertInput): { ownerScope: TimeOwnerScope; ownerId?: string } {
  if (input.ownerScope === "silicon_person") {
    return { ownerScope: "silicon_person", ownerId: input.ownerId ?? input.executorTargetId };
  }
  if (!input.ownerScope && input.executor === "silicon_person" && input.executorTargetId) {
    return { ownerScope: "silicon_person", ownerId: input.executorTargetId };
  }
  return { ownerScope: "personal" };
}

/** 规范化 ISO 时间字符串，避免 SQLite TEXT 时间比较遇到非 UTC 格式。 */
function normalizeIsoDateTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

/** 解析无时区的本地时间文本，避免 Date.parse 使用系统时区吞掉提醒自带 timezone。 */
function parseLocalDateTimeParts(value: string): LocalDateTimeParts | undefined {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = match;
  const parts: LocalDateTimeParts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
    millisecond: Number(millisecondText.padEnd(3, "0").slice(0, 3)),
  };
  const normalized = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond),
  );
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute ||
    normalized.getUTCSeconds() !== parts.second
  ) {
    console.warn("[time-store] 本地提醒时间字段无效，跳过时区归一化", { value });
    return undefined;
  }
  return parts;
}

/** 计算指定 UTC 时刻在目标时区的偏移，用于把本地提醒时间转换为可比较的 UTC。 */
function getTimezoneOffsetMs(utcDate: Date, timezone: string): number | undefined {
  try {
    const values = new Map(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        calendar: "iso8601",
        numberingSystem: "latn",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(utcDate)
        .map((part) => [part.type, part.value]),
    );
    const zonedAsUtc = Date.UTC(
      Number(values.get("year")),
      Number(values.get("month")) - 1,
      Number(values.get("day")),
      Number(values.get("hour")),
      Number(values.get("minute")),
      Number(values.get("second")),
      utcDate.getUTCMilliseconds(),
    );
    return zonedAsUtc - utcDate.getTime();
  } catch (error) {
    console.warn("[time-store] 解析提醒时区失败，无法计算偏移", {
      timezone,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/** 将提醒触发时间归一化为 UTC ISO，同时兼容无时区的旧提醒记录。 */
function normalizeReminderTriggerAt(triggerAt: string, timezone: string): string | undefined {
  const value = triggerAt.trim();
  if (EXPLICIT_TIMEZONE_PATTERN.test(value)) {
    return normalizeIsoDateTime(value);
  }

  const localParts = parseLocalDateTimeParts(value);
  if (localParts) {
    const localAsUtc = Date.UTC(
      localParts.year,
      localParts.month - 1,
      localParts.day,
      localParts.hour,
      localParts.minute,
      localParts.second,
      localParts.millisecond,
    );
    const firstOffset = getTimezoneOffsetMs(new Date(localAsUtc), timezone);
    if (firstOffset === undefined) {
      return undefined;
    }
    let candidate = localAsUtc - firstOffset;
    const verifiedOffset = getTimezoneOffsetMs(new Date(candidate), timezone);
    if (verifiedOffset !== undefined) {
      candidate = localAsUtc - verifiedOffset;
    }
    return new Date(candidate).toISOString();
  }

  return normalizeIsoDateTime(value);
}

/** 计算提醒的绝对触发时间戳，供到期扫描兼容历史本地时间数据。 */
function resolveReminderTriggerTime(reminder: Reminder): number | undefined {
  const normalized = normalizeReminderTriggerAt(reminder.triggerAt, reminder.timezone);
  if (!normalized) {
    console.warn("[time-store] 无法解析提醒触发时间，跳过本次到期投递", {
      id: reminder.id,
      triggerAt: reminder.triggerAt,
      timezone: reminder.timezone,
    });
    return undefined;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/** 根据任务配置推导首次运行时间，确保调度器能从 due 查询中读到新任务。 */
function resolveInitialScheduleJobNextRunAt(input: ScheduleJobUpsertInput, reference: Date): string | undefined {
  const explicitNextRunAt = normalizeIsoDateTime(input.nextRunAt);
  if (explicitNextRunAt) {
    return explicitNextRunAt;
  }
  if (input.status && input.status !== "scheduled") {
    return undefined;
  }
  if (input.scheduleKind === "once") {
    return normalizeIsoDateTime(input.startsAt);
  }
  if (input.scheduleKind === "interval" && input.intervalMinutes && input.intervalMinutes > 0) {
    return new Date(reference.getTime() + input.intervalMinutes * 60_000).toISOString();
  }
  if (input.scheduleKind === "cron" && input.cronExpression) {
    return findNextCronRunAt(input.cronExpression, reference, input.timezone) ?? undefined;
  }
  return undefined;
}

export type ReminderUpsertInput = {
  id?: string;
  title: string;
  body?: string;
  triggerAt: string;
  timezone: string;
  ownerScope?: TimeOwnerScope;
  ownerId?: string;
  status?: ReminderStatus;
  source?: TimeEntitySource;
  externalRef?: string;
};

export type ExecutionRunRecordInput = {
  entityKind: "reminder" | "schedule_job";
  entityId: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  note?: string;
  jobId?: string;
  outputSummary?: string;
  errorMessage?: string;
  sessionId?: string;
};

export type CalendarEventUpsertInput = {
  id?: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  ownerScope?: TimeOwnerScope;
  ownerId?: string;
  status?: CalendarEventStatus;
  source?: TimeEntitySource;
  externalRef?: string;
  location?: string;
};

export type TaskCommitmentUpsertInput = {
  id?: string;
  title: string;
  description?: string;
  dueAt?: string;
  durationMinutes?: number;
  timezone: string;
  ownerScope?: TimeOwnerScope;
  ownerId?: string;
  priority?: TaskCommitmentPriority;
  status?: TaskCommitmentStatus;
  source?: TimeEntitySource;
  externalRef?: string;
};

export type ScheduleJobUpsertInput = {
  id?: string;
  title: string;
  description?: string;
  scheduleKind: ScheduleJobKind;
  timezone: string;
  ownerScope?: TimeOwnerScope;
  ownerId?: string;
  status?: ScheduleJobStatus;
  source?: TimeEntitySource;
  externalRef?: string;
  startsAt?: string;
  intervalMinutes?: number;
  cronExpression?: string;
  executor?: ScheduleJobExecutor;
  executorTargetId?: string;
  sessionId?: string;
  sessionMode?: ScheduleJob["sessionMode"];
  modelProfileId?: string;
  reasoningEffort?: ScheduleJob["reasoningEffort"];
  reasoningEnabled?: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
};

export class TimeOrchestrationStore {
  private constructor(private readonly database: TimeOrchestrationDatabase) {}

  /**
   * 创建时间编排 store，并连接到独立的 `time.db`。
   */
  static async create(paths: MyClawPaths): Promise<TimeOrchestrationStore> {
    console.info("[time-store] 创建时间编排存储", { dbPath: paths.timeDbFile });
    const database = await TimeOrchestrationDatabase.create(paths.timeDbFile);
    return new TimeOrchestrationStore(database);
  }

  /**
   * 保存或更新提醒对象，统一补全桌面端默认字段。
   */
  async upsertReminder(input: ReminderUpsertInput): Promise<Reminder> {
    console.info("[time-store] 保存提醒", {
      title: input.title,
      triggerAt: input.triggerAt,
      timezone: input.timezone,
    });
    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: input.id ?? randomUUID(),
      kind: "reminder",
      title: input.title,
      body: input.body,
      triggerAt: input.triggerAt,
      timezone: input.timezone,
      ownerScope: input.ownerScope ?? "personal",
      ownerId: input.ownerId,
      status: input.status ?? "scheduled",
      source: input.source ?? "manual",
      externalRef: input.externalRef,
      createdAt: now,
      updatedAt: now,
    };

    this.database.run(
      `INSERT INTO reminders (
        id, title, trigger_at, timezone, status, updated_at, payload_json
      ) VALUES (
        @id, @title, @trigger_at, @timezone, @status, @updated_at, @payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        trigger_at = excluded.trigger_at,
        timezone = excluded.timezone,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json`,
      {
        id: reminder.id,
        title: reminder.title,
        trigger_at: normalizeReminderTriggerAt(reminder.triggerAt, reminder.timezone) ?? reminder.triggerAt,
        timezone: reminder.timezone,
        status: reminder.status,
        updated_at: reminder.updatedAt,
        payload_json: JSON.stringify(reminder),
      },
    );

    return reminder;
  }

  /**
   * 列出全部提醒，供后续调度器和 UI 时间中心复用。
   */
  async listReminders(): Promise<Reminder[]> {
    console.info("[time-store] 读取提醒列表");
    return this.database
      .queryAll("SELECT payload_json FROM reminders ORDER BY trigger_at ASC")
      .map((row) => parseReminder(row));
  }

  /**
   * 删除提醒对象，供桌面时间中心做显式清理。
   */
  async deleteReminder(id: string): Promise<void> {
    console.info("[time-store] 删除提醒", { id });
    this.database.run("DELETE FROM reminders WHERE id = @id", { id });
  }

  /**
   * 列出当前时刻之前已到期的提醒，供调度器轮询投递。
   */
  async listDueReminders(at: Date): Promise<Reminder[]> {
    console.info("[time-store] 读取到期提醒", { at: at.toISOString() });
    const candidates = this.database.queryAll(
      `SELECT payload_json FROM reminders
       WHERE status = @status
       ORDER BY trigger_at ASC`,
      {
        status: "scheduled",
      },
    ).map((row) => parseReminder(row));
    const due = candidates
      .map((reminder) => ({ reminder, triggerTime: resolveReminderTriggerTime(reminder) }))
      .filter((item): item is { reminder: Reminder; triggerTime: number } => item.triggerTime !== undefined)
      .filter((item) => item.triggerTime <= at.getTime())
      .sort((left, right) => left.triggerTime - right.triggerTime)
      .map((item) => item.reminder);
    console.info("[time-store] 完成到期提醒筛选", {
      at: at.toISOString(),
      candidates: candidates.length,
      due: due.length,
    });
    return due;
  }

  /**
   * 将提醒标记为已送达，避免调度器重复投递同一条提醒。
   */
  async markReminderDelivered(id: string, deliveredAt: string): Promise<void> {
    console.info("[time-store] 标记提醒已送达", { id, deliveredAt });
    const row = this.database.queryOne(
      "SELECT payload_json FROM reminders WHERE id = @id",
      { id },
    );
    if (!row) {
      return;
    }
    const reminder = parseReminder(row);
    const updatedReminder: Reminder = {
      ...reminder,
      status: "delivered",
      updatedAt: deliveredAt,
    };
    this.database.run(
      `UPDATE reminders
       SET status = @status,
           updated_at = @updated_at,
           payload_json = @payload_json
       WHERE id = @id`,
      {
        id,
        status: updatedReminder.status,
        updated_at: deliveredAt,
        payload_json: JSON.stringify(updatedReminder),
      },
    );
  }

  /**
   * 保存当前桌面用户的可用时段策略。
   */
  async saveAvailabilityPolicy(policy: AvailabilityPolicy): Promise<AvailabilityPolicy> {
    console.info("[time-store] 保存可用时段策略", { timezone: policy.timezone });
    this.database.run(
      `INSERT INTO availability_policies (
        id, timezone, updated_at, payload_json
      ) VALUES (
        @id, @timezone, @updated_at, @payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        timezone = excluded.timezone,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json`,
      {
        id: "default",
        timezone: policy.timezone,
        updated_at: new Date().toISOString(),
        payload_json: JSON.stringify(policy),
      },
    );
    return policy;
  }

  /**
   * 读取当前生效的可用时段策略，未配置时返回 `null`。
   */
  async getAvailabilityPolicy(): Promise<AvailabilityPolicy | null> {
    console.info("[time-store] 读取可用时段策略");
    const row = this.database.queryOne(
      "SELECT payload_json FROM availability_policies WHERE id = @id",
      { id: "default" },
    );
    return row ? parseAvailabilityPolicy(row) : null;
  }

  /**
   * 列出当前时刻之前已到期的计划任务，供后续定时执行器消费。
   */
  async listDueScheduleJobs(at: Date): Promise<ScheduleJob[]> {
    console.info("[time-store] 读取到期计划任务", { at: at.toISOString() });
    return this.database.queryAll(
      `SELECT payload_json FROM schedule_jobs
       WHERE status = @status AND next_run_at IS NOT NULL AND next_run_at <= @next_run_at
       ORDER BY next_run_at ASC`,
      {
        status: "scheduled",
        next_run_at: at.toISOString(),
      },
    ).map((row) => parseScheduleJob(row));
  }

  /**
   * 列出全部计划任务，供工作台和执行器复用。
   */
  async listScheduleJobs(): Promise<ScheduleJob[]> {
    console.info("[time-store] 读取计划任务列表");
    return this.database
      .queryAll("SELECT payload_json FROM schedule_jobs ORDER BY updated_at DESC")
      .map((row) => parseScheduleJob(row));
  }

  /**
   * 保存或更新计划任务，统一承接 cron/interval/once 三类任务。
   */
  async upsertScheduleJob(input: ScheduleJobUpsertInput): Promise<ScheduleJob> {
    console.info("[time-store] 保存计划任务", {
      title: input.title,
      scheduleKind: input.scheduleKind,
      timezone: input.timezone,
    });
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const owner = resolveScheduleJobOwner(input);
    const job: ScheduleJob = {
      id: input.id ?? randomUUID(),
      kind: "schedule_job",
      title: input.title,
      description: input.description,
      scheduleKind: input.scheduleKind,
      timezone: input.timezone,
      ownerScope: owner.ownerScope,
      ownerId: owner.ownerId,
      status: input.status ?? "scheduled",
      source: input.source ?? "manual",
      externalRef: input.externalRef,
      startsAt: normalizeIsoDateTime(input.startsAt),
      intervalMinutes: input.intervalMinutes,
      cronExpression: input.cronExpression,
      executor: input.executor ?? "assistant_prompt",
      executorTargetId: input.executorTargetId,
      sessionId: input.sessionId,
      sessionMode: input.sessionMode,
      modelProfileId: input.modelProfileId,
      reasoningEffort: input.reasoningEffort,
      reasoningEnabled: input.reasoningEnabled,
      lastRunAt: input.lastRunAt,
      nextRunAt: resolveInitialScheduleJobNextRunAt(input, nowDate),
      createdAt: now,
      updatedAt: now,
    };
    this.database.run(
      `INSERT INTO schedule_jobs (
        id, title, schedule_kind, timezone, owner_scope, owner_id, status, next_run_at, updated_at, payload_json
      ) VALUES (
        @id, @title, @schedule_kind, @timezone, @owner_scope, @owner_id, @status, @next_run_at, @updated_at, @payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        schedule_kind = excluded.schedule_kind,
        timezone = excluded.timezone,
        owner_scope = excluded.owner_scope,
        owner_id = excluded.owner_id,
        status = excluded.status,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json`,
      {
        id: job.id,
        title: job.title,
        schedule_kind: job.scheduleKind,
        timezone: job.timezone,
        owner_scope: job.ownerScope,
        owner_id: job.ownerId,
        status: job.status,
        next_run_at: job.nextRunAt,
        updated_at: job.updatedAt,
        payload_json: JSON.stringify(job),
      },
    );
    return job;
  }

  /**
   * 启动期一次性迁移：把老的 assistant_prompt job（已存在 sessionId 但缺 sessionMode）
   * 自动回填为 sessionMode='shared'，保持其重构前累积一段长 session 的行为不变；
   * 没有 sessionId 的视为「从未跑过」，回填为新默认 per_run。幂等：再次调用不会改任何数据。
   */
  async migrateAssistantPromptSessionMode(): Promise<{ migrated: number }> {
    const all = await this.listScheduleJobs();
    let migrated = 0;
    for (const job of all) {
      if (job.executor !== "assistant_prompt") continue;
      if (job.sessionMode !== undefined) continue;
      const nextMode: ScheduleJob["sessionMode"] = job.sessionId ? "shared" : "per_run";
      await this.upsertScheduleJob({
        id: job.id,
        title: job.title,
        description: job.description,
        scheduleKind: job.scheduleKind,
        timezone: job.timezone,
        ownerScope: job.ownerScope,
        ownerId: job.ownerId,
        status: job.status,
        source: job.source,
        externalRef: job.externalRef,
        startsAt: job.startsAt,
        intervalMinutes: job.intervalMinutes,
        cronExpression: job.cronExpression,
        executor: job.executor,
        executorTargetId: job.executorTargetId,
        sessionId: job.sessionId,
        sessionMode: nextMode,
        modelProfileId: job.modelProfileId,
        reasoningEffort: job.reasoningEffort,
        reasoningEnabled: job.reasoningEnabled,
        lastRunAt: job.lastRunAt,
        nextRunAt: job.nextRunAt,
      });
      migrated += 1;
    }
    console.info("[time-store] 迁移老 assistant_prompt job sessionMode", {
      migrated,
      total: all.length,
    });
    return { migrated };
  }

  /**
   * 删除计划任务，供 UI 停用或移除周期任务时使用。
   */
  async deleteScheduleJob(id: string): Promise<void> {
    console.info("[time-store] 删除计划任务", { id });
    this.database.run("DELETE FROM schedule_jobs WHERE id = @id", { id });
  }

  /**
   * 列出全部日历事件，供时间中心和时间块规划器复用。
   */
  async listCalendarEvents(): Promise<CalendarEvent[]> {
    console.info("[time-store] 读取日历事件列表");
    return this.database
      .queryAll("SELECT payload_json FROM calendar_events ORDER BY starts_at ASC")
      .map((row) => parseCalendarEvent(row));
  }

  /**
   * 保存或更新日历事件。
   */
  async upsertCalendarEvent(input: CalendarEventUpsertInput): Promise<CalendarEvent> {
    console.info("[time-store] 保存日历事件", {
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: input.id ?? randomUUID(),
      kind: "calendar_event",
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      ownerScope: input.ownerScope ?? "personal",
      ownerId: input.ownerId,
      status: input.status ?? "confirmed",
      source: input.source ?? "manual",
      externalRef: input.externalRef,
      location: input.location,
      createdAt: now,
      updatedAt: now,
    };
    this.database.run(
      `INSERT INTO calendar_events (
        id, title, starts_at, ends_at, timezone, status, updated_at, payload_json
      ) VALUES (
        @id, @title, @starts_at, @ends_at, @timezone, @status, @updated_at, @payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        timezone = excluded.timezone,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json`,
      {
        id: event.id,
        title: event.title,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        timezone: event.timezone,
        status: event.status,
        updated_at: event.updatedAt,
        payload_json: JSON.stringify(event),
      },
    );
    return event;
  }

  /**
   * 列出全部时间承诺对象，供时间块规划和手工编辑复用。
   */
  async listTaskCommitments(): Promise<TaskCommitment[]> {
    console.info("[time-store] 读取时间承诺列表");
    return this.database
      .queryAll("SELECT payload_json FROM task_commitments ORDER BY updated_at DESC")
      .map((row) => parseTaskCommitment(row));
  }

  /**
   * 保存或更新时间承诺对象。
   */
  async upsertTaskCommitment(input: TaskCommitmentUpsertInput): Promise<TaskCommitment> {
    console.info("[time-store] 保存时间承诺", {
      title: input.title,
      dueAt: input.dueAt ?? null,
      timezone: input.timezone,
    });
    const now = new Date().toISOString();
    const commitment: TaskCommitment = {
      id: input.id ?? randomUUID(),
      kind: "task_commitment",
      title: input.title,
      description: input.description,
      dueAt: input.dueAt,
      durationMinutes: input.durationMinutes,
      timezone: input.timezone,
      ownerScope: input.ownerScope ?? "personal",
      ownerId: input.ownerId,
      priority: input.priority ?? "medium",
      status: input.status ?? "pending",
      source: input.source ?? "manual",
      externalRef: input.externalRef,
      createdAt: now,
      updatedAt: now,
    };
    this.database.run(
      `INSERT INTO task_commitments (
        id, title, due_at, timezone, status, updated_at, payload_json
      ) VALUES (
        @id, @title, @due_at, @timezone, @status, @updated_at, @payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        due_at = excluded.due_at,
        timezone = excluded.timezone,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json`,
      {
        id: commitment.id,
        title: commitment.title,
        due_at: commitment.dueAt,
        timezone: commitment.timezone,
        status: commitment.status,
        updated_at: commitment.updatedAt,
        payload_json: JSON.stringify(commitment),
      },
    );
    return commitment;
  }

  /**
   * 记录提醒或计划任务的执行结果，供后续审计与运行面板复用。
   * payload_json 写入与 ExecutionRun 契约对齐的对象，保证渲染层 listExecutionRuns 取出的字段
   * （jobId / status / outputSummary / errorMessage）真实存在；DB 列保留 entity_kind/entity_id/status
   * 的旧字面量值（completed/failed）以避免 schema migration。
   */
  async recordExecutionRun(input: ExecutionRunRecordInput): Promise<void> {
    console.info("[time-store] 记录执行结果", {
      entityKind: input.entityKind,
      entityId: input.entityId,
      status: input.status,
    });
    const runId = randomUUID();
    const persistedRun: ExecutionRun = {
      id: runId,
      jobId: input.jobId ?? input.entityId,
      status: input.status === "completed" ? "succeeded" : "failed",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      outputSummary: input.outputSummary,
      errorMessage: input.errorMessage ?? input.note,
      sessionId: input.sessionId,
    };
    this.database.run(
      `INSERT INTO execution_runs (
        id, entity_kind, entity_id, status, started_at, finished_at, payload_json
      ) VALUES (
        @id, @entity_kind, @entity_id, @status, @started_at, @finished_at, @payload_json
      )`,
      {
        id: runId,
        entity_kind: input.entityKind,
        entity_id: input.entityId,
        status: input.status,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
        payload_json: JSON.stringify(persistedRun),
      },
    );
  }

  /**
   * 读取最近执行记录，供工作台展示调度结果。
   */
  async listExecutionRuns(limit = 50): Promise<ExecutionRun[]> {
    console.info("[time-store] 读取执行记录", { limit });
    return this.database.queryAll(
      `SELECT payload_json FROM execution_runs
       ORDER BY started_at DESC
       LIMIT @limit`,
      { limit },
    ).map((row) => parseExecutionRun(row));
  }

  async deleteExecutionRun(id: string): Promise<void> {
    this.database.run("DELETE FROM execution_runs WHERE id = @id", { id });
  }

  async deleteExecutionRunsByJobId(jobId: string): Promise<number> {
    this.database.run("DELETE FROM execution_runs WHERE entity_id = @jobId", { jobId });
    const result = this.database.queryOne("SELECT changes() AS count") as Record<string, unknown>;
    return Number(result?.count ?? 0);
  }

  /**
   * 关闭底层数据库连接，供应用退出时调用。
   */
  close(): void {
    console.info("[time-store] 关闭时间编排存储");
    this.database.close();
  }
}
