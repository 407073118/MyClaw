import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type {
  AvailabilityPolicy,
  CalendarEvent,
  ExecutionRun,
  Reminder,
  ScheduleJob,
  ScheduleJobExecutor,
  SiliconPerson,
  TaskCommitment,
} from "@shared/contracts";
import { formatJobFrequency } from "../utils/frequency";
import { addDaysToDateKey, isoToDateKey, utcIsoToLocalDateTimeInput } from "@shared/time/local-time";
import { enumerateCronRunsOnDate } from "@shared/time/cron";

import MarkdownView from "../components/MarkdownView";
import AvailabilityPolicyForm from "../components/time/AvailabilityPolicyForm";
import CalendarEventEditor, {
  type CalendarEventEditorSubmitInput,
} from "../components/time/CalendarEventEditor";
import ReminderEditor, {
  type ReminderEditorSubmitInput,
} from "../components/time/ReminderEditor";
import ScheduleJobEditor, {
  type ScheduleJobEditorSubmitInput,
} from "../components/time/ScheduleJobEditor";
import TaskCommitmentEditor, {
  type TaskCommitmentEditorSubmitInput,
} from "../components/time/TaskCommitmentEditor";
import { useWorkspaceStore } from "../stores/workspace";

type ComposerKind = "event" | "reminder" | "job" | "task" | "rules";
type PlanningView = "timeline" | "events" | "reminders" | "jobs";

type TimelineEntryKind =
  | "calendar_event"
  | "reminder"
  | "task_commitment"
  | "schedule_job";

type TimelineOwnerScope = "personal" | "silicon_person";

type TimelineEntry = {
  id: string;
  itemId: string;
  kind: TimelineEntryKind;
  title: string;
  displayTitle: string;
  ownerScope: TimelineOwnerScope;
  ownerId?: string;
  ownerLabel: string;
  startsAt: string;
  endsAt?: string;
  sourceLabel: string;
  meta: string;
  tone: "personal" | "silicon" | "automation" | "warning";
  lastRunLabel?: string;
};

type TimelineEntryItem = CalendarEvent | Reminder | TaskCommitment | ScheduleJob;

type TimelineComposerDefaults = {
  event?: {
    initialTitle?: string;
    initialLocation?: string;
    initialDescription?: string;
    initialStartsAt?: string;
    initialEndsAt?: string;
  };
  reminder?: {
    initialTitle?: string;
    initialBody?: string;
    initialTriggerAt?: string;
  };
  task?: {
    initialTitle?: string;
    initialDescription?: string;
    initialDueAt?: string;
    initialDurationMinutes?: string;
  };
};

type TimelineInteractionState = {
  startY: number;
  currentY: number;
  startInput: string;
  currentInput: string;
};

type TimelineContextMenuState = {
  x: number;
  y: number;
  anchorInput: string;
  entry?: TimelineEntry | null;
};

type ScheduleJobOwnerDraft = {
  ownerScope: TimelineOwnerScope;
  ownerId?: string;
};

type SchedulePlanningModel = {
  entries: TimelineEntry[];
  personalCount: number;
  siliconCount: number;
  scheduleJobCount: number;
  failedJobCount: number;
};

const DAY_HOURS = Array.from({ length: 25 }, (_, index) => index);
const MAX_INITIAL_TIMELINE_ENTRIES = 200;
const MAX_SIDE_RAIL_TASKS = 8;

/** 渲染日程规划页：以时间轴为主体，统一呈现我、硅基人和自动任务。 */
export default function TimeCenterPage() {
  // 细粒度订阅：只订阅页面要响应的字段，避免无关 store 字段（auth/models/sessions）变化触发整页重渲。
  const time = useWorkspaceStore((state) => state.time);
  const siliconPersons = useWorkspaceStore((state) => state.siliconPersons);
  const workflows = useWorkspaceStore((state) => state.workflows);
  const models = useWorkspaceStore((state) => state.models);
  // actions 通过 getState 调用，不进入订阅链 —— zustand action 引用永远稳定。
  const workspace = useWorkspaceStore.getState();
  const timezone = time.availabilityPolicy?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayDateKey = useMemo(() => isoToDateKey(new Date().toISOString(), timezone), [timezone]);
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [activeView, setActiveView] = useState<PlanningView>("timeline");
  const [activeComposer, setActiveComposer] = useState<ComposerKind | null>(null);
  const [feedback, setFeedback] = useState("");
  const [chosenJobType, setChosenJobType] = useState<ScheduleJobExecutor | null>(null);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [editingTask, setEditingTask] = useState<TaskCommitment | null>(null);
  const [selectedTimelineEntry, setSelectedTimelineEntry] = useState<TimelineEntry | null>(null);
  const [timelineDefaults, setTimelineDefaults] = useState<TimelineComposerDefaults>({});
  const [timelineInteraction, setTimelineInteraction] = useState<TimelineInteractionState | null>(null);
  const [timelineContextMenu, setTimelineContextMenu] = useState<TimelineContextMenuState | null>(null);

  // 详情页通过 navigate("/time", { state }) 返回定时任务列表或触发编辑器。
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const state = location.state as { editJobId?: string; activeView?: PlanningView } | null;
    const editJobId = state?.editJobId;
    const nextActiveView = state?.activeView;
    if (!editJobId && !nextActiveView) return;
    if (nextActiveView === "timeline" || nextActiveView === "events" || nextActiveView === "reminders" || nextActiveView === "jobs") {
      setActiveView(nextActiveView);
    }
    if (editJobId) {
      const target = time.scheduleJobs.find((job) => job.id === editJobId);
      if (target) {
        setEditingJob(target);
        setChosenJobType(target.executor);
        setActiveComposer("job");
        setActiveView("jobs");
      }
    }
    // 清掉 history.state 防止刷新时重复触发
    void navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const workflowOptions = useMemo(
    () => (workflows ?? []).map((workflow) => ({ id: workflow.id, name: workflow.name })),
    [workflows],
  );
  const siliconPersonOptions = useMemo(
    () => (siliconPersons ?? []).map((person) => ({ id: person.id, name: person.name })),
    [siliconPersons],
  );
  const modelOptions = useMemo(
    () => (models ?? []).map((model) => ({ id: model.id, name: model.name })),
    [models],
  );

  const siliconPersonNameById = useMemo(
    () => new Map((siliconPersons ?? []).map((person) => [person.id, person.name])),
    [siliconPersons],
  );
  const latestRunByJobId = useMemo(() => buildLatestRunByJobId(time.executionRuns), [time.executionRuns]);

  // 拆分 useMemo：events / reminders / tasks 与 jobs / latestRun 解耦，
  // executionRuns 变化只重算 jobEntries+aggregates，不动 events/reminders/tasks。
  const eventEntries = useMemo(
    () => buildEventEntries(time.calendarEvents, selectedDate, timezone, siliconPersonNameById),
    [time.calendarEvents, selectedDate, timezone, siliconPersonNameById],
  );
  const reminderEntries = useMemo(
    () => buildReminderEntries(time.reminders, selectedDate, timezone, siliconPersonNameById),
    [time.reminders, selectedDate, timezone, siliconPersonNameById],
  );
  const taskEntries = useMemo(
    () => buildTaskEntries(time.taskCommitments, selectedDate, timezone, siliconPersonNameById),
    [time.taskCommitments, selectedDate, timezone, siliconPersonNameById],
  );
  const jobEntries = useMemo(
    () => buildJobEntries(time.scheduleJobs, selectedDate, timezone, latestRunByJobId, siliconPersonNameById),
    [time.scheduleJobs, selectedDate, timezone, latestRunByJobId, siliconPersonNameById],
  );
  const planningModel = useMemo<SchedulePlanningModel>(() => {
    const entries = [...eventEntries, ...reminderEntries, ...taskEntries, ...jobEntries]
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    return {
      entries,
      personalCount: entries.filter((entry) => entry.ownerScope === "personal" && entry.kind !== "schedule_job").length,
      siliconCount: entries.filter((entry) => entry.ownerScope === "silicon_person").length,
      scheduleJobCount: jobEntries.length,
      failedJobCount: time.scheduleJobs.filter(
        (job) => job.status === "failed" || latestRunByJobId.get(job.id)?.status === "failed",
      ).length,
    };
  }, [eventEntries, reminderEntries, taskEntries, jobEntries, time.scheduleJobs, latestRunByJobId]);
  const unscheduledTasks = useMemo(
    () => time.taskCommitments.filter((task) => task.status === "pending" && !task.dueAt),
    [time.taskCommitments],
  );
  const visibleTimelineEntries = useMemo(
    () => planningModel.entries.slice(0, MAX_INITIAL_TIMELINE_ENTRIES),
    [planningModel.entries],
  );
  const hiddenTimelineEntryCount = Math.max(0, planningModel.entries.length - visibleTimelineEntries.length);
  const selectedTimelineItem = useMemo(
    () => resolveTimelineEntryItem(selectedTimelineEntry, time),
    [selectedTimelineEntry, time],
  );

  /** 清空所有编辑态，避免从详情进入编辑后把旧实体带到下一次新建。 */
  function clearEditingState() {
    setEditingEvent(null);
    setEditingReminder(null);
    setEditingTask(null);
    setEditingJob(null);
    setChosenJobType(null);
  }

  /** 保存日程事件；有编辑目标时更新原日程，否则创建新日程。 */
  async function handleSaveCalendarEvent(input: CalendarEventEditorSubmitInput) {
    console.info("[日程规划] 保存日程", {
      mode: editingEvent ? "update" : "create",
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
    });
    if (editingEvent) {
      await workspace.updateCalendarEvent({
        ...editingEvent,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone,
      });
    } else {
      await workspace.createCalendarEvent({
        kind: "calendar_event",
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone,
        ownerScope: "personal",
        status: "confirmed",
        source: "manual",
      });
    }
    setActiveComposer(null);
    setEditingEvent(null);
    setTimelineDefaults({});
    setFeedback(`${editingEvent ? "已更新" : "已保存"}日程：${input.title}`);
  }

  /** 保存任务承诺；有截止时间的任务会进入时间轴，没有时间的留在待安排任务。 */
  async function handleSaveTaskCommitment(input: TaskCommitmentEditorSubmitInput) {
    console.info("[日程规划] 保存待安排任务", {
      mode: editingTask ? "update" : "create",
      title: input.title,
      dueAt: input.dueAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      priority: input.priority,
    });
    if (editingTask) {
      await workspace.updateTaskCommitment({
        ...editingTask,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        durationMinutes: input.durationMinutes,
        timezone: input.timezone,
        priority: input.priority,
      });
    } else {
      await workspace.createTaskCommitment({
        kind: "task_commitment",
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        durationMinutes: input.durationMinutes,
        timezone: input.timezone,
        ownerScope: "personal",
        priority: input.priority,
        status: "pending",
        source: "manual",
      });
    }
    setActiveComposer(null);
    setEditingTask(null);
    setTimelineDefaults({});
    setFeedback(`${editingTask ? "已更新" : "已保存"}任务：${input.title}`);
  }

  /** 保存提醒，并把提醒投影到对应日期的时间轴。 */
  async function handleSaveReminder(input: ReminderEditorSubmitInput) {
    console.info("[日程规划] 保存提醒", {
      mode: editingReminder ? "update" : "create",
      title: input.title,
      triggerAt: input.triggerAt,
      timezone: input.timezone,
    });
    if (editingReminder) {
      await workspace.updateReminder({
        ...editingReminder,
        title: input.title,
        body: input.body,
        triggerAt: input.triggerAt,
        timezone: input.timezone,
      });
    } else {
      await workspace.createReminder({
        kind: "reminder",
        title: input.title,
        body: input.body,
        triggerAt: input.triggerAt,
        timezone: input.timezone,
        ownerScope: "personal",
        status: "scheduled",
        source: "manual",
      });
    }
    setActiveComposer(null);
    setEditingReminder(null);
    setTimelineDefaults({});
    setFeedback(`${editingReminder ? "已更新" : "已保存"}提醒：${input.title}`);
  }

  /** 保存定时任务：根据 mode 决定 create 还是 update，editor 提交后统一回到列表。 */
  async function handleSaveScheduleJob(input: ScheduleJobEditorSubmitInput, mode: "create" | "update") {
    const owner = resolveScheduleJobOwnerDraft(input, editingJob);
    console.info("[日程规划] 保存定时任务", {
      mode,
      title: input.title,
      scheduleKind: input.scheduleKind,
      executor: input.executor,
      executorTargetId: input.executorTargetId ?? null,
      ownerScope: owner.ownerScope,
      ownerId: owner.ownerId ?? null,
    });
    if (mode === "update" && editingJob) {
      await workspace.updateScheduleJob({
        ...editingJob,
        ownerScope: owner.ownerScope,
        ownerId: owner.ownerId,
        title: input.title,
        description: input.description,
        scheduleKind: input.scheduleKind,
        timezone: input.timezone,
        startsAt: input.startsAt,
        intervalMinutes: input.intervalMinutes,
        cronExpression: input.cronExpression,
        executorTargetId: input.executorTargetId,
        modelProfileId: input.modelProfileId,
        reasoningEffort: input.reasoningEffort,
        reasoningEnabled: input.reasoningEnabled,
        nextRunAt: input.startsAt ?? editingJob.nextRunAt,
      });
      setFeedback(`已更新定时任务：${input.title}`);
    } else {
      await workspace.createScheduleJob({
        kind: "schedule_job",
        title: input.title,
        description: input.description,
        scheduleKind: input.scheduleKind,
        timezone: input.timezone,
        ownerScope: owner.ownerScope,
        ownerId: owner.ownerId,
        status: "scheduled",
        source: "manual",
        startsAt: input.startsAt,
        intervalMinutes: input.intervalMinutes,
        cronExpression: input.cronExpression,
        executor: input.executor,
        executorTargetId: input.executorTargetId,
        modelProfileId: input.modelProfileId,
        reasoningEffort: input.reasoningEffort,
        reasoningEnabled: input.reasoningEnabled,
        nextRunAt: input.startsAt,
      });
      setFeedback(`已保存定时任务：${input.title}`);
    }
    setActiveComposer(null);
    setEditingJob(null);
    setChosenJobType(null);
  }

  /** 进入编辑模式：预填编辑器并锁定为该任务的 type。 */
  function handleEditScheduleJob(job: ScheduleJob) {
    setSelectedTimelineEntry(null);
    setEditingJob(job);
    setChosenJobType(job.executor);
    setActiveComposer("job");
  }

  /** 从时间轴详情进入编辑模式，沿用已有编辑弹层。 */
  function handleEditSelectedTimelineItem() {
    const item = selectedTimelineItem;
    if (!item) return;
    console.info("[日程规划] 从时间轴详情编辑条目", {
      kind: item.kind,
      id: item.id,
      title: item.title,
    });
    setSelectedTimelineEntry(null);
    if (item.kind === "calendar_event") {
      setEditingEvent(item);
      setTimelineDefaults({
        event: {
          initialTitle: item.title,
          initialLocation: item.location,
          initialDescription: item.description,
          initialStartsAt: utcIsoToLocalDateTimeInput(item.startsAt, item.timezone),
          initialEndsAt: utcIsoToLocalDateTimeInput(item.endsAt, item.timezone),
        },
      });
      setActiveComposer("event");
      return;
    }
    if (item.kind === "reminder") {
      setEditingReminder(item);
      setTimelineDefaults({
        reminder: {
          initialTitle: item.title,
          initialBody: item.body,
          initialTriggerAt: utcIsoToLocalDateTimeInput(item.triggerAt, item.timezone),
        },
      });
      setActiveComposer("reminder");
      return;
    }
    if (item.kind === "task_commitment") {
      setEditingTask(item);
      setTimelineDefaults({
        task: {
          initialTitle: item.title,
          initialDescription: item.description,
          initialDueAt: item.dueAt ? utcIsoToLocalDateTimeInput(item.dueAt, item.timezone) : undefined,
          initialDurationMinutes: item.durationMinutes ? String(item.durationMinutes) : undefined,
        },
      });
      setActiveComposer("task");
      return;
    }
    handleEditScheduleJob(item);
  }

  /** 保存时间规则，作为日程规划的工作时段和静默时段依据。 */
  async function handleSaveAvailabilityPolicy(policy: AvailabilityPolicy) {
    console.info("[日程规划] 保存时间规则", {
      timezone: policy.timezone,
      workingHoursCount: policy.workingHours.length,
      quietHoursEnabled: policy.quietHours.enabled,
    });
    await workspace.saveAvailabilityPolicy(policy);
    setActiveComposer(null);
    setFeedback("已保存时间规则");
  }

  /** 暂停或恢复定时任务，保持右侧状态栏可直接操作。 */
  async function handleToggleScheduleJob(job: ScheduleJob) {
    const nextStatus = job.status === "paused" ? "scheduled" : "paused";
    console.info("[日程规划] 切换定时任务状态", {
      id: job.id,
      title: job.title,
      from: job.status,
      to: nextStatus,
    });
    await workspace.updateScheduleJob({
      ...job,
      status: nextStatus,
    });
    setFeedback(nextStatus === "paused" ? `已暂停定时任务：${job.title}` : `已恢复定时任务：${job.title}`);
  }

  /** 删除提醒，避免过期提醒继续占用日程规划侧栏。 */
  async function handleDeleteReminder(id: string) {
    console.info("[日程规划] 删除提醒", { id });
    await workspace.deleteReminder(id);
    setFeedback("已删除提醒");
  }

  /** 删除定时任务，并从时间轴和状态栏中移除它。 */
  async function handleDeleteScheduleJob(id: string) {
    console.info("[日程规划] 删除定时任务", { id });
    await workspace.deleteScheduleJob(id);
    setFeedback("已删除定时任务");
  }

  /** 删除当前详情条目：日程/任务走取消态，提醒/定时任务走已有删除接口。 */
  async function handleDeleteSelectedTimelineItem() {
    const item = selectedTimelineItem;
    if (!item) return;
    console.info("[日程规划] 从时间轴详情删除条目", {
      kind: item.kind,
      id: item.id,
      title: item.title,
    });
    if (item.kind === "calendar_event") {
      await workspace.updateCalendarEvent({ ...item, status: "cancelled" });
      setFeedback(`已删除日程：${item.title}`);
    } else if (item.kind === "reminder") {
      await workspace.deleteReminder(item.id);
      setFeedback(`已删除提醒：${item.title}`);
    } else if (item.kind === "task_commitment") {
      await workspace.updateTaskCommitment({ ...item, status: "cancelled" });
      setFeedback(`已删除任务：${item.title}`);
    } else {
      await workspace.deleteScheduleJob(item.id);
      setFeedback(`已删除定时任务：${item.title}`);
    }
    setSelectedTimelineEntry(null);
  }

  /** 编辑弹层开启时允许 ESC 快速关闭，符合桌面端操作习惯。 */
  useEffect(() => {
    if (!activeComposer) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveComposer(null);
        clearEditingState();
        setTimelineDefaults({});
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeComposer]);

  useEffect(() => {
    function handleWindowPointerUp() {
      if (!timelineInteraction) return;
      const start = Math.min(timelineInteraction.startY, timelineInteraction.currentY);
      const end = Math.max(timelineInteraction.startY, timelineInteraction.currentY);
      const startInput = timelineInteraction.startInput;
      const currentInput = timelineInteraction.currentInput;
      const nextStart = startInput < currentInput ? startInput : currentInput;
      const nextEnd = startInput < currentInput ? currentInput : startInput;
      setTimelineInteraction(null);
      setTimelineDefaults({
        event: {
          initialStartsAt: nextStart,
          initialEndsAt: nextEnd,
        },
      });
      setTimelineContextMenu(null);
      setActiveComposer("event");
    }

    if (!timelineInteraction) return;
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => window.removeEventListener("pointerup", handleWindowPointerUp);
  }, [timelineInteraction]);

  /** 立即执行定时任务，让用户可手动触发一次任务而不必等待调度窗口。 */
  async function handleRunScheduleJobNow(job: ScheduleJob) {
    console.info("[日程规划] 立即执行定时任务", { id: job.id, title: job.title });
    await workspace.executeScheduleJobNow(job.id);
    setFeedback(`已触发立即执行：${job.title}`);
  }

  /** 打开日程编辑器，并把时间轴空白区选择的默认时间带进去。 */
  function openEventComposer(defaults: TimelineComposerDefaults["event"]) {
    console.info("[日程规划] 打开日程编辑器", {
      startsAt: defaults?.initialStartsAt ?? null,
      endsAt: defaults?.initialEndsAt ?? null,
    });
    clearEditingState();
    setTimelineDefaults({ event: defaults });
    setActiveComposer("event");
  }

  /** 打开时间轴上下文菜单，支持用户从空白时间段直接新建日程。 */
  function handleTimelineContextMenu(event: React.MouseEvent, anchorInput: string, entry?: TimelineEntry | null) {
    event.preventDefault();
    console.info("[日程规划] 打开时间轴菜单", {
      anchorInput,
      entryId: entry?.id ?? null,
    });
    setTimelineContextMenu({
      x: event.clientX,
      y: event.clientY,
      anchorInput,
      entry: entry ?? null,
    });
  }

  /** 关闭时间轴上下文菜单，避免菜单残留遮挡后续操作。 */
  function closeTimelineContextMenu() {
    setTimelineContextMenu(null);
  }

  return (
    <main className="schedule-planning-page" data-testid="time-center-page">
      <header className="schedule-planning-header">
        <div className="schedule-planning-header__lead">
          <span className="schedule-planning-header__eyebrow">统一时间轴</span>
          <h2 className="schedule-planning-header__title">日程规划</h2>
        </div>

        <div className="schedule-planning-header__actions">
          <DateNavigator
            selectedDate={selectedDate}
            todayDateKey={todayDateKey}
            timezone={timezone}
            onSelectDate={setSelectedDate}
          />
          <button type="button" className="btn-primary" onClick={() => openEventComposer({})}>
            新建
          </button>
        </div>
      </header>

      <ScheduleSummaryBar model={planningModel} feedback={feedback} />

      <PlanningViewSwitcher activeView={activeView} onChange={setActiveView} />

      <section className="schedule-planning-grid">
        {activeView === "timeline" ? (
          <section className="schedule-timeline-panel" data-testid="schedule-timeline">
            <TimelineHeader selectedDate={selectedDate} timezone={timezone} entryCount={planningModel.entries.length} />
            <ScheduleTimeline
              entries={visibleTimelineEntries}
              hiddenEntryCount={hiddenTimelineEntryCount}
              timezone={timezone}
              selectedDate={selectedDate}
              todayDateKey={todayDateKey}
              onCreateEvent={openEventComposer}
              onOpenEntry={(entry) => {
                console.info("[日程规划] 打开时间轴条目详情", {
                  kind: entry.kind,
                  itemId: entry.itemId,
                  title: entry.title,
                });
                setSelectedTimelineEntry(entry);
                closeTimelineContextMenu();
              }}
              onContextMenu={handleTimelineContextMenu}
              onDragSelectStart={(anchorInput, clientY) => {
                setTimelineInteraction({
                  startY: clientY,
                  currentY: clientY,
                  startInput: anchorInput,
                  currentInput: anchorInput,
                });
              }}
              onDragSelectMove={(anchorInput, clientY) => {
                setTimelineInteraction((current) => (current ? { ...current, currentY: clientY, currentInput: anchorInput } : current));
              }}
            />
          </section>
        ) : null}

        {activeView === "events" ? (
          <CalendarEventListPage
            events={time.calendarEvents}
            selectedDate={selectedDate}
            timezone={timezone}
            siliconPersonNameById={siliconPersonNameById}
          />
        ) : null}

        {activeView === "reminders" ? (
          <ReminderListPage reminders={time.reminders} timezone={timezone} onDelete={handleDeleteReminder} />
        ) : null}

        {activeView === "jobs" ? (
          <ScheduleJobListPage
            jobs={time.scheduleJobs}
            timezone={timezone}
            siliconPersonNameById={siliconPersonNameById}
            latestRunByJobId={latestRunByJobId}
            onToggle={handleToggleScheduleJob}
            onDelete={handleDeleteScheduleJob}
            onRunNow={handleRunScheduleJobNow}
            onEdit={handleEditScheduleJob}
          />
        ) : null}

        <aside className="schedule-resource-rail" data-testid="schedule-resource-rail">
          <ResourceStatusCard
            siliconPersons={workspace.siliconPersons ?? []}
            entries={planningModel.entries}
            jobs={time.scheduleJobs}
            latestRunByJobId={latestRunByJobId}
          />
          <UnscheduledTaskCard tasks={unscheduledTasks} timezone={timezone} onArrange={() => setActiveComposer("task")} />
        </aside>
      </section>

      {timelineContextMenu ? (
        <div
          className="timeline-context-menu"
          style={{ left: timelineContextMenu.x, top: timelineContextMenu.y }}
          onMouseLeave={closeTimelineContextMenu}
        >
          <button
            type="button"
            onClick={() => {
              openEventComposer({
                initialStartsAt: timelineContextMenu.anchorInput,
                initialEndsAt: timelineContextMenu.anchorInput,
              });
              closeTimelineContextMenu();
            }}
          >
            新建日程
          </button>
          <button
            type="button"
            onClick={() => {
              openEventComposer({
                initialStartsAt: timelineContextMenu.anchorInput,
                initialEndsAt: timelineContextMenu.anchorInput,
              });
              closeTimelineContextMenu();
            }}
          >
            用此时间新建
          </button>
          <button type="button" onClick={closeTimelineContextMenu}>
            关闭
          </button>
        </div>
      ) : null}

      {activeComposer ? (
        <ComposerModal
          activeComposer={activeComposer}
          onSelectComposer={(composer) => {
            setActiveComposer(composer);
            // 切到非定时任务 tab 时清空 type/edit 状态，避免误带到下次。
            if (composer !== "job") {
              setChosenJobType(null);
              setEditingJob(null);
            } else if (!editingJob && chosenJobType === null) {
              setChosenJobType("assistant_prompt");
            }
            if (composer !== "event") setEditingEvent(null);
            if (composer !== "reminder") setEditingReminder(null);
            if (composer !== "task") setEditingTask(null);
          }}
          timezone={timezone}
          availabilityPolicy={time.availabilityPolicy}
          timelineDefaults={timelineDefaults}
          onClose={() => {
            setActiveComposer(null);
            clearEditingState();
            setTimelineDefaults({});
            closeTimelineContextMenu();
          }}
          onSaveEvent={handleSaveCalendarEvent}
          onSaveTask={handleSaveTaskCommitment}
          onSaveReminder={handleSaveReminder}
          onSaveJob={handleSaveScheduleJob}
          onSaveAvailabilityPolicy={handleSaveAvailabilityPolicy}
          chosenJobType={chosenJobType}
          editingJob={editingJob}
          editingEvent={editingEvent}
          editingReminder={editingReminder}
          editingTask={editingTask}
          onChooseJobType={setChosenJobType}
          onClearJobType={() => setChosenJobType(null)}
          workflowOptions={workflowOptions}
          siliconPersonOptions={siliconPersonOptions}
          modelOptions={modelOptions}
        />
      ) : null}

      {selectedTimelineEntry && selectedTimelineItem ? (
        <TimelineEntryDetailModal
          entry={selectedTimelineEntry}
          item={selectedTimelineItem}
          timezone={timezone}
          onClose={() => setSelectedTimelineEntry(null)}
          onEdit={handleEditSelectedTimelineItem}
          onDelete={handleDeleteSelectedTimelineItem}
        />
      ) : null}

      <style>{styles}</style>
    </main>
  );
}

/** 渲染统一图标按钮，避免定时任务操作区文案过长占位。 */
function ActionIconButton({
  title,
  onClick,
  variant = "default",
  loading = false,
  disabled = false,
  children,
}: {
  title: string;
  onClick: () => void | Promise<void>;
  variant?: "default" | "danger";
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const baseClass = variant === "danger"
    ? "job-action-icon-btn job-action-icon-btn--danger"
    : "job-action-icon-btn";
  const className = loading ? `${baseClass} is-loading` : baseClass;
  const isDisabled = loading || disabled;
  return (
    <button
      type="button"
      className={className}
      aria-label={title}
      aria-busy={loading || undefined}
      title={title}
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) return;
        void onClick();
      }}
    >
      {loading ? <IconSpinner /> : children}
    </button>
  );
}

function IconSpinner(): React.JSX.Element {
  return (
    <svg className="icon-spinner" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="40 60"
      />
    </svg>
  );
}

function IconEdit(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75l11-11.04-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0L15.13 5.13l3.75 3.75 1.83-1.84z"
      />
    </svg>
  );
}

/** 根据定时任务执行器推导存储归属，确保员工任务进入员工分区而不是主日程 personal。 */
function resolveScheduleJobOwnerDraft(
  input: ScheduleJobEditorSubmitInput,
  fallback?: ScheduleJob | null,
): ScheduleJobOwnerDraft {
  if (input.executor === "silicon_person" && input.executorTargetId) {
    return { ownerScope: "silicon_person", ownerId: input.executorTargetId };
  }
  if (fallback?.ownerScope === "silicon_person") {
    return { ownerScope: "silicon_person", ownerId: fallback.ownerId };
  }
  return { ownerScope: "personal" };
}

function formatExecutorLabel(executor: ScheduleJobExecutor): string {
  if (executor === "assistant_prompt") return "Prompt";
  if (executor === "workflow") return "Workflow";
  return "员工";
}

function IconClose(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"
      />
    </svg>
  );
}

function IconPlay(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M8 5.5a1 1 0 0 1 1.5-.87l9 5.5a1 1 0 0 1 0 1.74l-9 5.5A1 1 0 0 1 8 16.5v-11z" />
    </svg>
  );
}

function IconRestore(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 4a8 8 0 0 1 7.75 6h-2.1A6 6 0 1 0 16.24 16l-1.64-1.65 1.41-1.41L20 17.93 15.01 23l-1.41-1.41L16 19.18A8 8 0 1 1 12 4zM5 3v5h5l-1.9-1.9A7.95 7.95 0 0 1 12 4v2a5.95 5.95 0 0 0-2.49.54L8 5H5z"
      />
    </svg>
  );
}

function IconPause(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z" />
    </svg>
  );
}

function IconTrash(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9zm1 12h8a2 2 0 0 0 2-2V8H6v11a2 2 0 0 0 2 2z"
      />
    </svg>
  );
}

/** 渲染主区视图切换：时间轴默认，日程/提醒/定时任务拥有独立列表页。 */
function PlanningViewSwitcher({
  activeView,
  onChange,
}: {
  activeView: PlanningView;
  onChange: (view: PlanningView) => void;
}) {
  const views: Array<{ key: PlanningView; label: string }> = [
    { key: "timeline", label: "时间轴" },
    { key: "events", label: "日程列表" },
    { key: "reminders", label: "提醒列表" },
    { key: "jobs", label: "定时任务" },
  ];

  return (
    <nav className="planning-view-switcher" aria-label="日程规划视图">
      {views.map((view) => (
        <button
          key={view.key}
          type="button"
          className={view.key === activeView ? "planning-view-tab is-active" : "planning-view-tab"}
          onClick={() => onChange(view.key)}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}

/** 渲染轻量顶部汇总条，避免占用时间轴首屏空间。 */
function ScheduleSummaryBar({ model, feedback }: { model: SchedulePlanningModel; feedback: string }) {
  const metrics = [
    { label: "我的安排", value: model.personalCount },
    { label: "硅基人任务", value: model.siliconCount },
    { label: "定时任务", value: model.scheduleJobCount },
    { label: "异常", value: model.failedJobCount },
  ];

  return (
    <section className="schedule-summary-bar" data-testid="schedule-summary-bar" aria-label="日程规划汇总">
      <div className="schedule-summary-bar__metrics">
        {metrics.map((metric) => (
          <span key={metric.label} className={metric.label === "异常" && metric.value > 0 ? "summary-chip is-warning" : "summary-chip"}>
            <span className="summary-chip__label">{metric.label}</span>
            <strong className="summary-chip__value">{metric.value}</strong>
          </span>
        ))}
      </div>
      {feedback ? <span className="schedule-summary-bar__feedback">{feedback}</span> : null}
    </section>
  );
}

/** 渲染日期切换，默认让用户停留在今天的日程时间轴。 */
function DateNavigator({
  selectedDate,
  todayDateKey,
  timezone,
  onSelectDate,
}: {
  selectedDate: string;
  todayDateKey: string;
  timezone: string;
  onSelectDate: (dateKey: string) => void;
}) {
  return (
    <div className="date-navigator" aria-label="日期切换">
      <button type="button" className="icon-btn" aria-label="前一天" onClick={() => onSelectDate(addDaysToDateKey(selectedDate, -1))}>
        ←
      </button>
      <button type="button" className="btn-toolbar" onClick={() => onSelectDate(todayDateKey)}>
        今天
      </button>
      <button type="button" className="btn-toolbar" onClick={() => onSelectDate(addDaysToDateKey(todayDateKey, 1))}>
        明天
      </button>
      <button type="button" className="btn-toolbar" onClick={() => onSelectDate(todayDateKey)}>
        本周
      </button>
      <span className="date-navigator__label">{formatDateTitle(selectedDate, timezone)}</span>
      <button type="button" className="icon-btn" aria-label="后一天" onClick={() => onSelectDate(addDaysToDateKey(selectedDate, 1))}>
        →
      </button>
    </div>
  );
}

/** 渲染时间轴标题，保持顶部汇总和主体日程的层级分离。 */
function TimelineHeader({
  selectedDate,
  timezone,
  entryCount,
}: {
  selectedDate: string;
  timezone: string;
  entryCount: number;
}) {
  return (
    <header className="timeline-header">
      <div>
        <h3>时间轴日程</h3>
        <p>{formatDateTitle(selectedDate, timezone)} · {entryCount} 个时间条目</p>
      </div>
      <span className="timeline-header__hint">我 / 硅基人 / 自动任务</span>
    </header>
  );
}

/** 渲染统一时间轴，保留按小时阅读，同时让空白时间块能直接操作。*/
function ScheduleTimeline({
  entries,
  hiddenEntryCount,
  timezone,
  selectedDate,
  todayDateKey,
  onCreateEvent,
  onOpenEntry,
  onContextMenu,
  onDragSelectStart,
  onDragSelectMove,
}: {
  entries: TimelineEntry[];
  hiddenEntryCount: number;
  timezone: string;
  selectedDate: string;
  todayDateKey: string;
  onCreateEvent: (defaults: TimelineComposerDefaults["event"]) => void;
  onOpenEntry: (entry: TimelineEntry) => void;
  onContextMenu: (event: React.MouseEvent, anchorInput: string, entry?: TimelineEntry | null) => void;
  onDragSelectStart: (anchorInput: string, clientY: number) => void;
  onDragSelectMove: (anchorInput: string, clientY: number) => void;
}) {
  const entriesByHour = useMemo(() => {
    const result = new Map<number, TimelineEntry[]>();
    DAY_HOURS.forEach((hour) => result.set(hour, []));
    entries.forEach((entry) => {
      const hour = Math.min(23, getLocalHour(entry.startsAt, timezone));
      result.get(hour)?.push(entry);
    });
    return result;
  }, [entries, timezone]);

  const isToday = selectedDate === todayDateKey;
  const [now, setNow] = useState<Date | null>(() => (isToday ? new Date() : null));
  useEffect(() => {
    if (!isToday) {
      setNow(null);
      return;
    }
    setNow((current) => current ?? new Date());
    const handle = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(handle);
  }, [isToday]);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const [nowTop, setNowTop] = useState<number | null>(null);
  const didScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (!isToday || !now || !boardRef.current) {
      setNowTop(null);
      didScrollRef.current = false;
      return;
    }
    const hour = Math.min(23, getLocalHour(now.toISOString(), timezone));
    const minute = getLocalMinute(now.toISOString(), timezone);
    const board = boardRef.current;
    const row = board.querySelector<HTMLElement>(`[data-testid="timeline-hour-${hour}"]`);
    if (!row) {
      setNowTop(null);
      return;
    }
    const top = row.offsetTop + (minute / 60) * row.offsetHeight;
    setNowTop(top);
    if (!didScrollRef.current) {
      board.scrollTop = Math.max(0, top - 160);
      didScrollRef.current = true;
    }
  }, [isToday, now, timezone, entries.length]);

  function buildLocalInput(hour: number, minute = 0) {
    return `${selectedDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function addHoursToLocalInput(localValue: string, hours: number) {
    const [datePart, timePart] = localValue.split("T");
    const [year, month, day] = datePart.split("-").map((value) => Number(value));
    const [hour, minute = 0] = timePart.split(":").map((value) => Number(value));
    const next = new Date(Date.UTC(year, month - 1, day, hour + hours, minute, 0));
    return next.toISOString().slice(0, 16);
  }

  function openHourEvent(hour: number) {
    const start = buildLocalInput(Math.min(23, hour), 0);
    const end = hour >= 23 ? addHoursToLocalInput(start, 1) : buildLocalInput(hour + 1, 0);
    onCreateEvent({ initialStartsAt: start, initialEndsAt: end });
  }

  return (
    <div className="timeline-board" ref={boardRef}>
      {DAY_HOURS.map((hour) => {
        const hourEntries = entriesByHour.get(hour) ?? [];
        const hourStartInput = buildLocalInput(Math.min(23, hour), 0);
        const hourEndInput = hour >= 23 ? addHoursToLocalInput(hourStartInput, 1) : buildLocalInput(hour + 1, 0);
        return (
          <section key={hour} className="timeline-hour-row" data-testid={`timeline-hour-${hour}`}>
            <span className="timeline-hour-row__label">{hour === 24 ? "24:00" : `${String(hour).padStart(2, "0")}:00`}</span>
            <ol
              className="timeline-hour-row__items"
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                if (event.target instanceof HTMLElement && event.target.closest(".timeline-entry")) return;
                onDragSelectStart(hourStartInput, event.clientY);
              }}
              onMouseMove={(event) => {
                if ((event.buttons & 1) !== 1) return;
                if (event.target instanceof HTMLElement && event.target.closest(".timeline-entry")) return;
                onDragSelectMove(hourEndInput, event.clientY);
              }}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                openHourEvent(hour);
              }}
              onContextMenu={(event) => {
                if (event.target instanceof HTMLElement && event.target.closest(".timeline-entry")) return;
                event.preventDefault();
                onContextMenu(event, hourStartInput, null);
              }}
            >
              {hourEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="timeline-entry-item"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu(event, utcIsoToLocalDateTimeInput(entry.startsAt, timezone), entry);
                  }}
                >
                  <button
                    type="button"
                    className={`timeline-entry timeline-entry--${entry.tone}`}
                    aria-label={`查看${entry.displayTitle}`}
                    onClick={() => onOpenEntry(entry)}
                  >
                    <div className="timeline-entry__dot" />
                    <span className="timeline-entry__time">{formatTimeRange(entry.startsAt, entry.endsAt, timezone)}</span>
                    <div className="timeline-entry__body">
                      <div className="timeline-entry__title-row">
                        <strong>{entry.displayTitle}</strong>
                        <span className="tag">{entry.sourceLabel}</span>
                      </div>
                      <p>{entry.meta}</p>
                      {entry.lastRunLabel ? <span className="timeline-entry__run">{entry.lastRunLabel}</span> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {isToday && now && nowTop !== null ? (
        <div className="timeline-now-line" style={{ top: nowTop }} data-testid="timeline-now-line" aria-hidden="true">
          <span className="timeline-now-line__dot" />
          <span className="timeline-now-line__label">{formatNowLabel(now, timezone)}</span>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <section className="timeline-empty">
          <h3>这一天还没有排定事项</h3>
          <p>可以新建日程、提醒或定时任务，把需要发生的事放进时间轴。</p>
        </section>
      ) : null}
      {hiddenEntryCount > 0 ? (
        <section className="timeline-overflow-notice" data-testid="timeline-overflow-notice">
          <strong>已折叠 {hiddenEntryCount} 个条目</strong>
          <span>切换到列表视图可以查看完整日程。</span>
        </section>
      ) : null}
    </div>
  );
}

/** 渲染时间轴条目的详情弹层，承载查看、编辑和删除三个基础动作。 */
function TimelineEntryDetailModal({
  entry,
  item,
  timezone,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: TimelineEntry;
  item: TimelineEntryItem;
  timezone: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const dialogTitle = getTimelineDetailDialogTitle(entry.kind);
  const detailRows = buildTimelineDetailRows(entry, item, timezone);
  return (
    <div
      className="timeline-detail-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="timeline-detail-modal" role="dialog" aria-modal="true" aria-label={dialogTitle}>
        <header className="timeline-detail-modal__header">
          <div>
            <span className="timeline-detail-modal__eyebrow">{entry.sourceLabel}</span>
            <h3>{entry.displayTitle}</h3>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭详情" onClick={onClose}>
            ×
          </button>
        </header>

        <dl className="timeline-detail-list">
          {detailRows.map((row) => (
            <div key={row.label} className="timeline-detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        <footer className="timeline-detail-actions">
          <button type="button" className="btn-toolbar" onClick={onEdit}>
            编辑
          </button>
          <button
            type="button"
            className="btn-toolbar timeline-detail-actions__danger"
            onClick={() => void onDelete()}
          >
            删除
          </button>
        </footer>
      </section>
    </div>
  );
}
function CalendarEventListPage({
  events,
  selectedDate,
  timezone,
  siliconPersonNameById,
}: {
  events: CalendarEvent[];
  selectedDate: string;
  timezone: string;
  siliconPersonNameById: ReadonlyMap<string, string>;
}) {
  const visibleEvents = events
    .filter((event) => event.status !== "cancelled" && isoToDateKey(event.startsAt, timezone) === selectedDate)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  return (
    <section className="schedule-list-page">
      <header className="list-page-header">
        <h3>日程列表</h3>
        <p>{formatDateTitle(selectedDate, timezone)} · {visibleEvents.length} 个日程</p>
      </header>
      <div className="list-page-body">
        {visibleEvents.length === 0 ? <p className="side-empty">这一天没有日程。</p> : null}
        {visibleEvents.map((event) => {
          const ownerLabel = resolveOwnerLabel(event.ownerScope, event.ownerId, siliconPersonNameById);
          return (
            <article key={event.id} className="list-page-row">
              <span className="list-page-row__time">{formatTimeRange(event.startsAt, event.endsAt, timezone)}</span>
              <div>
                <strong>{buildDisplayTitle(ownerLabel, event.title, event.ownerScope)}</strong>
                <span>{ownerLabel}{event.location ? ` · ${event.location}` : ""}</span>
              </div>
              <span className="tag">{event.ownerScope === "silicon_person" ? "硅基人日程" : "日程"}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** 渲染独立提醒列表页，提醒删除动作不再挤占时间轴侧栏。 */
function ReminderListPage({
  reminders,
  timezone,
  onDelete,
}: {
  reminders: Reminder[];
  timezone: string;
  onDelete: (id: string) => Promise<void>;
}) {
  const visibleReminders = reminders
    .filter((reminder) => reminder.status === "scheduled")
    .sort((left, right) => left.triggerAt.localeCompare(right.triggerAt));

  return (
    <section className="schedule-list-page">
      <header className="list-page-header">
        <h3>提醒列表</h3>
        <p>{visibleReminders.length} 个待触发提醒</p>
      </header>
      <div className="list-page-body">
        {visibleReminders.length === 0 ? <p className="side-empty">暂无提醒。</p> : null}
        {visibleReminders.map((reminder) => (
          <article key={reminder.id} className="list-page-row">
            <span className="list-page-row__time">{formatDateTime(reminder.triggerAt, timezone)}</span>
            <div>
              <strong>{reminder.title}</strong>
              <span>{reminder.body ?? "到点提醒"}</span>
            </div>
            <button type="button" className="btn-ghost" onClick={() => void onDelete(reminder.id)}>
              删除提醒
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

/** 渲染独立定时任务页，承载暂停、恢复、删除等管理动作。 */
function ScheduleJobListPage({
  jobs,
  timezone,
  siliconPersonNameById,
  latestRunByJobId,
  onToggle,
  onDelete,
  onRunNow,
  onEdit,
}: {
  jobs: ScheduleJob[];
  timezone: string;
  siliconPersonNameById: ReadonlyMap<string, string>;
  latestRunByJobId: ReadonlyMap<string, ExecutionRun>;
  onToggle: (job: ScheduleJob) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRunNow: (job: ScheduleJob) => Promise<void>;
  onEdit: (job: ScheduleJob) => void;
}) {
  const navigate = useNavigate();
  const [pendingRunIds, setPendingRunIds] = useState<Set<string>>(() => new Set());
  const [typeFilter, setTypeFilter] = useState<"all" | ScheduleJobExecutor>("all");

  const filteredJobs = useMemo(
    () => (typeFilter === "all" ? jobs : jobs.filter((job) => job.executor === typeFilter)),
    [jobs, typeFilter],
  );

  /** 包一层 onRunNow：本地标记 pending → await → 清理。失败也兜底清理。 */
  async function handleRunClick(job: ScheduleJob) {
    if (pendingRunIds.has(job.id)) return;
    setPendingRunIds((prev) => {
      const next = new Set(prev);
      next.add(job.id);
      return next;
    });
    try {
      await onRunNow(job);
    } finally {
      setPendingRunIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  }

  return (
    <section className="schedule-list-page">
      <header className="list-page-header">
        <h3>定时任务</h3>
        <p>{jobs.length} 个自动触发任务 · 点行打开任务详情页</p>
      </header>
      <div className="job-type-filter" role="group" aria-label="按类型筛选">
        {(["all", "assistant_prompt", "workflow", "silicon_person"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={typeFilter === value ? "job-type-filter__chip is-active" : "job-type-filter__chip"}
            onClick={() => setTypeFilter(value)}
          >
            {value === "all" ? "全部" : formatExecutorLabel(value)}
          </button>
        ))}
      </div>
      <div className="list-page-body">
          {filteredJobs.length === 0 ? (
            <p className="side-empty">{jobs.length === 0 ? "暂无定时任务。" : "当前筛选下没有任务。"}</p>
          ) : null}
        {filteredJobs.map((job) => {
          const latestRun = latestRunByJobId.get(job.id);
          const isRunPending = pendingRunIds.has(job.id);
          return (
            <article
              key={job.id}
              className="list-page-row list-page-row--job is-clickable"
              role="button"
              tabIndex={0}
              aria-label={`打开 ${job.title} 的详情页`}
              onClick={() => void navigate(`/time/jobs/${job.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void navigate(`/time/jobs/${job.id}`);
                }
              }}
            >
              <div className="job-row__schedule-col">
                <span className="list-page-row__time">{job.nextRunAt ? formatDateTime(job.nextRunAt, timezone) : "等待调度"}</span>
                <span className={`status-badge status-badge--${job.status === "running" ? "active" : job.status === "paused" ? "muted" : "normal"}`}>
                  {formatScheduleJobStatus(job.status)}
                </span>
              </div>
              <div className="job-row__info-col">
                <div className="job-row__title-line">
                  <strong>{job.title}</strong>
                  <span className={`job-type-chip job-type-chip--${job.executor}`}>{formatExecutorLabel(job.executor)}</span>
                </div>
                  <span>
                    {buildJobOwnerLabel(job, siliconPersonNameById)} · {formatJobFrequency(job, (iso) => formatDateTime(iso, timezone))}
                  </span>
              </div>
              <div className="job-row__run-col">
                {latestRun ? <span className={latestRun.status === "failed" ? "job-row__run is-warning" : "job-row__run"}>{formatLatestRunLabel(latestRun)}</span> : <span>—</span>}
              </div>
              <div className="job-row__actions" onClick={(event) => event.stopPropagation()}>
                  <ActionIconButton
                    title={isRunPending ? "执行中" : "立即执行"}
                    loading={isRunPending}
                    onClick={() => handleRunClick(job)}
                  >
                  <IconPlay />
                </ActionIconButton>
                <ActionIconButton title="编辑" onClick={() => onEdit(job)}>
                  <IconEdit />
                </ActionIconButton>
                <ActionIconButton title={job.status === "paused" ? "恢复" : "暂停"} onClick={() => onToggle(job)}>
                  {job.status === "paused" ? <IconRestore /> : <IconPause />}
                </ActionIconButton>
                <ActionIconButton title="删除" variant="danger" onClick={() => onDelete(job.id)}>
                  <IconTrash />
                </ActionIconButton>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type JobTypeCard = {
  type: ScheduleJobExecutor;
  title: string;
  description: string;
  icon: React.ReactNode;
};

const JOB_TYPE_CARDS: JobTypeCard[] = [
  {
    type: "assistant_prompt",
    title: "Prompt 任务",
    description: "让模型按时回答 / 总结，输出 Markdown 直接渲染。",
    icon: <span aria-hidden="true">💬</span>,
  },
  {
    type: "workflow",
    title: "Workflow 任务",
    description: "到点跑工作流（自动发布、检查、提醒等流程）。",
    icon: <span aria-hidden="true">⚙️</span>,
  },
  {
    type: "silicon_person",
    title: "调用员工任务",
    description: "到点向员工派发消息，让员工按其角色处理。",
    icon: <span aria-hidden="true">👤</span>,
  },
];

/** 第一步：选择要创建哪种类型的定时任务。 */
function ScheduleJobTypePicker({ onPick }: { onPick: (type: ScheduleJobExecutor) => void }) {
  return (
    <div className="job-type-picker" role="group" aria-label="选择定时任务类型">
      {JOB_TYPE_CARDS.map((card) => (
        <button
          key={card.type}
          type="button"
          className={`job-type-picker__card job-type-picker__card--${card.type}`}
          onClick={() => onPick(card.type)}
        >
          <span className="job-type-picker__icon">{card.icon}</span>
          <span className="job-type-picker__title">{card.title}</span>
          <span className="job-type-picker__desc">{card.description}</span>
        </button>
      ))}
    </div>
  );
}

/** 渲染日程规划编辑弹层，采用桌面端居中高斯模糊背景。 */
function ComposerModal({
  activeComposer,
  onSelectComposer,
  timezone,
  availabilityPolicy,
  timelineDefaults,
  onClose,
  onSaveEvent,
  onSaveTask,
  onSaveReminder,
  onSaveJob,
  onSaveAvailabilityPolicy,
  chosenJobType,
  editingEvent,
  editingReminder,
  editingTask,
  editingJob,
  onChooseJobType,
  onClearJobType,
  workflowOptions,
  siliconPersonOptions,
  modelOptions,
}: {
  activeComposer: ComposerKind;
  onSelectComposer: (composer: ComposerKind) => void;
  timezone: string;
  availabilityPolicy: AvailabilityPolicy | null;
  onClose: () => void;
  onSaveEvent: (input: CalendarEventEditorSubmitInput) => void | Promise<void>;
  onSaveTask: (input: TaskCommitmentEditorSubmitInput) => void | Promise<void>;
  onSaveReminder: (input: ReminderEditorSubmitInput) => void | Promise<void>;
  onSaveJob: (input: ScheduleJobEditorSubmitInput, mode: "create" | "update") => void | Promise<void>;
  onSaveAvailabilityPolicy: (policy: AvailabilityPolicy) => void | Promise<void>;
  chosenJobType: ScheduleJobExecutor | null;
  editingEvent: CalendarEvent | null;
  editingReminder: Reminder | null;
  editingTask: TaskCommitment | null;
  editingJob: ScheduleJob | null;
  timelineDefaults: TimelineComposerDefaults;
  onChooseJobType: (type: ScheduleJobExecutor) => void;
  onClearJobType: () => void;
  workflowOptions: { id: string; name: string }[];
  siliconPersonOptions: { id: string; name: string }[];
  modelOptions: { id: string; name: string }[];
}) {
  const title = {
    event: editingEvent ? "编辑日程" : "新建日程",
    reminder: editingReminder ? "编辑提醒" : "新建提醒",
    job: editingJob ? "编辑定时任务" : "新建定时任务",
    task: editingTask ? "编辑任务" : "安排任务",
    rules: "时间规则",
  }[activeComposer];
  const composerTabMeta: Record<ComposerKind, { label: string; hint: string }> = {
    event: { label: "日程", hint: "有明确起止时间的事项" },
    reminder: { label: "提醒", hint: "在特定时间点触发通知" },
    job: { label: "定时任务", hint: "自动执行工作流或动作" },
    task: { label: "任务", hint: "记录待办，可后续排时间" },
    rules: { label: "时间规则", hint: "工作时段与静默规则" },
  };
  const allTabs: ComposerKind[] = ["event", "reminder", "job", "task", "rules"];

  return (
    <div
      className="schedule-composer-modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="schedule-composer-modal" role="dialog" aria-modal="true" aria-label={title} data-testid="schedule-composer-modal">
        <header className="schedule-composer-modal__header">
          <div className="schedule-composer-modal__heading">
            <h3>{title}</h3>
            <span>{composerTabMeta[activeComposer].hint}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭编辑" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="composer-tabs-row" role="group" aria-label="新建类型">
          {allTabs.map((tabKey) => {
            const tab = composerTabMeta[tabKey];
            return (
              <button
                key={tabKey}
                type="button"
                aria-label={tab.label}
                className={tabKey === activeComposer ? "composer-tab-btn is-active" : "composer-tab-btn"}
                onClick={() => onSelectComposer(tabKey)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="schedule-composer-modal__body">
          {activeComposer === "event" ? (
            <CalendarEventEditor
              key={editingEvent?.id ?? "new-event"}
              timezone={timezone}
              initialTitle={editingEvent?.title ?? timelineDefaults.event?.initialTitle}
              initialLocation={editingEvent?.location ?? timelineDefaults.event?.initialLocation}
              initialDescription={editingEvent?.description ?? timelineDefaults.event?.initialDescription}
              initialStartsAt={editingEvent ? utcIsoToLocalDateTimeInput(editingEvent.startsAt, editingEvent.timezone) : timelineDefaults.event?.initialStartsAt}
              initialEndsAt={editingEvent ? utcIsoToLocalDateTimeInput(editingEvent.endsAt, editingEvent.timezone) : timelineDefaults.event?.initialEndsAt}
              onSave={onSaveEvent}
            />
          ) : null}
          {activeComposer === "reminder" ? (
            <ReminderEditor
              key={editingReminder?.id ?? "new-reminder"}
              timezone={timezone}
              initialTitle={editingReminder?.title ?? timelineDefaults.reminder?.initialTitle}
              initialBody={editingReminder?.body ?? timelineDefaults.reminder?.initialBody}
              initialTriggerAt={editingReminder ? utcIsoToLocalDateTimeInput(editingReminder.triggerAt, editingReminder.timezone) : timelineDefaults.reminder?.initialTriggerAt}
              onSave={onSaveReminder}
            />
          ) : null}
          {activeComposer === "job" ? (
            chosenJobType === null && !editingJob ? (
              <ScheduleJobTypePicker onPick={onChooseJobType} />
            ) : (
              <ScheduleJobEditor
                timezone={timezone}
                executor={editingJob ? editingJob.executor : (chosenJobType ?? "assistant_prompt")}
                initialJob={editingJob ?? undefined}
                workflows={workflowOptions}
                siliconPersons={siliconPersonOptions}
                modelOptions={modelOptions}
                onSave={onSaveJob}
                onCancel={editingJob ? onClose : onClearJobType}
              />
            )
          ) : null}
          {activeComposer === "task" ? (
            <TaskCommitmentEditor
              key={editingTask?.id ?? "new-task"}
              timezone={timezone}
              initialTitle={editingTask?.title ?? timelineDefaults.task?.initialTitle}
              initialDescription={editingTask?.description ?? timelineDefaults.task?.initialDescription}
              initialDueAt={editingTask?.dueAt ? utcIsoToLocalDateTimeInput(editingTask.dueAt, editingTask.timezone) : timelineDefaults.task?.initialDueAt}
              initialDurationMinutes={editingTask?.durationMinutes ? String(editingTask.durationMinutes) : timelineDefaults.task?.initialDurationMinutes}
              initialPriority={editingTask?.priority}
              onSave={onSaveTask}
            />
          ) : null}
          {activeComposer === "rules" ? (
            <AvailabilityPolicyForm policy={availabilityPolicy} timezone={timezone} onSave={onSaveAvailabilityPolicy} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** 渲染资源状态：我和每个硅基人在当前日期的占用情况。 */
function ResourceStatusCard({
  siliconPersons,
  entries,
  jobs,
  latestRunByJobId,
}: {
  siliconPersons: SiliconPerson[];
  entries: TimelineEntry[];
  jobs: ScheduleJob[];
  latestRunByJobId: ReadonlyMap<string, ExecutionRun>;
}) {
  const resourceStats = useMemo(() => {
    const personEntryCounts = new Map<string, number>();
    const personJobStates = new Map<string, { hasFailedRun: boolean; hasRunningJob: boolean }>();
    let personalEntryCount = 0;

    for (const entry of entries) {
      if (entry.ownerScope === "personal") {
        personalEntryCount += 1;
        continue;
      }
      if (entry.ownerId) {
        personEntryCounts.set(entry.ownerId, (personEntryCounts.get(entry.ownerId) ?? 0) + 1);
      }
    }

    for (const job of jobs) {
      if (job.ownerScope !== "silicon_person" || !job.ownerId) {
        continue;
      }
      const current = personJobStates.get(job.ownerId) ?? { hasFailedRun: false, hasRunningJob: false };
      current.hasFailedRun = current.hasFailedRun || latestRunByJobId.get(job.id)?.status === "failed" || job.status === "failed";
      current.hasRunningJob = current.hasRunningJob || job.status === "running";
      personJobStates.set(job.ownerId, current);
    }

    return { personalEntryCount, personEntryCounts, personJobStates };
  }, [entries, jobs, latestRunByJobId]);

  return (
    <section className="side-card">
      <header className="side-card__header">
        <h3>资源状态</h3>
      </header>
      <div className="resource-list">
        <article className="resource-row">
          <span className={resourceStats.personalEntryCount > 0 ? "status-dot status-dot--accent" : "status-dot status-dot--muted"} />
          <div>
            <strong>我</strong>
            <span>{resourceStats.personalEntryCount > 0 ? `已排 ${resourceStats.personalEntryCount} 项` : "空闲"}</span>
          </div>
        </article>

        {siliconPersons.length === 0 ? (
          <p className="side-empty">暂无硅基人，后续创建后会在这里显示资源占用。</p>
        ) : (
          siliconPersons.map((person) => {
            const personEntryCount = resourceStats.personEntryCounts.get(person.id) ?? 0;
            const personJobState = resourceStats.personJobStates.get(person.id);
            const hasFailedRun = Boolean(personJobState?.hasFailedRun);
            const hasRunningJob = Boolean(personJobState?.hasRunningJob);
            const statusText = hasRunningJob
              ? "运行中"
              : hasFailedRun
              ? "有异常"
              : personEntryCount > 0
              ? `已排 ${personEntryCount} 项`
              : "空闲";
            return (
              <article key={person.id} className="resource-row">
                <span className={hasFailedRun ? "status-dot status-dot--red" : hasRunningJob ? "status-dot status-dot--accent" : "status-dot status-dot--green"} />
                <div>
                  <strong>{person.name}</strong>
                  <span>{statusText}</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

/** 渲染定时任务状态栏，确保自动发生的事始终可见、可暂停。 */
function ScheduleJobStatusCard({
  jobs,
  timezone,
  siliconPersonNameById,
  latestRunByJobId,
  onToggle,
  onDelete,
}: {
  jobs: ScheduleJob[];
  timezone: string;
  siliconPersonNameById: ReadonlyMap<string, string>;
  latestRunByJobId: ReadonlyMap<string, ExecutionRun>;
  onToggle: (job: ScheduleJob) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <section className="side-card">
      <header className="side-card__header">
        <h3>定时任务</h3>
        <span className="side-card__count">{jobs.length}</span>
      </header>
      {jobs.length === 0 ? (
        <p className="side-empty">暂无定时任务。</p>
      ) : (
        <div className="job-list">
          {jobs.map((job) => {
            const latestRun = latestRunByJobId.get(job.id);
            return (
              <article key={job.id} className="job-row">
                <div className="job-row__main">
                  <strong>{job.title}</strong>
                  <span>{buildJobOwnerLabel(job, siliconPersonNameById)} · {formatScheduleKind(job.scheduleKind)} · {formatScheduleJobStatus(job.status)}</span>
                  <span>下次：{job.nextRunAt ? formatDateTime(job.nextRunAt, timezone) : "等待调度"}</span>
                  {latestRun ? <span className={latestRun.status === "failed" ? "job-row__run is-warning" : "job-row__run"}>{formatLatestRunLabel(latestRun)}</span> : null}
                </div>
                <div className="job-row__actions">
                  <button type="button" className="btn-toolbar" onClick={() => void onToggle(job)}>
                    {job.status === "paused" ? "恢复任务" : "暂停任务"}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => void onDelete(job.id)}>
                    删除定时任务
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** 渲染近期提醒列表，并保留删除入口。 */
function ReminderStatusCard({
  reminders,
  timezone,
  onDelete,
}: {
  reminders: Reminder[];
  timezone: string;
  onDelete: (id: string) => Promise<void>;
}) {
  const scheduledReminders = reminders
    .filter((reminder) => reminder.status === "scheduled")
    .sort((left, right) => left.triggerAt.localeCompare(right.triggerAt))
    .slice(0, 4);

  return (
    <section className="side-card">
      <header className="side-card__header">
        <h3>提醒</h3>
        <span className="side-card__count">{scheduledReminders.length}</span>
      </header>
      {scheduledReminders.length === 0 ? (
        <p className="side-empty">暂无待触发提醒。</p>
      ) : (
        <div className="compact-list">
          {scheduledReminders.map((reminder) => (
            <article key={reminder.id} className="compact-row">
              <div>
                <strong>{reminder.title}</strong>
                <span>{formatDateTime(reminder.triggerAt, timezone)}</span>
              </div>
              <button type="button" className="btn-ghost" onClick={() => void onDelete(reminder.id)}>
                删除提醒
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** 渲染待安排任务，避免未定时任务污染主时间轴。 */
function UnscheduledTaskCard({
  tasks,
  timezone,
  onArrange,
}: {
  tasks: TaskCommitment[];
  timezone: string;
  onArrange: () => void;
}) {
  const visibleTasks = tasks.slice(0, MAX_SIDE_RAIL_TASKS);
  const hiddenTaskCount = Math.max(0, tasks.length - visibleTasks.length);

  return (
    <section className="side-card">
      <header className="side-card__header">
        <h3>待安排任务</h3>
        <span className="side-card__count">{tasks.length}</span>
      </header>
      {tasks.length === 0 ? (
        <p className="side-empty">没有未安排时间的任务。</p>
      ) : (
        <div className="compact-list">
          {visibleTasks.map((task) => (
            <article key={task.id} className="compact-row">
              <div>
                <strong>{task.title}</strong>
                <span>{formatPriority(task.priority)} · {task.durationMinutes ? `${task.durationMinutes} 分钟` : "未设时长"}</span>
              </div>
              <button type="button" className="btn-toolbar" onClick={onArrange}>
                安排时间
              </button>
            </article>
          ))}
          {hiddenTaskCount > 0 ? (
            <p className="compact-overflow" data-testid="unscheduled-task-overflow">
              还有 {hiddenTaskCount} 项待安排任务未显示。
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** 根据时间轴条目反查真实实体，详情、编辑和删除都从实体本身读取最新数据。 */
function resolveTimelineEntryItem(
  entry: TimelineEntry | null,
  time: {
    calendarEvents: CalendarEvent[];
    reminders: Reminder[];
    taskCommitments: TaskCommitment[];
    scheduleJobs: ScheduleJob[];
  },
): TimelineEntryItem | null {
  if (!entry) return null;
  if (entry.kind === "calendar_event") {
    return time.calendarEvents.find((event) => event.id === entry.itemId) ?? null;
  }
  if (entry.kind === "reminder") {
    return time.reminders.find((reminder) => reminder.id === entry.itemId) ?? null;
  }
  if (entry.kind === "task_commitment") {
    return time.taskCommitments.find((task) => task.id === entry.itemId) ?? null;
  }
  return time.scheduleJobs.find((job) => job.id === entry.itemId) ?? null;
}

/** 将条目类型映射为详情弹层标题。 */
function getTimelineDetailDialogTitle(kind: TimelineEntryKind): string {
  return ({
    calendar_event: "日程详情",
    reminder: "提醒详情",
    task_commitment: "任务详情",
    schedule_job: "定时任务详情",
  } satisfies Record<TimelineEntryKind, string>)[kind];
}

/** 生成详情弹层的描述行，保持日历式查看面板的信息密度。 */
function buildTimelineDetailRows(entry: TimelineEntry, item: TimelineEntryItem, timezone: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "时间", value: formatTimeRange(entry.startsAt, entry.endsAt, timezone) },
    { label: "归属", value: entry.ownerLabel },
    { label: "类型", value: entry.sourceLabel },
  ];

  if (item.kind === "calendar_event") {
    if (item.location) rows.push({ label: "地点", value: item.location });
    if (item.description) rows.push({ label: "说明", value: item.description });
    rows.push({ label: "状态", value: item.status });
  } else if (item.kind === "reminder") {
    if (item.body) rows.push({ label: "备注", value: item.body });
    rows.push({ label: "状态", value: item.status });
  } else if (item.kind === "task_commitment") {
    rows.push({ label: "优先级", value: formatPriority(item.priority) });
    if (item.durationMinutes) rows.push({ label: "预计时长", value: `${item.durationMinutes} 分钟` });
    if (item.description) rows.push({ label: "说明", value: item.description });
    rows.push({ label: "状态", value: item.status });
  } else {
    rows.push({ label: "频率", value: formatScheduleKind(item.scheduleKind) });
    rows.push({ label: "执行器", value: formatExecutorLabel(item.executor) });
    if (item.description) rows.push({ label: "说明", value: item.description });
    rows.push({ label: "状态", value: formatScheduleJobStatus(item.status) });
    if (entry.lastRunLabel) rows.push({ label: "最近运行", value: entry.lastRunLabel });
  }

  return rows;
}

/** 构建当日个人/硅基人日程的时间轴条目，仅依赖 events/dateKey。 */
function buildEventEntries(
  events: CalendarEvent[],
  dateKey: string,
  timezone: string,
  siliconPersonNameById: ReadonlyMap<string, string>,
): TimelineEntry[] {
  return events
    .filter((event) => event.status !== "cancelled" && isoToDateKey(event.startsAt, timezone) === dateKey)
    .map((event): TimelineEntry => {
      const ownerLabel = resolveOwnerLabel(event.ownerScope, event.ownerId, siliconPersonNameById);
      return {
        id: `event:${event.id}`,
        itemId: event.id,
        kind: "calendar_event",
        title: event.title,
        displayTitle: buildDisplayTitle(ownerLabel, event.title, event.ownerScope),
        ownerScope: event.ownerScope,
        ownerId: event.ownerId,
        ownerLabel,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        sourceLabel: event.ownerScope === "silicon_person" ? "硅基人日程" : "日程",
        meta: event.location ? `${ownerLabel} · ${event.location}` : ownerLabel,
        tone: event.ownerScope === "silicon_person" ? "silicon" : "personal",
      };
    });
}

/** 构建当日提醒的时间轴条目，仅依赖 reminders/dateKey。 */
function buildReminderEntries(
  reminders: Reminder[],
  dateKey: string,
  timezone: string,
  siliconPersonNameById: ReadonlyMap<string, string>,
): TimelineEntry[] {
  return reminders
    .filter((reminder) => reminder.status === "scheduled" && isoToDateKey(reminder.triggerAt, timezone) === dateKey)
    .map((reminder): TimelineEntry => ({
      id: `reminder:${reminder.id}`,
      itemId: reminder.id,
      kind: "reminder",
      title: reminder.title,
      displayTitle: `提醒：${reminder.title}`,
      ownerScope: reminder.ownerScope,
      ownerId: reminder.ownerId,
      ownerLabel: resolveOwnerLabel(reminder.ownerScope, reminder.ownerId, siliconPersonNameById),
      startsAt: reminder.triggerAt,
      sourceLabel: "提醒",
      meta: reminder.body ?? "到点提醒",
      tone: "personal",
    }));
}

/** 构建当日任务承诺的时间轴条目，仅依赖 tasks/dateKey。 */
function buildTaskEntries(
  tasks: TaskCommitment[],
  dateKey: string,
  timezone: string,
  siliconPersonNameById: ReadonlyMap<string, string>,
): TimelineEntry[] {
  return tasks
    .filter((task) =>
      task.status !== "completed"
      && task.status !== "cancelled"
      && Boolean(task.dueAt)
      && isoToDateKey(task.dueAt as string, timezone) === dateKey
    )
    .map((task): TimelineEntry => {
      const ownerLabel = resolveOwnerLabel(task.ownerScope, task.ownerId, siliconPersonNameById);
      return {
        id: `task:${task.id}`,
        itemId: task.id,
        kind: "task_commitment",
        title: task.title,
        displayTitle: buildDisplayTitle(ownerLabel, task.title, task.ownerScope),
        ownerScope: task.ownerScope,
        ownerId: task.ownerId,
        ownerLabel,
        startsAt: task.dueAt as string,
        sourceLabel: "任务",
        meta: `${ownerLabel} · ${formatPriority(task.priority)}${task.durationMinutes ? ` · ${task.durationMinutes} 分钟` : ""}`,
        tone: task.ownerScope === "silicon_person" ? "silicon" : "personal",
      };
    });
}

/** 构建当日定时任务的时间轴投影，依赖 jobs + latestRunByJobId（拆出来让 events/reminders/tasks 不受 executionRuns 变化影响）。 */
function buildJobEntries(
  jobs: ScheduleJob[],
  dateKey: string,
  timezone: string,
  latestRunByJobId: ReadonlyMap<string, ExecutionRun>,
  siliconPersonNameById: ReadonlyMap<string, string>,
): TimelineEntry[] {
  return jobs.flatMap((job) =>
    buildScheduleJobTimelineEntries(job, dateKey, timezone, latestRunByJobId, siliconPersonNameById)
  );
}

/** 构建定时任务在指定日期的时间轴投影。 */
function buildScheduleJobTimelineEntries(
  job: ScheduleJob,
  dateKey: string,
  timezone: string,
  latestRunByJobId: ReadonlyMap<string, ExecutionRun>,
  siliconPersonNameById: ReadonlyMap<string, string>,
): TimelineEntry[] {
  const candidateTimes = resolveScheduleJobTimes(job, dateKey, timezone);
  const latestRun = latestRunByJobId.get(job.id);
  const ownerLabel = resolveOwnerLabel(job.ownerScope, job.ownerId, siliconPersonNameById);
  return candidateTimes.map((startsAt, index) => ({
    id: `job:${job.id}:${startsAt}:${index}`,
    itemId: job.id,
    kind: "schedule_job",
    title: job.title,
    displayTitle: buildDisplayTitle(ownerLabel, job.title, job.ownerScope),
    ownerScope: job.ownerScope,
    ownerId: job.ownerId,
    ownerLabel,
    startsAt,
    sourceLabel: "定时任务",
    meta: `${ownerLabel} · ${formatScheduleKind(job.scheduleKind)} · ${formatScheduleJobStatus(job.status)}`,
    tone: latestRun?.status === "failed" || job.status === "failed" ? "warning" : "automation",
    lastRunLabel: latestRun ? `上次${formatExecutionRunStatus(latestRun.status)}${latestRun.errorMessage ? ` · ${latestRun.errorMessage}` : ""}` : undefined,
  }));
}

/** 解析定时任务在目标日期内的触发时刻。 */
function resolveScheduleJobTimes(job: ScheduleJob, dateKey: string, timezone: string): string[] {
  const primaryTime = job.nextRunAt ?? job.startsAt;
  if (primaryTime && isoToDateKey(primaryTime, timezone) === dateKey) {
    return [primaryTime];
  }
  if (job.scheduleKind === "cron" && job.cronExpression) {
    return enumerateCronRunsOnDate(job.cronExpression, dateKey, timezone).slice(0, 6);
  }
  return [];
}

/** 构建每个定时任务最近一次运行记录索引。 */
function buildLatestRunByJobId(runs: ExecutionRun[]): Map<string, ExecutionRun> {
  const result = new Map<string, ExecutionRun>();
  runs.forEach((run) => {
    const current = result.get(run.jobId);
    if (!current || Date.parse(run.startedAt) > Date.parse(current.startedAt)) {
      result.set(run.jobId, run);
    }
  });
  return result;
}

/** 解析 owner 展示名，硅基人缺失时回退为稳定文案。 */
function resolveOwnerLabel(
  ownerScope: TimelineOwnerScope,
  ownerId: string | undefined,
  siliconPersonNameById: ReadonlyMap<string, string>,
): string {
  if (ownerScope === "personal") return "我";
  return ownerId ? siliconPersonNameById.get(ownerId) ?? "硅基人" : "硅基人";
}

/** 统一生成时间轴标题，硅基人条目必须带 owner 前缀。 */
function buildDisplayTitle(ownerLabel: string, title: string, ownerScope: TimelineOwnerScope): string {
  return ownerScope === "silicon_person" ? `${ownerLabel} · ${title}` : title;
}

/**
 * Intl.DateTimeFormat 实例化贵且按 timezone+locale+options 完全可缓存。日程页一次渲染会
 * 调用上百次格式化（每个 timeline entry × 多次 formatClock），统一从 module-level
 * Map 拿，避免反复 new。
 */
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getDateTimeFormatter(
  cacheKey: string,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const fullKey = `${cacheKey}|${locale}|${timeZone}`;
  let formatter = dateTimeFormatterCache.get(fullKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    dateTimeFormatterCache.set(fullKey, formatter);
  }
  return formatter;
}

/** 格式化日期标题，给顶部和时间轴标题复用。 */
function formatDateTitle(dateKey: string, timezone: string): string {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  return getDateTimeFormatter("date-title", "zh-CN", timezone, {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

/** 格式化单个时间点。 */
function formatClock(iso: string, timezone: string): string {
  return getDateTimeFormatter("clock", "zh-CN", timezone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 获取指定时间在目标时区内的小时，用于把条目挂到真实 0-24 小时轴。 */
function getLocalHour(iso: string, timezone: string): number {
  const hourText = getDateTimeFormatter("local-hour", "en-CA", timezone, {
    hour: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const hour = Number(hourText);
  return hour === 24 ? 0 : hour;
}

/** 获取指定时间在目标时区内的分钟，用于按分钟比例插值 now-line。 */
function getLocalMinute(iso: string, timezone: string): number {
  const minuteText = getDateTimeFormatter("local-minute", "en-CA", timezone, {
    minute: "2-digit",
  }).format(new Date(iso));
  const minute = Number(minuteText);
  return Number.isFinite(minute) ? minute : 0;
}

/** 格式化 now-line 上展示的当前时间标签。 */
function formatNowLabel(now: Date, timezone: string): string {
  return getDateTimeFormatter("now-line", "en-CA", timezone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** 格式化时间轴条目的起止时间。 */
function formatTimeRange(startsAt: string, endsAt: string | undefined, timezone: string): string {
  const start = formatClock(startsAt, timezone);
  return endsAt ? `${start}-${formatClock(endsAt, timezone)}` : start;
}

/** 格式化日期时间，供右侧状态栏展示下次运行。 */
function formatDateTime(iso: string, timezone: string): string {
  return getDateTimeFormatter("date-time", "zh-CN", timezone, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 映射定时任务类型为中文。 */
function formatScheduleKind(kind: ScheduleJob["scheduleKind"]): string {
  return {
    once: "一次性",
    interval: "间隔",
    cron: "Cron",
  }[kind];
}

/** 映射定时任务状态为中文。 */
function formatScheduleJobStatus(status: ScheduleJob["status"]): string {
  return {
    scheduled: "已计划",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[status];
}

/** 映射运行状态为短文案，供异常和 receipts 展示。 */
function formatExecutionRunStatus(status: ExecutionRun["status"]): string {
  return {
    running: "运行中",
    succeeded: "成功",
    failed: "失败",
    cancelled: "取消",
  }[status];
}

/** 生成最近运行结果文案。 */
function formatLatestRunLabel(run: ExecutionRun): string {
  if (run.status === "failed") {
    return `上次失败${run.errorMessage ? ` · ${run.errorMessage}` : ""}`;
  }
  return `上次${formatExecutionRunStatus(run.status)}${run.outputSummary ? ` · ${run.outputSummary}` : ""}`;
}

/** 生成定时任务 owner 文案。 */
function buildJobOwnerLabel(job: ScheduleJob, siliconPersonNameById: ReadonlyMap<string, string>): string {
  return resolveOwnerLabel(job.ownerScope, job.ownerId, siliconPersonNameById);
}

/** 映射任务优先级为中文。 */
function formatPriority(priority: TaskCommitment["priority"]): string {
  return {
    low: "低优先级",
    medium: "中优先级",
    high: "高优先级",
    urgent: "紧急",
  }[priority];
}

const styles = `
  .schedule-planning-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
    padding: 24px 32px;
    background: var(--bg-base);
  }

  .schedule-planning-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-shrink: 0;
  }

  .schedule-planning-header__lead {
    display: grid;
    gap: 5px;
  }

  .schedule-planning-header__eyebrow {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .schedule-planning-header__title {
    margin: 0;
    color: var(--text-primary);
    font-size: 24px;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .schedule-planning-header__actions,
  .date-navigator {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .date-navigator {
    padding: 4px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
  }

  .date-navigator__label {
    padding: 0 10px;
    color: var(--text-secondary);
    font-size: 13px;
    white-space: nowrap;
  }

  .schedule-summary-bar {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .schedule-summary-bar__metrics {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .summary-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: 12px;
  }

  /* 红色文字走 var(--status-red) token；border/background 沿用 rgba 等价表达，待全局 alpha token 落地后再统一。 */
  .summary-chip.is-warning {
    color: var(--status-red);
    border-color: rgba(239, 68, 68, 0.28);
    background: rgba(239, 68, 68, 0.08);
  }

  .summary-chip__value {
    color: var(--text-primary);
    font-size: 14px;
  }

  .schedule-summary-bar__feedback {
    color: var(--accent-cyan);
    font-size: 12px;
    font-weight: 600;
  }

  .planning-view-switcher {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    align-self: flex-start;
    flex-shrink: 0;
  }

  .planning-view-tab {
    min-height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .planning-view-tab.is-active {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .schedule-planning-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 14px;
  }

  .schedule-timeline-panel,
  .schedule-list-page,
  .side-card {
    min-width: 0;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
  }

  .schedule-timeline-panel,
  .schedule-list-page {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .timeline-header,
  .list-page-header,
  .side-card__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .timeline-header h3,
  .list-page-header h3,
  .side-card__header h3,
  .timeline-empty h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 15px;
    line-height: 1.3;
  }

  .timeline-header p,
  .list-page-header p,
  .timeline-empty p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .timeline-header__hint,
  .side-card__count {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .timeline-overflow-notice,
  .compact-overflow {
    margin: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(96, 165, 250, 0.22);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    background: rgba(96, 165, 250, 0.08);
    font-size: 12px;
  }

  .timeline-overflow-notice {
    display: grid;
    gap: 4px;
  }

  .timeline-overflow-notice strong {
    color: var(--text-primary);
    font-size: 13px;
  }

  .timeline-board {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
  }

  .timeline-hour-row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    min-height: 58px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.045);
  }

  .timeline-hour-row__label {
    padding: 10px 10px 0 0;
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    color: var(--text-muted);
    font-size: 11px;
    text-align: right;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }

  .timeline-hour-row__items {
    margin: 0;
    padding: 12px 16px 12px 24px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .timeline-entry {
    position: relative;
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr);
    gap: 16px;
    width: 100%;
    min-height: 64px;
    padding: 16px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  }

  .timeline-entry:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .timeline-entry:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 2px;
  }

  .timeline-entry-item {
    margin: 0;
    padding: 0;
  }

  .timeline-entry__dot {
    position: absolute;
    left: -29px;
    top: 24px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-muted);
    border: 2px solid var(--bg-surface);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
  }

  .timeline-entry--personal .timeline-entry__dot { background: #3b82f6; box-shadow: 0 0 8px rgba(59, 130, 246, 0.4); }
  .timeline-entry--silicon .timeline-entry__dot { background: #10a37f; box-shadow: 0 0 8px rgba(16, 163, 127, 0.4); }
  .timeline-entry--automation .timeline-entry__dot { background: #f59e0b; box-shadow: 0 0 8px rgba(245, 158, 11, 0.4); }
  .timeline-entry--warning .timeline-entry__dot { background: #ef4444; box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }

  .timeline-entry__time {
    color: var(--text-secondary);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    white-space: nowrap;
  }

  .timeline-entry__body {
    min-width: 0;
    display: grid;
    gap: 5px;
  }

  .timeline-entry__title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .timeline-entry__title-row strong {
    color: var(--text-primary);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline-entry p,
  .timeline-entry__run {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border-radius: var(--radius-sm);
    border: 1px solid rgba(255, 255, 255, 0.10);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .timeline-empty {
    position: absolute;
    left: 88px;
    right: 24px;
    top: 80px;
    margin: 0;
    padding: 48px 20px;
    border: 1px dashed rgba(255, 255, 255, 0.10);
    border-radius: var(--radius-lg);
    text-align: center;
  }

  .timeline-now-line {
    position: absolute;
    left: 64px;
    right: 0;
    height: 1px;
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.45);
    pointer-events: none;
    z-index: 5;
  }

  .timeline-now-line__dot {
    position: absolute;
    left: -4px;
    top: -3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.55);
  }

  .timeline-now-line__label {
    position: absolute;
    right: 8px;
    top: -16px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    color: #ef4444;
  }

  .timeline-detail-overlay {
    position: fixed;
    inset: 0;
    z-index: 1650;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(4, 8, 15, 0.54);
    backdrop-filter: blur(12px);
    animation: modal-fade-in 0.2s ease-out;
  }

  .timeline-detail-modal {
    width: min(480px, 100%);
    display: flex;
    flex-direction: column;
    gap: 18px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: rgba(18, 22, 29, 0.92);
    box-shadow: 0 28px 60px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    padding: 20px;
  }

  .timeline-detail-modal__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .timeline-detail-modal__eyebrow {
    display: inline-flex;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
  }

  .timeline-detail-modal__header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 18px;
    line-height: 1.35;
  }

  .timeline-detail-list {
    display: grid;
    margin: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .timeline-detail-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .timeline-detail-row dt {
    color: var(--text-muted);
    font-size: 12px;
  }

  .timeline-detail-row dd {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.55;
    word-break: break-word;
  }

  .timeline-detail-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .timeline-detail-actions__danger {
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.28);
    background: rgba(239, 68, 68, 0.08);
  }

  .schedule-resource-rail {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .side-card__body {
    padding: 14px;
  }

  .schedule-composer-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1600;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(4, 8, 15, 0.56);
    backdrop-filter: blur(12px);
    animation: modal-fade-in 0.2s ease-out;
  }

  @keyframes modal-fade-in {
    from { opacity: 0; backdrop-filter: blur(0px); }
    to { opacity: 1; backdrop-filter: blur(12px); }
  }

  .schedule-composer-modal {
    width: min(760px, 100%);
    max-height: min(88vh, 860px);
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: rgba(18, 22, 29, 0.85);
    box-shadow: 0 28px 60px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    overflow: hidden;
    animation: modal-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modal-slide-up {
    from { opacity: 0; transform: translateY(20px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .schedule-composer-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
  }

  .schedule-composer-modal__heading {
    display: grid;
    gap: 4px;
  }
  
  .schedule-composer-modal__heading h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }

  .schedule-composer-modal__heading span {
    font-size: 12px;
    color: var(--text-muted);
  }

  .composer-tabs-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(0, 0, 0, 0.15);
  }

  .composer-tab-btn {
    padding: 6px 14px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .composer-tab-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary);
  }

  .composer-tab-btn.is-active {
    background: rgba(16, 163, 127, 0.15);
    border-color: rgba(16, 163, 127, 0.3);
    color: var(--text-primary);
  }

  .schedule-composer-modal__body {
    padding: 24px;
    overflow-y: auto;
    flex: 1;
  }

  .resource-list,
  .job-list,
  .compact-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }

  .resource-row,
  .job-row,
  .compact-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.025);
  }

  .resource-row {
    justify-content: flex-start;
    align-items: center;
  }

  .resource-row div,
  .job-row__main,
  .compact-row div {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .resource-row strong,
  .job-row strong,
  .compact-row strong {
    color: var(--text-primary);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .resource-row span,
  .job-row span,
  .compact-row span {
    color: var(--text-muted);
    font-size: 12px;
  }

  .job-row {
    flex-direction: column;
  }

  .job-row__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .job-action-icon-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.035);
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  }

  .job-action-icon-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: var(--text-primary);
  }

  .job-action-icon-btn:disabled {
    cursor: progress;
    opacity: 0.85;
  }

  .job-action-icon-btn--danger {
    color: var(--status-red);
    border-color: rgba(239, 68, 68, 0.32);
  }

  .job-action-icon-btn.is-loading {
    color: var(--accent-cyan);
    border-color: rgba(16, 163, 127, 0.4);
    background: rgba(16, 163, 127, 0.1);
  }

  .icon-spinner {
    animation: jobActionSpin 0.8s linear infinite;
    transform-origin: 50% 50%;
  }

  @keyframes jobActionSpin {
    to { transform: rotate(360deg); }
  }

  .job-row__title-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .job-row__title-line strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .job-type-chip {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .job-type-chip--assistant_prompt {
    background: rgba(168, 85, 247, 0.14);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.32);
  }

  .job-type-chip--workflow {
    background: rgba(245, 158, 11, 0.14);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.32);
  }

  .job-type-chip--silicon_person {
    background: rgba(16, 163, 127, 0.14);
    color: #2dd4bf;
    border: 1px solid rgba(16, 163, 127, 0.32);
  }

  .job-type-filter {
    display: flex;
    gap: 6px;
    padding: 0 24px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .job-type-filter__chip {
    padding: 4px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .job-type-filter__chip:hover {
    color: var(--text-secondary);
    border-color: var(--glass-border-hover);
  }

  .job-type-filter__chip.is-active {
    color: var(--text-primary);
    border-color: var(--glass-border-strong);
    background: var(--bg-surface-hover);
  }

  .job-type-picker {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    padding: 4px 0;
  }

  .job-type-picker__card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 18px 16px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .job-type-picker__card:hover {
    transform: translateY(-1px);
    border-color: var(--glass-border-hover);
    background: rgba(255, 255, 255, 0.04);
  }

  .job-type-picker__icon {
    font-size: 24px;
    line-height: 1;
  }

  .job-type-picker__title {
    font-size: 14px;
    font-weight: 600;
  }

  .job-type-picker__desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .schedule-job-editor__type-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }

  .schedule-job-editor__back {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--accent-cyan);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .schedule-job-editor__back:hover {
    text-decoration: underline;
  }

  .schedule-job-editor__mode-hint {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .schedule-job-editor__hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .schedule-job-editor__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .schedule-job-editor__frequency {
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.02);
  }

  .schedule-job-editor__frequency legend {
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .frequency-picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .frequency-picker__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .frequency-picker__chip {
    padding: 5px 10px;
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .frequency-picker__chip:hover {
    color: var(--text-primary);
    border-color: var(--glass-border-hover);
  }

  .frequency-picker__chip.is-active {
    color: var(--accent-cyan);
    border-color: rgba(16, 163, 127, 0.5);
    background: rgba(16, 163, 127, 0.1);
  }

  .frequency-picker__detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-md);
    border: 1px solid var(--glass-border);
  }

  .frequency-picker__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .frequency-picker__field input,
  .frequency-picker__field select {
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: 13px;
  }

  .frequency-picker__field--inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .frequency-picker__field--inline > span {
    flex-shrink: 0;
  }

  .frequency-picker__inline {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px;
  }

  .frequency-picker__weekdays {
    display: inline-flex;
    gap: 4px;
  }

  .frequency-picker__weekday {
    width: 28px;
    height: 28px;
    border: 1px solid var(--glass-border);
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .frequency-picker__weekday:hover {
    color: var(--text-secondary);
    border-color: var(--glass-border-hover);
  }

  .frequency-picker__weekday.is-active {
    color: var(--accent-cyan);
    border-color: rgba(16, 163, 127, 0.55);
    background: rgba(16, 163, 127, 0.12);
  }

  .frequency-picker__preview {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--accent-cyan);
    font-weight: 600;
  }

  .time-editor-cancel {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .time-editor-cancel:hover {
    color: var(--text-primary);
    border-color: var(--glass-border-hover);
  }

  .job-action-icon-btn--danger:hover {
    background: rgba(239, 68, 68, 0.10);
    border-color: rgba(239, 68, 68, 0.55);
    color: var(--status-red);
  }

  .job-row__run.is-warning {
    color: var(--status-red);
  }

  .list-page-row.is-clickable {
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .list-page-row.is-clickable:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--glass-border-hover);
  }

  .list-page-row.is-clickable:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 2px;
  }

  .status-badge--danger {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.28);
    color: var(--status-red);
  }

  .reasoning-chip-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .reasoning-chip {
    padding: 5px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .reasoning-chip:hover {
    color: var(--text-primary);
    border-color: var(--glass-border-hover);
  }

  .reasoning-chip.is-active {
    color: var(--accent-cyan);
    border-color: rgba(16, 163, 127, 0.55);
    background: rgba(16, 163, 127, 0.12);
  }

  .list-page-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 0;
  }

  .list-page-row {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    min-height: 64px;
    padding: 12px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    background: transparent;
    transition: background 0.2s ease;
  }

  .list-page-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .list-page-row--job {
    grid-template-columns: 140px minmax(0, 1.5fr) minmax(0, 1fr) minmax(132px, auto);
  }

  .list-page-row--job:hover {
    background: var(--bg-surface-hover);
  }

  .job-row__schedule-col,
  .job-row__info-col,
  .job-row__run-col {
    display: grid;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .job-row__schedule-col > span,
  .job-row__info-col > span,
  .job-row__info-col > strong,
  .job-row__run-col > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    width: max-content;
  }

  .status-badge--active { background: rgba(16, 163, 127, 0.15); color: #10a37f; border: 1px solid rgba(16, 163, 127, 0.3); }
  .status-badge--muted { background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); border: 1px solid rgba(255, 255, 255, 0.1); }
  .status-badge--normal { background: rgba(59, 130, 246, 0.1); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.2); }

  .list-page-row__time {
    color: var(--text-secondary);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
  }

  .list-page-row > div:not(.job-row__actions) {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .job-row__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .list-page-row strong {
    color: var(--text-primary);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list-page-row span {
    color: var(--text-muted);
    font-size: 12px;
  }

  .side-empty {
    margin: 0;
    padding: 14px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.6;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex-shrink: 0;
    background: var(--text-muted);
  }

  .status-dot--green { background: var(--status-green); box-shadow: 0 0 8px rgba(34, 197, 94, 0.4); }
  .status-dot--accent { background: var(--accent-cyan); box-shadow: 0 0 8px rgba(16, 163, 127, 0.4); }
  .status-dot--red { background: var(--status-red); box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }
  .status-dot--muted { background: var(--text-muted); }

  .btn-primary,
  .btn-toolbar,
  .btn-ghost,
  .icon-btn,
  .time-editor-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .btn-primary {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--accent-cyan);
    background: transparent;
    color: var(--accent-cyan);
  }

  .btn-primary:hover {
    background: rgba(16, 163, 127, 0.08);
  }

  .btn-toolbar {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
  }

  .btn-toolbar:hover,
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .btn-ghost {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-secondary);
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
  }

  .time-editor-form {
    display: grid;
    gap: 12px;
  }

  .time-editor-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .time-editor-field {
    min-width: 0;
    display: grid;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .time-editor-checkbox {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .time-editor-field input,
  .time-editor-field select,
  .time-editor-field textarea {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 9px 10px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: var(--bg-base);
    color: var(--text-primary);
    font-size: 13px;
  }

  .time-editor-helper {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .time-editor-submit {
    min-height: 34px;
    border: 1px solid var(--accent-cyan);
    background: transparent;
    color: var(--accent-cyan);
  }

  @media (max-width: 1180px) {
    .schedule-planning-page {
      overflow: auto;
    }

    .schedule-planning-grid {
      grid-template-columns: 1fr;
      overflow: visible;
    }

    .schedule-resource-rail {
      overflow: visible;
    }
  }
`;
