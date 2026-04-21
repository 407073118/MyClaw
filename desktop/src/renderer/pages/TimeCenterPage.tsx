import React, { useEffect, useMemo, useState } from "react";

import type {
  AvailabilityPolicy,
  CalendarEvent,
  ExecutionRun,
  Reminder,
  ScheduleJob,
  SuggestedTimebox,
  TaskCommitment,
  TodayBrief,
} from "@shared/contracts";
import { addDaysToDateKey, isoToDateKey, weekdayFromDateKey } from "@shared/time/local-time";

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

const HOUR_START = 7;
const HOUR_END = 22;
const SLOT_HEIGHT = 58;
const TIMELINE_HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, index) => HOUR_START + index);

type TimeWorkspaceTab = "agenda" | "automation";
type CalendarViewMode = "day" | "week" | "month";
type ComposerKind = "event" | "task" | "reminder" | "job";
type CalendarBoardItemKind = "event" | "suggestion";

type CalendarBoardItem = {
  id: string;
  kind: CalendarBoardItemKind;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  meta: string;
};

type AgendaEntry = {
  id: string;
  kind: "calendar_event" | "suggested_timebox" | "task_commitment" | "reminder";
  title: string;
  summary: string;
  sortAt: string;
  tone: "accent" | "warning" | "muted";
};

/** 渲染桌面端时间中心主页，采用日程优先、自动化分层的信息架构。 */
export default function TimeCenterPage() {
  const workspace = useWorkspaceStore();
  const time = workspace.time;
  const timezone = time.availabilityPolicy?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayDateKey = useMemo(() => isoToDateKey(new Date().toISOString(), timezone), [timezone]);
  const [activeTab, setActiveTab] = useState<TimeWorkspaceTab>("agenda");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [activeComposer, setActiveComposer] = useState<ComposerKind | null>(null);
  const [suggestedTimeboxes, setSuggestedTimeboxes] = useState<SuggestedTimebox[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setSelectedDate((current) => current || todayDateKey);
  }, [todayDateKey]);

  useEffect(() => {
    void loadSuggestedTimeboxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 时间对象变化后重新规划建议时间块
  }, [time.calendarEvents, time.taskCommitments, timezone]);

  const calendarItems = useMemo(
    () => buildCalendarBoardItems(time.calendarEvents, suggestedTimeboxes),
    [time.calendarEvents, suggestedTimeboxes],
  );
  const visibleDays = useMemo(
    () => buildVisibleDays(selectedDate, viewMode),
    [selectedDate, viewMode],
  );
  const agendaEntries = useMemo(
    () => buildAgendaEntries({
      selectedDate,
      timezone,
      events: time.calendarEvents,
      tasks: time.taskCommitments,
      reminders: time.reminders,
      suggestions: suggestedTimeboxes,
    }),
    [selectedDate, timezone, time.calendarEvents, time.taskCommitments, time.reminders, suggestedTimeboxes],
  );
  const todaySnapshot = useMemo(
    () => buildTodaySnapshot({
      todayDateKey,
      timezone,
      todayBrief: time.todayBrief,
      events: time.calendarEvents,
      tasks: time.taskCommitments,
      reminders: time.reminders,
      suggestions: suggestedTimeboxes,
    }),
    [todayDateKey, timezone, time.todayBrief, time.calendarEvents, time.taskCommitments, time.reminders, suggestedTimeboxes],
  );
  const pendingTaskBacklog = useMemo(
    () => buildPendingTaskBacklog({
      tasks: time.taskCommitments,
      suggestions: suggestedTimeboxes,
      timezone,
    }),
    [time.taskCommitments, suggestedTimeboxes, timezone],
  );
  const automationStats = useMemo(
    () => buildAutomationStats(time.reminders, time.scheduleJobs, time.executionRuns),
    [time.reminders, time.scheduleJobs, time.executionRuns],
  );
  const selectedPanelTitle = selectedDate === todayDateKey
    ? "今日安排"
    : `${formatDayTitle(selectedDate, timezone)}安排`;

  /** 拉取建议时间块，并在失败时保留页面主流程可用。 */
  async function loadSuggestedTimeboxes() {
    if (!workspace.suggestTimeboxes) {
      setSuggestedTimeboxes((current) => (current.length === 0 ? current : []));
      return;
    }

    if (time.taskCommitments.length === 0) {
      setSuggestedTimeboxes((current) => (current.length === 0 ? current : []));
      return;
    }

    const plannableTasks = time.taskCommitments.filter((task) => isTaskPlannable(task));
    if (plannableTasks.length === 0) {
      console.info("[时间中心] 跳过建议时间块刷新", {
        reason: "没有可规划的任务承诺",
        taskCount: time.taskCommitments.length,
      });
      setSuggestedTimeboxes((current) => (current.length === 0 ? current : []));
      return;
    }

    setPlannerLoading(true);
    try {
      const items = await workspace.suggestTimeboxes();
      console.info("[时间中心] 已刷新建议时间块", {
        timezone,
        suggestionCount: items.length,
      });
      setSuggestedTimeboxes(items);
    } catch (error) {
      console.warn("[时间中心] 拉取建议时间块失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      setSuggestedTimeboxes([]);
    } finally {
      setPlannerLoading(false);
    }
  }

  /** 创建手动日历事件，并在完成后关闭编辑器。 */
  async function handleCreateCalendarEvent(input: CalendarEventEditorSubmitInput) {
    console.info("[时间中心] 创建日历事件", {
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
    });
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
    setActiveComposer(null);
    setFeedback(`已保存日历事件：${input.title}`);
  }

  /** 创建任务承诺，并触发后续时间块刷新。 */
  async function handleCreateTaskCommitment(input: TaskCommitmentEditorSubmitInput) {
    console.info("[时间中心] 创建任务承诺", {
      title: input.title,
      dueAt: input.dueAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      priority: input.priority,
    });
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
    setActiveComposer(null);
    setFeedback(`已保存任务：${input.title}`);
  }

  /** 创建提醒对象，并在界面中反馈结果。 */
  async function handleCreateReminder(input: ReminderEditorSubmitInput) {
    console.info("[时间中心] 创建提醒", {
      title: input.title,
      triggerAt: input.triggerAt,
      timezone: input.timezone,
    });
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
    setActiveComposer(null);
    setFeedback(`已保存提醒：${input.title}`);
  }

  /** 创建自动任务，并同步回显当前配置。 */
  async function handleCreateScheduleJob(input: ScheduleJobEditorSubmitInput) {
    console.info("[时间中心] 创建自动任务", {
      title: input.title,
      scheduleKind: input.scheduleKind,
      executor: input.executor,
      executorTargetId: input.executorTargetId ?? null,
    });
    await workspace.createScheduleJob({
      kind: "schedule_job",
      title: input.title,
      description: input.description,
      scheduleKind: input.scheduleKind,
      timezone: input.timezone,
      ownerScope: "personal",
      status: "scheduled",
      source: "manual",
      startsAt: input.startsAt,
      intervalMinutes: input.intervalMinutes,
      cronExpression: input.cronExpression,
      executor: input.executor,
      executorTargetId: input.executorTargetId,
      nextRunAt: input.startsAt,
    });
    setActiveComposer(null);
    setFeedback(`已保存自动任务：${input.title}`);
  }

  /** 保存时间规则，供日历规划和自动化调度共同复用。 */
  async function handleSaveAvailabilityPolicy(policy: AvailabilityPolicy) {
    console.info("[时间中心] 保存时间规则", {
      timezone: policy.timezone,
      workingHoursCount: policy.workingHours.length,
      quietHoursEnabled: policy.quietHours.enabled,
    });
    await workspace.saveAvailabilityPolicy(policy);
    setFeedback("已保存时间规则");
  }

  /** 暂停或恢复自动任务，保持页面层只表达用户动作。 */
  async function handleToggleScheduleJob(job: ScheduleJob) {
    const nextStatus = job.status === "paused" ? "scheduled" : "paused";
    console.info("[时间中心] 切换自动任务状态", {
      id: job.id,
      title: job.title,
      from: job.status,
      to: nextStatus,
    });
    await workspace.updateScheduleJob({
      ...job,
      status: nextStatus,
    });
    setFeedback(nextStatus === "paused" ? `已暂停自动任务：${job.title}` : `已恢复自动任务：${job.title}`);
  }

  /** 删除提醒对象，避免无效提醒继续占据时间工作台。 */
  async function handleDeleteReminder(id: string) {
    console.info("[时间中心] 删除提醒", { id });
    await workspace.deleteReminder(id);
    setFeedback("已删除提醒");
  }

  /** 删除自动任务对象，并在自动化工作区即时刷新。 */
  async function handleDeleteScheduleJob(id: string) {
    console.info("[时间中心] 删除自动任务", { id });
    await workspace.deleteScheduleJob(id);
    setFeedback("已删除自动任务");
  }

  /** 推进当前选择日期，支持按视图维度翻页。 */
  function handleNavigate(direction: -1 | 1) {
    if (viewMode === "month") {
      setSelectedDate(addMonthsToDateKey(selectedDate, direction));
      return;
    }
    setSelectedDate(addDaysToDateKey(selectedDate, viewMode === "week" ? direction * 7 : direction));
  }

  /** 将日历游标重置到当前日期。 */
  function handleJumpToToday() {
    setSelectedDate(todayDateKey);
  }

  return (
    <>
      <main className="page-container time-center-page" data-testid="time-center-page">
        <header className="page-header time-center-header">
          <div className="header-text">
            <span className="eyebrow">TIME WORKSPACE</span>
            <h2 className="page-title">时间中心</h2>
            <p className="page-subtitle">把日历、任务安排、提醒和自动执行拆层管理，默认回到真正可用的周历视角。</p>
          </div>

          <div className="time-header-actions">
            <MetricBadge label="今日事项" value={String(todaySnapshot.totalItems)} />
            <MetricBadge label="待排任务" value={String(todaySnapshot.pendingTaskCount)} />
            <MetricBadge label="自动任务" value={String(automationStats.activeJobCount)} />
            {feedback ? <div className="time-feedback-banner">{feedback}</div> : null}
          </div>
        </header>

        <section className="time-overview-band" data-testid="time-overview-band">
          <TodaySnapshotCard
            todayDateKey={todayDateKey}
            timezone={timezone}
            todayBrief={time.todayBrief}
            snapshot={todaySnapshot}
            onSelectDate={setSelectedDate}
          />
          <MiniMonthNavigatorCard
            todayDateKey={todayDateKey}
            selectedDate={selectedDate}
            timezone={timezone}
            items={calendarItems}
            onSelectDate={setSelectedDate}
          />
          <FocusSummaryCard
            timezone={timezone}
            reminders={time.reminders}
            tasks={time.taskCommitments}
            plannerLoading={plannerLoading}
            suggestionCount={suggestedTimeboxes.length}
          />
        </section>

        <div className="time-main-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "agenda"}
            className={`time-main-tab ${activeTab === "agenda" ? "active" : ""}`}
            onClick={() => setActiveTab("agenda")}
          >
            日程
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "automation"}
            className={`time-main-tab ${activeTab === "automation" ? "active" : ""}`}
            onClick={() => setActiveTab("automation")}
          >
            自动化
          </button>
        </div>

        {activeTab === "agenda" ? (
          <section className="time-agenda-shell" data-testid="time-agenda-shell">
            <section className="time-main-stage">
              <section className="glass-card time-calendar-card">
                <div className="glass-card__header time-calendar-card__header">
                  <div>
                    <h3 className="time-section-title">{resolveCalendarCardTitle(viewMode)}</h3>
                    <p className="time-section-subtitle">
                      {resolveCalendarCardSubtitle(viewMode, selectedDate, timezone, time.calendarEvents.length, suggestedTimeboxes.length)}
                    </p>
                  </div>

                  <div className="time-calendar-toolbar">
                    <div className="time-nav-cluster">
                      <button type="button" className="time-ghost-button" aria-label="上一段" onClick={() => handleNavigate(-1)}>
                        ←
                      </button>
                      <button type="button" className="time-ghost-button" onClick={handleJumpToToday}>
                        今天
                      </button>
                      <button type="button" className="time-ghost-button" aria-label="下一段" onClick={() => handleNavigate(1)}>
                        →
                      </button>
                    </div>

                    <div className="time-view-switcher" aria-label="日历视图切换">
                      {(["day", "week", "month"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`time-view-button ${viewMode === mode ? "time-view-button--active" : ""}`}
                          aria-pressed={viewMode === mode}
                          onClick={() => setViewMode(mode)}
                        >
                          {mode === "day" ? "日" : mode === "week" ? "周" : "月"}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="btn-premium accent time-create-button"
                      onClick={() => setActiveComposer("event")}
                    >
                      新建安排
                    </button>
                  </div>
                </div>

                <div className="glass-card__body time-calendar-card__body">
                  {viewMode === "month" ? (
                    <MonthCalendarBoard
                      selectedDate={selectedDate}
                      timezone={timezone}
                      items={calendarItems}
                      onSelectDate={setSelectedDate}
                    />
                  ) : (
                    <TimelineCalendarBoard
                      mode={viewMode}
                      selectedDate={selectedDate}
                      timezone={timezone}
                      items={calendarItems}
                      onSelectDate={setSelectedDate}
                    />
                  )}
                </div>
              </section>
            </section>

            <aside className="time-right-rail" data-testid="time-agenda-sidebar">
              <section className="glass-card">
                <div className="glass-card__header">
                  <div>
                    <h3 className="time-section-title">{selectedPanelTitle}</h3>
                    <p className="time-section-subtitle">按日期聚合事件、建议时间块、提醒与任务节点。</p>
                  </div>
                  <span className="glass-pill glass-pill--muted">{formatDayTitle(selectedDate, timezone)}</span>
                </div>
                <div className="glass-card__body">
                  <AgendaEntryList entries={agendaEntries} />
                </div>
              </section>

              <PendingTaskBacklogCard tasks={pendingTaskBacklog} timezone={timezone} />

              <section className="glass-card">
                <div className="glass-card__header">
                  <div>
                    <h3 className="time-section-title">快速创建</h3>
                    <p className="time-section-subtitle">用同一个编辑面板处理事件、任务、提醒和自动任务。</p>
                  </div>
                  {plannerLoading ? <span className="glass-pill glass-pill--accent">规划中</span> : null}
                </div>
                <div className="glass-card__body">
                  <ComposerPanel
                    activeComposer={activeComposer}
                    timezone={timezone}
                    onSelectComposer={setActiveComposer}
                    onSaveEvent={handleCreateCalendarEvent}
                    onSaveTask={handleCreateTaskCommitment}
                    onSaveReminder={handleCreateReminder}
                    onSaveJob={handleCreateScheduleJob}
                  />
                </div>
              </section>
            </aside>
          </section>
        ) : (
          <section className="time-automation-stage">
            <AutomationWorkspace
              timezone={timezone}
              reminders={time.reminders}
              jobs={time.scheduleJobs}
              executionRuns={time.executionRuns}
              availabilityPolicy={time.availabilityPolicy}
              onDeleteReminder={handleDeleteReminder}
              onToggleScheduleJob={handleToggleScheduleJob}
              onDeleteScheduleJob={handleDeleteScheduleJob}
              onSaveAvailabilityPolicy={handleSaveAvailabilityPolicy}
            />
          </section>
        )}
      </main>

      <style>{`
        .time-center-page {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 18px;
          overflow: auto;
          padding-right: 6px;
        }

        .time-center-header {
          margin-bottom: 0;
          align-items: flex-start;
        }

        .time-header-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          max-width: 560px;
        }

        .time-feedback-banner {
          display: inline-flex;
          align-items: center;
          min-height: 40px;
          padding: 0 14px;
          border-radius: 14px;
          border: 1px solid rgba(16, 163, 127, 0.24);
          background: rgba(16, 163, 127, 0.12);
          color: #b6f3df;
          font-size: 13px;
          font-weight: 600;
        }

        .time-main-stage {
          display: flex;
          flex-direction: column;
          min-height: 0;
          min-width: 0;
        }

        .time-main-tabs {
          display: flex;
          gap: 4px;
          padding: 4px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          align-self: flex-start;
          margin-bottom: 2px;
        }

        .time-overview-band {
          display: grid;
          grid-template-columns: minmax(280px, 1.15fr) minmax(260px, 0.95fr) minmax(280px, 1fr);
          gap: 18px;
          align-items: start;
        }

        .time-overview-band > * {
          min-width: 0;
        }

        .time-main-tab {
          border: 0;
          border-radius: 8px;
          padding: 8px 16px;
          background: transparent;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-main-tab:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.05);
        }

        .time-main-tab.active {
          color: #f8fff8;
          background: rgba(255, 255, 255, 0.1);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
        }

        .time-agenda-shell {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
          gap: 18px;
          align-items: start;
        }

        .time-right-rail {
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 18px;
          position: sticky;
          top: 0;
          align-self: start;
        }

        .time-center-page::-webkit-scrollbar,
        .time-calendar-card__body::-webkit-scrollbar,
        .time-automation-shell::-webkit-scrollbar {
          width: 4px;
        }

        .time-center-page::-webkit-scrollbar-thumb,
        .time-calendar-card__body::-webkit-scrollbar-thumb,
        .time-automation-shell::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 999px;
        }

        .time-calendar-card {
          min-height: 560px;
          height: clamp(560px, calc(100vh - 340px), 820px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .time-calendar-card__header {
          align-items: flex-start;
          gap: 16px;
        }

        .time-calendar-card__body {
          flex: 1;
          min-height: 0;
          overflow: auto;
        }

        .time-automation-stage {
          flex: 1;
          min-height: 0;
        }

        .time-calendar-toolbar {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          margin-left: auto;
        }

        .time-nav-cluster,
        .time-view-switcher {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .time-ghost-button,
        .time-view-button {
          border: 0;
          border-radius: 10px;
          padding: 8px 12px;
          background: transparent;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-ghost-button:hover,
        .time-view-button:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.08);
        }

        .time-view-button--active {
          color: #f8fff8;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.22), rgba(59, 130, 246, 0.22));
        }

        .time-create-button {
          min-width: 118px;
          justify-content: center;
        }

        .time-section-title {
          margin: 0;
          font-size: 18px;
          color: var(--text-primary);
        }

        .time-section-subtitle {
          margin: 6px 0 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .time-metric-badge {
          display: grid;
          gap: 4px;
          min-width: 96px;
          padding: 10px 12px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background:
            radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 58%),
            rgba(255, 255, 255, 0.04);
        }

        .time-metric-badge__label {
          color: var(--text-secondary);
          font-size: 12px;
        }

        .time-metric-badge__value {
          color: var(--text-primary);
          font-size: 24px;
          font-weight: 800;
          line-height: 1;
        }

        .time-snapshot-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .time-highlight-card {
          padding: 14px;
          border-radius: 18px;
          background:
            radial-gradient(circle at top right, rgba(34, 197, 94, 0.18), transparent 52%),
            rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .time-highlight-card h4,
        .time-panel-list-title {
          margin: 0 0 10px;
          font-size: 14px;
          color: var(--text-primary);
        }

        .time-mini-list,
        .time-automation-list,
        .time-agenda-list,
        .time-quick-actions {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 10px;
        }

        .time-mini-list li,
        .time-automation-list li,
        .time-agenda-list li {
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.03);
        }

        .time-mini-list strong,
        .time-automation-list strong,
        .time-agenda-list strong {
          display: block;
          margin-bottom: 6px;
          color: var(--text-primary);
          font-size: 14px;
        }

        .time-mini-list span,
        .time-automation-list span,
        .time-agenda-list span,
        .time-empty-state,
        .time-muted-copy,
        .time-editor-helper {
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.6;
        }

        .time-empty-state {
          margin: 0;
          padding: 18px;
          border-radius: 16px;
          border: 1px dashed rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.03);
          text-align: center;
        }

        .time-focus-summary {
          display: grid;
          gap: 14px;
        }

        .time-mini-calendar {
          display: grid;
          gap: 12px;
        }

        .time-mini-month-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .time-mini-month-label {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 700;
        }

        .time-mini-calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 8px;
        }

        .time-mini-weekday {
          text-align: center;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
        }

        .time-mini-day-button {
          position: relative;
          min-height: 42px;
          border: 0;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-mini-day-button:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }

        .time-mini-day-button--selected {
          color: #f8fff8;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.22), rgba(59, 130, 246, 0.22));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        .time-mini-day-button--outside {
          opacity: 0.45;
        }

        .time-mini-day-button--today {
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.32);
        }

        .time-mini-day-badge {
          position: absolute;
          left: 50%;
          bottom: 4px;
          transform: translateX(-50%);
          min-width: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
          font-size: 10px;
          line-height: 16px;
        }

        .time-focus-strip {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .time-focus-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.07);
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 700;
        }

        .time-composer-switcher {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 14px;
        }

        .time-composer-tab {
          border: 0;
          border-radius: 12px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-composer-tab:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.08);
        }

        .time-composer-tab--active {
          color: #f8fff8;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(59, 130, 246, 0.2));
        }

        .time-composer-empty {
          display: grid;
          gap: 12px;
        }

        .time-quick-action-button {
          width: 100%;
          border: 0;
          border-radius: 14px;
          padding: 12px 14px;
          text-align: left;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-quick-action-button:hover {
          background: rgba(255, 255, 255, 0.09);
          transform: translateY(-1px);
        }

        .time-editor-form {
          display: grid;
          gap: 12px;
        }

        .time-editor-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .time-editor-field {
          display: grid;
          gap: 6px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .time-editor-checkbox {
          grid-template-columns: 1fr auto;
          align-items: center;
        }

        .time-editor-field input,
        .time-editor-field select,
        .time-editor-field textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary);
        }

        .time-editor-submit,
        .time-row-button {
          border: 0;
          border-radius: 12px;
          padding: 10px 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .time-editor-submit {
          color: #071b14;
          background: linear-gradient(135deg, #bef4d1, #7ce1c3);
        }

        .time-row-button {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.07);
        }

        .time-row-button--danger {
          color: #ffd8d8;
          background: rgba(239, 68, 68, 0.18);
        }

        .time-row-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 10px;
        }

        .time-timeline-board {
          display: grid;
          gap: 12px;
          min-width: 720px;
        }

        .time-timeline-header {
          display: grid;
          grid-template-columns: 68px repeat(var(--timeline-day-count), minmax(0, 1fr));
          gap: 10px;
        }

        .time-timeline-header-spacer {
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.02);
        }

        .time-day-header {
          border: 0;
          border-radius: 16px;
          padding: 12px;
          text-align: left;
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-day-header strong {
          display: block;
          color: var(--text-primary);
          font-size: 15px;
        }

        .time-day-header span {
          font-size: 12px;
        }

        .time-day-header--active {
          background: linear-gradient(180deg, rgba(34, 197, 94, 0.16), rgba(59, 130, 246, 0.08));
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.18);
        }

        .time-timeline-body {
          display: grid;
          grid-template-columns: 68px repeat(var(--timeline-day-count), minmax(0, 1fr));
          gap: 10px;
          min-height: ${String((HOUR_END - HOUR_START) * SLOT_HEIGHT)}px;
        }

        .time-ruler-column {
          display: grid;
          grid-template-rows: repeat(${String(TIMELINE_HOURS.length)}, ${String(SLOT_HEIGHT)}px);
          gap: 0;
        }

        .time-ruler-cell {
          position: relative;
          color: var(--text-muted);
          font-size: 11px;
        }

        .time-ruler-cell span {
          position: absolute;
          top: -10px;
          right: 8px;
        }

        .time-day-column {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015)),
            rgba(7, 12, 18, 0.74);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .time-day-column--active {
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.2);
        }

        .time-day-grid {
          display: grid;
          grid-template-rows: repeat(${String(TIMELINE_HOURS.length)}, ${String(SLOT_HEIGHT)}px);
        }

        .time-day-grid div {
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .time-day-grid div:first-child {
          border-top: 0;
        }

        .time-item-layer {
          position: absolute;
          inset: 0;
        }

        .time-calendar-item {
          position: absolute;
          left: 10px;
          right: 10px;
          border: 0;
          border-radius: 14px;
          padding: 10px 10px 8px;
          text-align: left;
          cursor: pointer;
          overflow: hidden;
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
        }

        .time-calendar-item strong {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          color: #f8fff8;
        }

        .time-calendar-item span {
          display: block;
          font-size: 11px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.78);
        }

        .time-calendar-item--event {
          background: linear-gradient(180deg, rgba(59, 130, 246, 0.72), rgba(37, 99, 235, 0.82));
        }

        .time-calendar-item--suggestion {
          background: linear-gradient(180deg, rgba(34, 197, 94, 0.52), rgba(16, 163, 127, 0.66));
          border: 1px dashed rgba(255, 255, 255, 0.3);
        }

        .time-month-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 10px;
        }

        .time-month-weekday {
          padding: 0 6px 6px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
        }

        .time-month-cell {
          min-height: 132px;
          border: 0;
          border-radius: 18px;
          padding: 12px;
          text-align: left;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .time-month-cell:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.06);
        }

        .time-month-cell--active {
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.22);
          background: linear-gradient(180deg, rgba(34, 197, 94, 0.12), rgba(255, 255, 255, 0.04));
        }

        .time-month-cell--outside {
          opacity: 0.46;
        }

        .time-month-day-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          margin-bottom: 12px;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 800;
          background: rgba(255, 255, 255, 0.04);
        }

        .time-month-items {
          display: grid;
          gap: 8px;
        }

        .time-month-item {
          display: block;
          padding: 8px 10px;
          border-radius: 12px;
          font-size: 12px;
          line-height: 1.45;
        }

        .time-month-item--event {
          color: #e3f0ff;
          background: rgba(59, 130, 246, 0.22);
        }

        .time-month-item--suggestion {
          color: #ddffe9;
          background: rgba(34, 197, 94, 0.18);
        }

        .time-automation-shell {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          overflow-y: auto;
          padding-right: 4px;
          align-content: start;
        }

        .time-automation-card {
          min-height: 0;
        }

        .time-automation-card .glass-card__body {
          display: grid;
          gap: 18px;
        }

        .time-automation-grid {
          display: grid;
          gap: 16px;
        }

        .time-automation-list[data-tone="warning"] li {
          background: rgba(245, 158, 11, 0.08);
        }

        .time-agenda-entry {
          border-left: 3px solid transparent;
        }

        .time-agenda-entry--accent {
          border-left-color: rgba(34, 197, 94, 0.6);
        }

        .time-agenda-entry--warning {
          border-left-color: rgba(245, 158, 11, 0.7);
        }

        .time-agenda-entry--muted {
          border-left-color: rgba(148, 163, 184, 0.45);
        }

        .time-run-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        @media (max-width: 1480px) {
          .time-overview-band {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1320px) {
          .time-agenda-shell {
            grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
          }
        }

        @media (max-width: 1180px) {
          .time-center-header {
            flex-direction: column;
            gap: 12px;
          }

          .time-header-actions {
            justify-content: flex-start;
            max-width: none;
          }

          .time-overview-band,
          .time-agenda-shell,
          .time-automation-shell {
            grid-template-columns: 1fr;
          }

          .time-right-rail {
            position: static;
          }
        }

        @media (max-width: 820px) {
          .time-overview-band {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .time-editor-grid,
          .time-composer-switcher,
          .time-snapshot-grid {
            grid-template-columns: 1fr;
          }

          .time-calendar-toolbar {
            width: 100%;
            justify-content: flex-start;
          }

          .time-metric-badge {
            min-width: 0;
            flex: 1 1 140px;
          }
        }
      `}</style>
    </>
  );
}

/** 渲染顶部指标卡，突出当前时间工作台的核心数字。 */
function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="time-metric-badge">
      <span className="time-metric-badge__label">{label}</span>
      <strong className="time-metric-badge__value">{value}</strong>
    </div>
  );
}

/** 渲染左侧迷你月历导航，提供月切换和日期跳转入口。 */
function MiniMonthNavigatorCard({
  todayDateKey,
  selectedDate,
  timezone,
  items,
  onSelectDate,
}: {
  todayDateKey: string;
  selectedDate: string;
  timezone: string;
  items: CalendarBoardItem[];
  onSelectDate: (dateKey: string) => void;
}) {
  const days = buildMonthGrid(selectedDate);
  const itemCountByDate = items.reduce<Record<string, number>>((result, item) => {
    const dateKey = resolveItemDateKey(item.startsAt, item.timezone);
    result[dateKey] = (result[dateKey] ?? 0) + 1;
    return result;
  }, {});
  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
  }).format(dateKeyToNoonDate(selectedDate));

  /** 切换迷你月历的当前月份，同时保持主日历日期联动。 */
  function handleShiftMonth(direction: -1 | 1) {
    const nextDate = addMonthsToDateKey(selectedDate, direction);
    console.info("[时间中心] 切换迷你月历月份", {
      from: selectedDate,
      to: nextDate,
    });
    onSelectDate(nextDate);
  }

  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">日期导航</h3>
          <p className="time-section-subtitle">顶部概览带保留一个可点击的迷你月历，快速切天和切月。</p>
        </div>
        <span className="glass-pill glass-pill--muted">{monthLabel}</span>
      </div>

      <div className="glass-card__body time-mini-calendar">
        <div className="time-mini-month-bar">
          <button type="button" className="time-ghost-button" onClick={() => handleShiftMonth(-1)}>
            上个月
          </button>
          <h4 className="time-mini-month-label">{monthLabel}</h4>
          <button type="button" className="time-ghost-button" onClick={() => handleShiftMonth(1)}>
            下个月
          </button>
        </div>

        <div className="time-mini-calendar-grid">
          {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
            <span key={label} className="time-mini-weekday">{label}</span>
          ))}

          {days.map((dateKey) => {
            const itemCount = itemCountByDate[dateKey] ?? 0;
            return (
              <button
                key={dateKey}
                type="button"
                className={[
                  "time-mini-day-button",
                  dateKey === selectedDate ? "time-mini-day-button--selected" : "",
                  dateKey === todayDateKey ? "time-mini-day-button--today" : "",
                  dateKey.slice(0, 7) !== selectedDate.slice(0, 7) ? "time-mini-day-button--outside" : "",
                ].filter(Boolean).join(" ")}
                title={`${formatDayTitle(dateKey, timezone)}${itemCount ? ` · ${itemCount} 项安排` : ""}`}
                onClick={() => onSelectDate(dateKey)}
              >
                {String(Number(dateKey.slice(-2)))}
                {itemCount ? <span className="time-mini-day-badge">{itemCount}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** 渲染左侧今日摘要卡，作为用户进入时间中心后的第一视线区域。 */
function TodaySnapshotCard({
  todayDateKey,
  timezone,
  todayBrief,
  snapshot,
  onSelectDate,
}: {
  todayDateKey: string;
  timezone: string;
  todayBrief: TodayBrief | null;
  snapshot: ReturnType<typeof buildTodaySnapshot>;
  onSelectDate: (dateKey: string) => void;
}) {
  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">今日节奏</h3>
          <p className="time-section-subtitle">优先展示今天的会议、任务风险和最近提醒。</p>
        </div>
        <button type="button" className="time-ghost-button" onClick={() => onSelectDate(todayDateKey)}>
          回到今天
        </button>
      </div>

      <div className="glass-card__body time-focus-summary">
        <div className="time-snapshot-grid">
          <div className="time-highlight-card">
            <span className="time-muted-copy">今日事项</span>
            <h4 style={{ fontSize: 28, marginTop: 6 }}>{snapshot.totalItems}</h4>
          </div>
          <div className="time-highlight-card">
            <span className="time-muted-copy">待排任务</span>
            <h4 style={{ fontSize: 28, marginTop: 6 }}>{snapshot.pendingTaskCount}</h4>
          </div>
        </div>

        <div>
          <h4 className="time-panel-list-title">今日摘要</h4>
          {todayBrief?.items?.length ? (
            <ul className="time-mini-list">
              {todayBrief.items.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                </li>
              ))}
            </ul>
          ) : snapshot.topEntries.length ? (
            <ul className="time-mini-list">
              {snapshot.topEntries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.title}</strong>
                  <span>{entry.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="time-empty-state">今天还没有进入时间中心的事项。</p>
          )}
        </div>

        <div className="time-focus-strip">
          <span className="time-focus-chip">时区 {timezone}</span>
          <span className="time-focus-chip">提醒 {snapshot.reminderCount}</span>
          <span className="time-focus-chip">建议块 {snapshot.suggestionCount}</span>
        </div>
      </div>
    </section>
  );
}

/** 渲染右侧待安排任务卡，把还未稳定落到日历的任务单独收束。 */
function PendingTaskBacklogCard({
  tasks,
  timezone,
}: {
  tasks: Array<{ task: TaskCommitment; summary: string }>;
  timezone: string;
}) {
  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">待安排任务</h3>
          <p className="time-section-subtitle">这些任务还没有稳定落到日历时间块里，先集中放在右栏任务池。</p>
        </div>
        <span className="glass-pill glass-pill--muted">{tasks.length}</span>
      </div>

      <div className="glass-card__body">
        {tasks.length ? (
          <ul className="time-mini-list">
            {tasks.map(({ task, summary }) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>{summary}</span>
                <span>{`时区 ${task.timezone || timezone}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="time-empty-state">所有待办都已经落到日历或建议时间块里了。</p>
        )}
      </div>
    </section>
  );
}

/** 渲染左侧关注摘要卡，补充提醒、风险任务和规划器状态。 */
function FocusSummaryCard({
  timezone,
  reminders,
  tasks,
  plannerLoading,
  suggestionCount,
}: {
  timezone: string;
  reminders: Reminder[];
  tasks: TaskCommitment[];
  plannerLoading: boolean;
  suggestionCount: number;
}) {
  const upcomingReminders = reminders
    .slice()
    .sort((left, right) => left.triggerAt.localeCompare(right.triggerAt))
    .slice(0, 3);
  const dueTasks = tasks
    .filter((task) => task.dueAt && task.status !== "completed" && task.status !== "cancelled")
    .slice()
    .sort((left, right) => (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999"))
    .slice(0, 3);

  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">本周重点</h3>
          <p className="time-section-subtitle">把最接近用户操作决策的提醒和任务暴露在顶部概览带。</p>
        </div>
        <span className="glass-pill glass-pill--muted">{plannerLoading ? "规划中" : `${suggestionCount} 个建议块`}</span>
      </div>

      <div className="glass-card__body time-focus-summary">
        <div>
          <h4 className="time-panel-list-title">最近提醒</h4>
          {upcomingReminders.length ? (
            <ul className="time-mini-list">
              {upcomingReminders.map((reminder) => (
                <li key={reminder.id}>
                  <strong>{reminder.title}</strong>
                  <span>{formatDateTime(reminder.triggerAt, reminder.timezone)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="time-empty-state">没有待触发提醒。</p>
          )}
        </div>

        <div>
          <h4 className="time-panel-list-title">逼近截止</h4>
          {dueTasks.length ? (
            <ul className="time-mini-list">
              {dueTasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{formatTaskSummary(task, timezone)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="time-empty-state">没有高风险任务。</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** 渲染日视图和周视图的时间轴日历。 */
function TimelineCalendarBoard({
  mode,
  selectedDate,
  timezone,
  items,
  onSelectDate,
}: {
  mode: "day" | "week";
  selectedDate: string;
  timezone: string;
  items: CalendarBoardItem[];
  onSelectDate: (dateKey: string) => void;
}) {
  const days = buildVisibleDays(selectedDate, mode);

  return (
    <div className="time-timeline-board">
      <div className="time-timeline-header" style={{ ["--timeline-day-count" as string]: String(days.length) }}>
        <div className="time-timeline-header-spacer" />
        {days.map((dateKey) => (
          <button
            key={dateKey}
            type="button"
            className={`time-day-header ${dateKey === selectedDate ? "time-day-header--active" : ""}`}
            onClick={() => onSelectDate(dateKey)}
          >
            <strong>{formatDayTitle(dateKey, timezone)}</strong>
            <span>{formatWeekdayLabel(dateKey, timezone)}</span>
          </button>
        ))}
      </div>

      <div className="time-timeline-body" style={{ ["--timeline-day-count" as string]: String(days.length) }}>
        <div className="time-ruler-column">
          {TIMELINE_HOURS.map((hour) => (
            <div key={hour} className="time-ruler-cell">
              <span>{`${String(hour).padStart(2, "0")}:00`}</span>
            </div>
          ))}
        </div>

        {days.map((dateKey) => {
          const dayItems: Array<{ item: CalendarBoardItem; layout: { top: number; height: number } }> = [];
          for (const item of items) {
            const layout = resolveTimelineLayout(item, dateKey, timezone);
            if (layout) {
              dayItems.push({ item, layout });
            }
          }

          return (
            <div key={dateKey} className={`time-day-column ${dateKey === selectedDate ? "time-day-column--active" : ""}`}>
              <div className="time-day-grid" aria-hidden="true">
                {TIMELINE_HOURS.map((hour) => (
                  <div key={`${dateKey}-${hour}`} />
                ))}
              </div>

              <div className="time-item-layer">
                {dayItems.map(({ item, layout }) => (
                  <div
                    key={item.id}
                    className={`time-calendar-item ${item.kind === "event" ? "time-calendar-item--event" : "time-calendar-item--suggestion"}`}
                    style={{ top: `${layout.top}px`, height: `${layout.height}px` }}
                    title={`${item.title} ${item.meta}`}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 渲染月视图日历网格，重点展示日期密度和事项数量。 */
function MonthCalendarBoard({
  selectedDate,
  timezone,
  items,
  onSelectDate,
}: {
  selectedDate: string;
  timezone: string;
  items: CalendarBoardItem[];
  onSelectDate: (dateKey: string) => void;
}) {
  const days = buildMonthGrid(selectedDate);

  return (
    <div className="time-month-grid">
      {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label) => (
        <div key={label} className="time-month-weekday">{label}</div>
      ))}

      {days.map((dateKey) => {
        const monthItems = items.filter((item) => resolveItemDateKey(item.startsAt, item.timezone) === dateKey).slice(0, 3);
        const isOutside = dateKey.slice(0, 7) !== selectedDate.slice(0, 7);
        return (
          <button
            key={dateKey}
            type="button"
            className={[
              "time-month-cell",
              dateKey === selectedDate ? "time-month-cell--active" : "",
              isOutside ? "time-month-cell--outside" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => onSelectDate(dateKey)}
          >
            <span className="time-month-day-number">{dateKey.slice(-2)}</span>
            <div className="time-month-items">
              {monthItems.length ? (
                monthItems.map((item) => (
                  <span
                    key={item.id}
                    className={`time-month-item ${item.kind === "event" ? "time-month-item--event" : "time-month-item--suggestion"}`}
                  >
                    {item.title}
                  </span>
                ))
              ) : (
                <span className="time-muted-copy">{dateKey === selectedDate ? "当前选择" : "空闲"}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 渲染右侧按日期聚合的 agenda 列表。 */
function AgendaEntryList({ entries }: { entries: AgendaEntry[] }) {
  if (entries.length === 0) {
    return <p className="time-empty-state">这一天还没有排期与提醒，可以直接从右下角创建安排。</p>;
  }

  return (
    <ul className="time-agenda-list">
      {entries.map((entry) => (
        <li key={entry.id} className={`time-agenda-entry time-agenda-entry--${entry.tone}`}>
          <strong>{entry.title}</strong>
          <span>{entry.summary}</span>
        </li>
      ))}
    </ul>
  );
}

/** 渲染统一的快速创建面板，根据当前选项切换对应编辑器。 */
function ComposerPanel({
  activeComposer,
  timezone,
  onSelectComposer,
  onSaveEvent,
  onSaveTask,
  onSaveReminder,
  onSaveJob,
}: {
  activeComposer: ComposerKind | null;
  timezone: string;
  onSelectComposer: (kind: ComposerKind) => void;
  onSaveEvent: (input: CalendarEventEditorSubmitInput) => void | Promise<void>;
  onSaveTask: (input: TaskCommitmentEditorSubmitInput) => void | Promise<void>;
  onSaveReminder: (input: ReminderEditorSubmitInput) => void | Promise<void>;
  onSaveJob: (input: ScheduleJobEditorSubmitInput) => void | Promise<void>;
}) {
  const currentComposer = activeComposer ?? "event";

  return (
    <div>
      <div className="time-composer-switcher">
        <ComposerTabButton label="日历事件" active={currentComposer === "event"} onClick={() => onSelectComposer("event")} />
        <ComposerTabButton label="任务" active={currentComposer === "task"} onClick={() => onSelectComposer("task")} />
        <ComposerTabButton label="提醒" active={currentComposer === "reminder"} onClick={() => onSelectComposer("reminder")} />
        <ComposerTabButton label="自动任务" active={currentComposer === "job"} onClick={() => onSelectComposer("job")} />
      </div>

      {activeComposer ? (
        currentComposer === "event" ? (
          <CalendarEventEditor timezone={timezone} onSave={onSaveEvent} />
        ) : currentComposer === "task" ? (
          <TaskCommitmentEditor timezone={timezone} onSave={onSaveTask} />
        ) : currentComposer === "reminder" ? (
          <ReminderEditor timezone={timezone} onSave={onSaveReminder} />
        ) : (
          <ScheduleJobEditor timezone={timezone} onSave={onSaveJob} />
        )
      ) : (
        <div className="time-composer-empty">
          <p className="time-muted-copy">先选择一个创建类型。为了减少首页噪声，编辑器默认折叠在右栏而不是常驻整页。</p>
          <ul className="time-quick-actions">
            <li>
              <button type="button" className="time-quick-action-button" onClick={() => onSelectComposer("event")}>
                新建日历事件
              </button>
            </li>
            <li>
              <button type="button" className="time-quick-action-button" onClick={() => onSelectComposer("task")}>
                新建任务安排
              </button>
            </li>
            <li>
              <button type="button" className="time-quick-action-button" onClick={() => onSelectComposer("reminder")}>
                新建提醒
              </button>
            </li>
            <li>
              <button type="button" className="time-quick-action-button" onClick={() => onSelectComposer("job")}>
                新建自动任务
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** 渲染快速创建面板顶部的类型切换按钮。 */
function ComposerTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`time-composer-tab ${active ? "time-composer-tab--active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** 渲染自动化工作区，把提醒、自动任务和规则从主日历视图中剥离出来。 */
function AutomationWorkspace({
  timezone,
  reminders,
  jobs,
  executionRuns,
  availabilityPolicy,
  onDeleteReminder,
  onToggleScheduleJob,
  onDeleteScheduleJob,
  onSaveAvailabilityPolicy,
}: {
  timezone: string;
  reminders: Reminder[];
  jobs: ScheduleJob[];
  executionRuns: ExecutionRun[];
  availabilityPolicy: AvailabilityPolicy | null;
  onDeleteReminder: (id: string) => Promise<void>;
  onToggleScheduleJob: (job: ScheduleJob) => Promise<void>;
  onDeleteScheduleJob: (id: string) => Promise<void>;
  onSaveAvailabilityPolicy: (policy: AvailabilityPolicy) => void | Promise<void>;
}) {
  return (
    <section className="time-automation-shell">
      <section className="glass-card time-automation-card">
        <div className="glass-card__header">
          <div>
            <h3 className="time-section-title">提醒</h3>
            <p className="time-section-subtitle">保留用户注意力相关的时间点，不再和主日历混排。</p>
          </div>
          <span className="glass-pill glass-pill--muted">{reminders.length}</span>
        </div>
        <div className="glass-card__body">
          <ReminderList reminders={reminders} onDelete={onDeleteReminder} />
        </div>
      </section>

      <section className="glass-card time-automation-card">
        <div className="glass-card__header">
          <div>
            <h3 className="time-section-title">自动任务</h3>
            <p className="time-section-subtitle">管理周期执行与一次性自动化，不让自动任务污染日历首页。</p>
          </div>
          <span className="glass-pill glass-pill--muted">{jobs.length}</span>
        </div>
        <div className="glass-card__body">
          <ScheduleJobList jobs={jobs} onToggle={onToggleScheduleJob} onDelete={onDeleteScheduleJob} />
        </div>
      </section>

      <section className="glass-card time-automation-card">
        <div className="glass-card__header">
          <div>
            <h3 className="time-section-title">时间规则</h3>
            <p className="time-section-subtitle">统一管理工作时间、静默时间和通知窗口。</p>
          </div>
          <span className="glass-pill glass-pill--muted">{timezone}</span>
        </div>
        <div className="glass-card__body">
          <ul className="time-automation-list">
            <li>
              <strong>工作时间</strong>
              <span>{formatWorkingHours(availabilityPolicy?.workingHours.length ?? 0)}</span>
            </li>
            <li>
              <strong>静默时间</strong>
              <span>{formatQuietHours(availabilityPolicy?.quietHours)}</span>
            </li>
          </ul>
          <AvailabilityPolicyForm
            policy={availabilityPolicy}
            timezone={timezone}
            onSave={onSaveAvailabilityPolicy}
          />
        </div>
      </section>

      <section className="glass-card time-automation-card">
        <div className="glass-card__header">
          <div>
            <h3 className="time-section-title">最近执行</h3>
            <p className="time-section-subtitle">集中查看自动任务运行结果，避免把执行日志塞进日历视图。</p>
          </div>
          <span className="glass-pill glass-pill--muted">{executionRuns.length}</span>
        </div>
        <div className="glass-card__body">
          <ExecutionRunList runs={executionRuns} />
        </div>
      </section>
    </section>
  );
}

/** 渲染提醒列表并暴露删除动作。 */
function ReminderList({
  reminders,
  onDelete,
}: {
  reminders: Reminder[];
  onDelete: (id: string) => Promise<void>;
}) {
  if (reminders.length === 0) {
    return <p className="time-empty-state">还没有待触发提醒。</p>;
  }

  return (
    <ul className="time-automation-list">
      {reminders.slice(0, 6).map((reminder) => (
        <li key={reminder.id}>
          <strong>{reminder.title}</strong>
          <span>{formatReminderSummary(reminder.triggerAt, reminder.timezone, reminder.status)}</span>
          <div className="time-row-actions">
            <button
              type="button"
              className="time-row-button time-row-button--danger"
              onClick={() => void onDelete(reminder.id)}
            >
              删除提醒
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 渲染自动任务列表，并提供暂停、恢复、删除动作。 */
function ScheduleJobList({
  jobs,
  onToggle,
  onDelete,
}: {
  jobs: ScheduleJob[];
  onToggle: (job: ScheduleJob) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  if (jobs.length === 0) {
    return <p className="time-empty-state">还没有自动任务。</p>;
  }

  return (
    <ul className="time-automation-list">
      {jobs.slice(0, 6).map((job) => (
        <li key={job.id}>
          <strong>{job.title}</strong>
          <span>{formatJobSummary(job.nextRunAt, job.status, job.scheduleKind)}</span>
          <div className="time-row-actions">
            <button type="button" className="time-row-button" onClick={() => void onToggle(job)}>
              {job.status === "paused" ? "恢复任务" : "暂停任务"}
            </button>
            <button
              type="button"
              className="time-row-button time-row-button--danger"
              onClick={() => void onDelete(job.id)}
            >
              删除任务
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 渲染最近执行记录列表，作为自动化工作区的可观测性入口。 */
function ExecutionRunList({ runs }: { runs: ExecutionRun[] }) {
  if (runs.length === 0) {
    return <p className="time-empty-state">还没有执行记录。</p>;
  }

  return (
    <ul className="time-automation-list" data-tone="warning">
      {runs
        .slice()
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, 6)
        .map((run) => (
          <li key={run.id}>
            <strong>{formatExecutionRunTitle(run)}</strong>
            <span>{formatExecutionRunSummary(run)}</span>
            <div className="time-run-meta">
              <span className="glass-pill glass-pill--muted">{mapExecutionRunStatus(run.status)}</span>
              <span className="glass-pill glass-pill--muted">{formatDateTime(run.startedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
            </div>
          </li>
        ))}
    </ul>
  );
}

/** 构建日历主视图要使用的事件块集合。 */
function buildCalendarBoardItems(events: CalendarEvent[], suggestions: SuggestedTimebox[]): CalendarBoardItem[] {
  return [
    ...events.map((event) => ({
      id: event.id,
      kind: "event" as const,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      meta: `${formatDateTimeWindow(event.startsAt, event.endsAt, event.timezone)} · ${event.location ?? "已确认事件"}`,
    })),
    ...suggestions.map((suggestion) => ({
      id: `suggestion-${suggestion.commitmentId}-${suggestion.startsAt}`,
      kind: "suggestion" as const,
      title: suggestion.title,
      startsAt: suggestion.startsAt,
      endsAt: suggestion.endsAt,
      timezone: suggestion.timezone,
      meta: `${formatDateTimeWindow(suggestion.startsAt, suggestion.endsAt, suggestion.timezone)} · 建议时间块`,
    })),
  ].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

/** 构建指定日期的 agenda 条目列表。 */
function buildAgendaEntries(input: {
  selectedDate: string;
  timezone: string;
  events: CalendarEvent[];
  tasks: TaskCommitment[];
  reminders: Reminder[];
  suggestions: SuggestedTimebox[];
}): AgendaEntry[] {
  const entries: AgendaEntry[] = [];

  for (const event of input.events) {
    if (resolveItemDateKey(event.startsAt, event.timezone) !== input.selectedDate) {
      continue;
    }
    entries.push({
      id: event.id,
      kind: "calendar_event",
      title: event.title,
      summary: `${formatDateTimeWindow(event.startsAt, event.endsAt, event.timezone)} · ${event.location ?? "日历事件"}`,
      sortAt: event.startsAt,
      tone: "accent",
    });
  }

  for (const suggestion of input.suggestions) {
    if (resolveItemDateKey(suggestion.startsAt, suggestion.timezone) !== input.selectedDate) {
      continue;
    }
    entries.push({
      id: `agenda-${suggestion.commitmentId}-${suggestion.startsAt}`,
      kind: "suggested_timebox",
      title: suggestion.title,
      summary: `${formatDateTimeWindow(suggestion.startsAt, suggestion.endsAt, suggestion.timezone)} · 建议安排到日历`,
      sortAt: suggestion.startsAt,
      tone: "accent",
    });
  }

  for (const reminder of input.reminders) {
    if (resolveItemDateKey(reminder.triggerAt, reminder.timezone) !== input.selectedDate) {
      continue;
    }
    entries.push({
      id: reminder.id,
      kind: "reminder",
      title: reminder.title,
      summary: `${formatDateTime(reminder.triggerAt, reminder.timezone)} · ${mapReminderStatus(reminder.status)}`,
      sortAt: reminder.triggerAt,
      tone: "muted",
    });
  }

  for (const task of input.tasks) {
    if (!task.dueAt || resolveItemDateKey(task.dueAt, task.timezone) !== input.selectedDate) {
      continue;
    }
    entries.push({
      id: task.id,
      kind: "task_commitment",
      title: task.title,
      summary: formatTaskSummary(task, input.timezone),
      sortAt: task.dueAt,
      tone: task.priority === "urgent" || task.priority === "high" ? "warning" : "muted",
    });
  }

  return entries.sort((left, right) => left.sortAt.localeCompare(right.sortAt));
}

/** 构建左侧今日摘要的聚合快照。 */
function buildTodaySnapshot(input: {
  todayDateKey: string;
  timezone: string;
  todayBrief: TodayBrief | null;
  events: CalendarEvent[];
  tasks: TaskCommitment[];
  reminders: Reminder[];
  suggestions: SuggestedTimebox[];
}) {
  const topEntries = buildAgendaEntries({
    selectedDate: input.todayDateKey,
    timezone: input.timezone,
    events: input.events,
    tasks: input.tasks,
    reminders: input.reminders,
    suggestions: input.suggestions,
  }).slice(0, 4);

  return {
    totalItems: input.todayBrief?.items.length ?? topEntries.length,
    pendingTaskCount: input.tasks.filter((task) => task.status === "pending" || task.status === "scheduled").length,
    reminderCount: input.reminders.length,
    suggestionCount: input.suggestions.length,
    topEntries,
  };
}

/** 计算自动化工作区顶部要展示的关键统计值。 */
function buildAutomationStats(reminders: Reminder[], jobs: ScheduleJob[], runs: ExecutionRun[]) {
  return {
    activeJobCount: jobs.filter((job) => job.status === "scheduled" || job.status === "running").length,
    scheduledReminderCount: reminders.filter((reminder) => reminder.status === "scheduled").length,
    failedRunCount: runs.filter((run) => run.status === "failed").length,
  };
}

/** 按当前视图构建需要渲染的日期列。 */
function buildVisibleDays(selectedDate: string, viewMode: CalendarViewMode): string[] {
  if (viewMode === "day") {
    return [selectedDate];
  }
  if (viewMode === "week") {
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(weekStart, index));
  }
  return buildMonthGrid(selectedDate);
}

/** 构建月视图的 6x7 日期矩阵。 */
function buildMonthGrid(selectedDate: string): string[] {
  const monthStart = `${selectedDate.slice(0, 7)}-01`;
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDaysToDateKey(gridStart, index));
}

/** 识别任务是否具备建议排期所需的最小约束。 */
function isTaskPlannable(task: TaskCommitment): boolean {
  return Boolean(
    task.dueAt
    && task.durationMinutes
    && task.durationMinutes > 0
    && task.status !== "completed"
    && task.status !== "cancelled",
  );
}

/** 构建右侧待安排任务池，只保留尚未稳定进入日历的任务。 */
function buildPendingTaskBacklog(input: {
  tasks: TaskCommitment[];
  suggestions: SuggestedTimebox[];
  timezone: string;
}) {
  const suggestedCommitmentIds = new Set(input.suggestions.map((suggestion) => suggestion.commitmentId));
  return input.tasks
    .filter((task) => task.status !== "completed" && task.status !== "cancelled")
    .filter((task) => !task.dueAt || !suggestedCommitmentIds.has(task.id))
    .slice()
    .sort((left, right) => {
      const priorityDelta = resolveTaskPriorityRank(right.priority) - resolveTaskPriorityRank(left.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return (left.dueAt ?? "9999-12-31T23:59:59.999Z").localeCompare(right.dueAt ?? "9999-12-31T23:59:59.999Z");
    })
    .slice(0, 6)
    .map((task) => ({
      task,
      summary: task.dueAt
        ? `${formatTaskSummary(task, input.timezone)} · ${suggestedCommitmentIds.has(task.id) ? "等待确认落位" : "未生成建议块"}`
        : `${formatTaskSummary(task, input.timezone)} · 还没有截止时间，建议先补齐约束`,
    }));
}

/** 计算时间轴中单个事项块的定位信息。 */
function resolveTimelineLayout(item: CalendarBoardItem, dateKey: string, timezone: string) {
  const startParts = getZonedDateParts(item.startsAt, timezone);
  if (startParts.dateKey !== dateKey) {
    return null;
  }

  const endParts = getZonedDateParts(item.endsAt, timezone);
  const startMinutes = clampMinuteToBoard(startParts.hour * 60 + startParts.minute);
  const rawEndMinutes = endParts.dateKey === dateKey
    ? endParts.hour * 60 + endParts.minute
    : HOUR_END * 60;
  const endMinutes = Math.max(startMinutes + 30, clampMinuteToBoard(rawEndMinutes));
  const top = ((startMinutes - HOUR_START * 60) / 60) * SLOT_HEIGHT;
  const height = Math.max(32, ((endMinutes - startMinutes) / 60) * SLOT_HEIGHT);

  return { top, height };
}

/** 将分钟值限制在当前时间板的可视区间内。 */
function clampMinuteToBoard(totalMinutes: number): number {
  return Math.min(HOUR_END * 60, Math.max(HOUR_START * 60, totalMinutes));
}

/** 计算当前日期所在周的起始日，统一使用周一为一周开始。 */
function startOfWeek(dateKey: string): string {
  const weekday = weekdayFromDateKey(dateKey);
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addDaysToDateKey(dateKey, delta);
}

/** 将日期键按月偏移，供月视图翻页使用。 */
function addMonthsToDateKey(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const targetMonthIndex = month - 1 + months;
  const maxDay = new Date(Date.UTC(year, targetMonthIndex + 1, 0, 12, 0, 0)).getUTCDate();
  const next = new Date(Date.UTC(year, targetMonthIndex, Math.min(day, maxDay), 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

/** 解析 ISO 时间戳在指定时区中的日期与时间部件。 */
function getZonedDateParts(iso: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour ?? "0"),
    minute: Number(parts.minute ?? "0"),
  };
}

/** 解析事项实际所在的日期键。 */
function resolveItemDateKey(iso: string, timeZone: string): string {
  return getZonedDateParts(iso, timeZone).dateKey;
}

/** 生成主日历卡片标题。 */
function resolveCalendarCardTitle(viewMode: CalendarViewMode): string {
  if (viewMode === "day") {
    return "今日日历";
  }
  if (viewMode === "month") {
    return "本月日历";
  }
  return "本周日历";
}

/** 生成主日历卡片副标题。 */
function resolveCalendarCardSubtitle(
  viewMode: CalendarViewMode,
  selectedDate: string,
  timezone: string,
  eventCount: number,
  suggestionCount: number,
): string {
  const anchorLabel = formatDayTitle(selectedDate, timezone);
  if (viewMode === "month") {
    return `${anchorLabel} 所在月份，当前共有 ${eventCount} 个事件和 ${suggestionCount} 个建议时间块。`;
  }
  if (viewMode === "day") {
    return `${anchorLabel} 的精细时间轴，适合查看当天排满程度和建议块落点。`;
  }
  return `${anchorLabel} 所在周的时间轴，把固定事件与规划建议统一展示在一块板上。`;
}

/** 生成日期标题文本。 */
function formatDayTitle(dateKey: string, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
  }).format(dateKeyToNoonDate(dateKey));
}

/** 生成星期标签文本。 */
function formatWeekdayLabel(dateKey: string, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "short",
  }).format(dateKeyToNoonDate(dateKey));
}

/** 将日期键转换为 UTC 中午时间，避免时区边界引起偏移。 */
function dateKeyToNoonDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

/** 格式化任务摘要，统一展示截止时间、时长和优先级。 */
function formatTaskSummary(task: TaskCommitment, timezone: string): string {
  const dueLabel = task.dueAt ? formatDateTime(task.dueAt, timezone) : "截止时间待定";
  const durationLabel = task.durationMinutes ? `${task.durationMinutes} 分钟` : "时长待定";
  const priorityLabel = mapTaskPriority(task.priority);
  return `${dueLabel} · ${durationLabel} · ${priorityLabel}`;
}

/** 将任务优先级映射为可排序的数值，便于待排任务池稳定排序。 */
function resolveTaskPriorityRank(priority: TaskCommitment["priority"]): number {
  if (priority === "urgent") {
    return 4;
  }
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}

/** 格式化提醒摘要，汇总提醒时间和状态。 */
function formatReminderSummary(triggerAt: string, timezone: string, status: string): string {
  return `${formatDateTime(triggerAt, timezone)} · ${mapReminderStatus(status)}`;
}

/** 格式化自动任务摘要，汇总下次执行时间与当前状态。 */
function formatJobSummary(
  nextRunAt: string | undefined,
  status: string,
  scheduleKind: string,
): string {
  const nextRunLabel = nextRunAt ? formatDateTime(nextRunAt, Intl.DateTimeFormat().resolvedOptions().timeZone) : "等待首次调度";
  return `${mapScheduleKind(scheduleKind)} · ${mapScheduleJobStatus(status)} · ${nextRunLabel}`;
}

/** 汇总工作时段数量，在规则卡片中只暴露关键信息。 */
function formatWorkingHours(count: number): string {
  return count > 0 ? `${count} 个工作时段` : "未配置工作时段";
}

/** 汇总静默时间策略，避免直接暴露原始对象结构。 */
function formatQuietHours(
  quietHours:
    | {
        enabled: boolean;
        start: string;
        end: string;
      }
    | undefined,
): string {
  if (!quietHours || !quietHours.enabled) {
    return "未启用";
  }

  return `${quietHours.start} - ${quietHours.end}`;
}

/** 格式化某个时间点。 */
function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** 格式化一个时间窗口。 */
function formatDateTimeWindow(startsAt: string, endsAt: string, timezone: string): string {
  return `${formatDateTime(startsAt, timezone)} - ${new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(endsAt))}`;
}

/** 生成人类可读的执行记录标题。 */
function formatExecutionRunTitle(run: ExecutionRun): string {
  return run.outputSummary?.trim() ? run.outputSummary : `执行记录 ${run.id.slice(0, 8)}`;
}

/** 生成人类可读的执行记录摘要。 */
function formatExecutionRunSummary(run: ExecutionRun): string {
  if (run.errorMessage?.trim()) {
    return run.errorMessage;
  }
  if (run.finishedAt) {
    return `开始于 ${new Date(run.startedAt).toLocaleString("zh-CN")}，结束于 ${new Date(run.finishedAt).toLocaleString("zh-CN")}`;
  }
  return `开始于 ${new Date(run.startedAt).toLocaleString("zh-CN")}，仍在执行中`;
}

/** 将任务优先级映射为中文文案。 */
function mapTaskPriority(priority: string): string {
  return {
    low: "低优先级",
    medium: "中优先级",
    high: "高优先级",
    urgent: "紧急",
  }[priority] ?? priority;
}

/** 将提醒状态映射为中文文案。 */
function mapReminderStatus(status: string): string {
  return {
    scheduled: "待触发",
    delivered: "已送达",
    dismissed: "已忽略",
    cancelled: "已取消",
  }[status] ?? status;
}

/** 将自动任务调度类型映射为中文文案。 */
function mapScheduleKind(kind: string): string {
  return {
    once: "一次性",
    interval: "间隔执行",
    cron: "Cron",
  }[kind] ?? kind;
}

/** 将自动任务状态映射为中文文案。 */
function mapScheduleJobStatus(status: string): string {
  return {
    scheduled: "已计划",
    running: "执行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[status] ?? status;
}

/** 将执行记录状态映射为中文文案。 */
function mapExecutionRunStatus(status: string): string {
  return {
    running: "执行中",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
  }[status] ?? status;
}
