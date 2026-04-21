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
        trigger_at: reminder.triggerAt,
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
    return this.database.queryAll(
      `SELECT payload_json FROM reminders
       WHERE status = @status AND trigger_at <= @trigger_at
       ORDER BY trigger_at ASC`,
      {
        status: "scheduled",
        trigger_at: at.toISOString(),
      },
    ).map((row) => parseReminder(row));
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
    const now = new Date().toISOString();
    const job: ScheduleJob = {
      id: input.id ?? randomUUID(),
      kind: "schedule_job",
      title: input.title,
      description: input.description,
      scheduleKind: input.scheduleKind,
      timezone: input.timezone,
      ownerScope: input.ownerScope ?? "personal",
      ownerId: input.ownerId,
      status: input.status ?? "scheduled",
      source: input.source ?? "manual",
      externalRef: input.externalRef,
      startsAt: input.startsAt,
      intervalMinutes: input.intervalMinutes,
      cronExpression: input.cronExpression,
      executor: input.executor ?? "assistant_prompt",
      executorTargetId: input.executorTargetId,
      lastRunAt: input.lastRunAt,
      nextRunAt: input.nextRunAt,
      createdAt: now,
      updatedAt: now,
    };
    this.database.run(
      `INSERT INTO schedule_jobs (
        id, title, schedule_kind, timezone, status, next_run_at, updated_at, payload_json
      ) VALUES (
        @id, @title, @schedule_kind, @timezone, @status, @next_run_at, @updated_at, @payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        schedule_kind = excluded.schedule_kind,
        timezone = excluded.timezone,
        status = excluded.status,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json`,
      {
        id: job.id,
        title: job.title,
        schedule_kind: job.scheduleKind,
        timezone: job.timezone,
        status: job.status,
        next_run_at: job.nextRunAt,
        updated_at: job.updatedAt,
        payload_json: JSON.stringify(job),
      },
    );
    return job;
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
   */
  async recordExecutionRun(input: ExecutionRunRecordInput): Promise<void> {
    console.info("[time-store] 记录执行结果", {
      entityKind: input.entityKind,
      entityId: input.entityId,
      status: input.status,
    });
    this.database.run(
      `INSERT INTO execution_runs (
        id, entity_kind, entity_id, status, started_at, finished_at, payload_json
      ) VALUES (
        @id, @entity_kind, @entity_id, @status, @started_at, @finished_at, @payload_json
      )`,
      {
        id: randomUUID(),
        entity_kind: input.entityKind,
        entity_id: input.entityId,
        status: input.status,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
        payload_json: JSON.stringify(input),
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

  /**
   * 关闭底层数据库连接，供应用退出时调用。
   */
  close(): void {
    console.info("[time-store] 关闭时间编排存储");
    this.database.close();
  }
}
