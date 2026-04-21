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

type TimeWorkspaceTab = "today" | "automation";
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

type AgendaEntryReason =
  | "awaiting_decision"
  | "overdue"
  | "due_today"
  | "automation_failed"
  | "team_blocked";

type AgendaEntry = {
  id: string;
  kind: "calendar_event" | "suggested_timebox" | "task_commitment" | "reminder" | "schedule_job" | "execution_run";
  title: string;
  summary: string;
  sortAt: string;
  tone: "accent" | "warning" | "muted";
  /** Pending 模块专用：为什么需要用户处理。团队动态 / 日程不用填。 */
  reason?: AgendaEntryReason;
  /** 跨模块去重键，格式 `${kind}:${domainId}`，例如 `task:abc`、`run:xyz`。 */
  sourceKey?: string;
};

const REASON_LABEL: Record<AgendaEntryReason, string> = {
  awaiting_decision: "待拍板",
  overdue: "已逾期",
  due_today: "今天到点",
  automation_failed: "自动任务失败",
  team_blocked: "团队等你确认",
};

/** 渲染桌面端时间规划主页，首版优先收敛到“今天”的个人团队总控视角。 */
export default function TimeCenterPage() {
  const workspace = useWorkspaceStore();
  const time = workspace.time;
  const timezone = time.availabilityPolicy?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayDateKey = useMemo(() => isoToDateKey(new Date().toISOString(), timezone), [timezone]);
  const [activeTab, setActiveTab] = useState<TimeWorkspaceTab>("today");
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [activeComposer, setActiveComposer] = useState<ComposerKind | null>(null);
  const [suggestedTimeboxes, setSuggestedTimeboxes] = useState<SuggestedTimebox[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const viewMode: CalendarViewMode = "day";
  const siliconPersonNameById = useMemo(
    () => new Map(workspace.siliconPersons.map((person) => [person.id, person.name])),
    [workspace.siliconPersons],
  );

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
  const myDayEntries = useMemo(
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
      jobs: time.scheduleJobs,
      suggestions: suggestedTimeboxes,
    }),
    [todayDateKey, timezone, time.todayBrief, time.calendarEvents, time.taskCommitments, time.reminders, time.scheduleJobs, suggestedTimeboxes],
  );
  const pendingTaskBacklog = useMemo(
    () => buildPendingTaskBacklog({
      tasks: time.taskCommitments,
      suggestions: suggestedTimeboxes,
      todayDateKey,
      timezone,
    }),
    [time.taskCommitments, suggestedTimeboxes, todayDateKey, timezone],
  );
  const pendingAttentionEntries = useMemo(
    () => buildPendingAttentionEntries({
      selectedDate,
      timezone,
      tasks: time.taskCommitments,
      reminders: time.reminders,
      jobs: time.scheduleJobs,
      runs: time.executionRuns,
      siliconPersonNameById,
    }),
    [
      selectedDate,
      timezone,
      time.taskCommitments,
      time.reminders,
      time.scheduleJobs,
      time.executionRuns,
      siliconPersonNameById,
    ],
  );
  const pendingSourceKeys = useMemo(
    () => new Set(pendingAttentionEntries.map((entry) => entry.sourceKey).filter((key): key is string => Boolean(key))),
    [pendingAttentionEntries],
  );
  const teamExecutionEntries = useMemo(
    () => buildTeamExecutionEntries({
      selectedDate,
      timezone,
      events: time.calendarEvents,
      tasks: time.taskCommitments,
      jobs: time.scheduleJobs,
      runs: time.executionRuns,
      siliconPersonNameById,
      pendingSourceKeys,
    }),
    [
      selectedDate,
      timezone,
      time.calendarEvents,
      time.taskCommitments,
      time.scheduleJobs,
      time.executionRuns,
      siliconPersonNameById,
      pendingSourceKeys,
    ],
  );
  const dailyControlFeed = useMemo(
    () => buildDailyControlFeed({
      personalEntries: myDayEntries,
      teamEntries: teamExecutionEntries,
    }),
    [myDayEntries, teamExecutionEntries],
  );
  const ruleDigest = useMemo(
    () => buildTodayDigest({
      todayBrief: time.todayBrief,
      snapshot: todaySnapshot,
      pendingEntries: pendingAttentionEntries,
      teamEntries: teamExecutionEntries,
      personalEntries: myDayEntries,
    }),
    [time.todayBrief, todaySnapshot, pendingAttentionEntries, teamExecutionEntries, myDayEntries],
  );
  const [modelDigest, setModelDigest] = useState<string[] | null>(null);
  const todayDigest = modelDigest && modelDigest.length > 0 ? modelDigest : ruleDigest;

  useEffect(() => {
    let cancelled = false;
    const payload = {
      todayDateKey,
      timezone,
      totals: {
        totalItems: todaySnapshot.totalItems,
        pendingCount: pendingAttentionEntries.length,
        teamCount: teamExecutionEntries.length,
        suggestionCount: todaySnapshot.suggestionCount,
      },
      leadBriefTitle: time.todayBrief?.items[0]?.title ?? null,
      leadPersonalTitle: myDayEntries[0]?.title ?? null,
      leadPendingTitle: pendingAttentionEntries[0]?.title ?? null,
      leadPendingReason: pendingAttentionEntries[0]?.reason ?? null,
      pendingEntries: pendingAttentionEntries.map((entry) => ({
        title: entry.title,
        reason: entry.reason ?? null,
      })),
      teamEntries: teamExecutionEntries.map((entry) => ({ title: entry.title })),
    };
    void (async () => {
      try {
        const lines = await workspace.generateTodayDigest(payload);
        if (!cancelled && Array.isArray(lines) && lines.length > 0) {
          console.info("[时间规划] 模型摘要已刷新", { lineCount: lines.length });
          setModelDigest(lines);
        }
      } catch (error) {
        console.warn("[时间规划] 模型摘要生成失败，回退规则摘要", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setModelDigest(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 输入稳定时不反复触发模型调用
  }, [
    todayDateKey,
    timezone,
    todaySnapshot.totalItems,
    pendingAttentionEntries.length,
    teamExecutionEntries.length,
    todaySnapshot.suggestionCount,
    time.todayBrief?.items[0]?.id,
    myDayEntries[0]?.id,
    pendingAttentionEntries[0]?.id,
  ]);
  const automationStats = useMemo(
    () => buildAutomationStats(time.reminders, time.scheduleJobs, time.executionRuns),
    [time.reminders, time.scheduleJobs, time.executionRuns],
  );
  const selectedPanelTitle = selectedDate === todayDateKey
    ? "今日全局动态"
    : `${formatDayTitle(selectedDate, timezone)}动态`;

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
      console.info("[时间规划] 跳过建议时间块刷新", {
        reason: "没有可规划的任务承诺",
        taskCount: time.taskCommitments.length,
      });
      setSuggestedTimeboxes((current) => (current.length === 0 ? current : []));
      return;
    }

    setPlannerLoading(true);
    try {
      const items = await workspace.suggestTimeboxes();
      console.info("[时间规划] 已刷新建议时间块", {
        timezone,
        suggestionCount: items.length,
      });
      setSuggestedTimeboxes(items);
    } catch (error) {
      console.warn("[时间规划] 拉取建议时间块失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      setSuggestedTimeboxes([]);
    } finally {
      setPlannerLoading(false);
    }
  }

  /** 创建手动日历事件，并在完成后关闭编辑器。 */
  async function handleCreateCalendarEvent(input: CalendarEventEditorSubmitInput) {
    console.info("[时间规划] 创建日历事件", {
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
    console.info("[时间规划] 创建任务承诺", {
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
    console.info("[时间规划] 创建提醒", {
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
    console.info("[时间规划] 创建自动任务", {
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
    console.info("[时间规划] 保存时间规则", {
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
    console.info("[时间规划] 切换自动任务状态", {
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
    console.info("[时间规划] 删除提醒", { id });
    await workspace.deleteReminder(id);
    setFeedback("已删除提醒");
  }

  /** 删除自动任务对象，并在自动化工作区即时刷新。 */
  async function handleDeleteScheduleJob(id: string) {
    console.info("[时间规划] 删除自动任务", { id });
    await workspace.deleteScheduleJob(id);
    setFeedback("已删除自动任务");
  }

  /** 推进当前选择日期，首版只按天翻页。 */
  function handleNavigate(direction: -1 | 1) {
    setSelectedDate(addDaysToDateKey(selectedDate, direction));
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
            <span className="eyebrow">TIME PLANNING</span>
            <h2 className="page-title">时间规划</h2>
            <p className="page-subtitle">把你自己、硅基员工和自动执行放进同一个今天指挥面板，先处理真正需要你把控的事项。</p>
          </div>

          <div className="time-header-actions">
            <MetricBadge label="今日事项" value={String(todaySnapshot.totalItems)} />
            <MetricBadge label="待我处理" value={String(pendingAttentionEntries.length)} />
            <MetricBadge label="团队节点" value={String(teamExecutionEntries.length || automationStats.activeJobCount)} />
            {feedback ? <div className="time-feedback-banner">{feedback}</div> : null}
          </div>
        </header>

        <section className="time-overview-band" data-testid="time-overview-band">
          <div className="time-overview-slot time-overview-slot--snapshot">
            <TodaySnapshotCard
              todayDateKey={todayDateKey}
              timezone={timezone}
              todayBrief={time.todayBrief}
              snapshot={todaySnapshot}
              digest={todayDigest}
              digestSource={modelDigest && modelDigest.length > 0 ? "model" : "rule"}
              pendingCount={pendingAttentionEntries.length}
              teamExecutionCount={teamExecutionEntries.length}
              onSelectDate={setSelectedDate}
            />
          </div>
          <div className="time-overview-slot time-overview-slot--pending">
            <PendingDecisionCard
              entries={pendingAttentionEntries}
              dateLabel={formatDayTitle(selectedDate, timezone)}
            />
          </div>
          <div className="time-overview-slot time-overview-slot--team">
            <TeamExecutionCard
              entries={teamExecutionEntries}
              dateLabel={formatDayTitle(selectedDate, timezone)}
            />
          </div>
        </section>

        <div className="time-main-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "today"}
            className={`time-main-tab ${activeTab === "today" ? "active" : ""}`}
            onClick={() => setActiveTab("today")}
          >
            今天
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

        {activeTab === "today" ? (
          <section className="time-agenda-shell" data-testid="time-agenda-shell">
            <section className="time-main-stage">
              <section className="glass-card time-calendar-card">
                <div className="glass-card__header time-calendar-card__header">
                  <div>
                    <h3 className="time-section-title">我的日程</h3>
                    <p className="time-section-subtitle">
                      {formatDayTitle(selectedDate, timezone)}真正占用你时间的安排、任务节点和建议时间块都放在这里。
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
                  <TimelineCalendarBoard
                    mode={viewMode}
                    selectedDate={selectedDate}
                    timezone={timezone}
                    items={calendarItems}
                    onSelectDate={setSelectedDate}
                  />
                </div>
              </section>
            </section>

            <aside className="time-right-rail" data-testid="time-agenda-sidebar">
              <section className="glass-card">
                <div className="glass-card__header">
                  <div>
                    <h3 className="time-section-title">{selectedPanelTitle}</h3>
                    <p className="time-section-subtitle">把个人安排和团队节点按时间顺序合并，方便你快速决定先盯哪一件。</p>
                  </div>
                  <span className="glass-pill glass-pill--muted">{formatDayTitle(selectedDate, timezone)}</span>
                </div>
                <div className="glass-card__body">
                  <AgendaEntryList entries={dailyControlFeed} emptyText="这一天还没有关键动态，适合提前补齐安排。" />
                </div>
              </section>

              <MiniMonthNavigatorCard
                todayDateKey={todayDateKey}
                selectedDate={selectedDate}
                timezone={timezone}
                items={calendarItems}
                onSelectDate={setSelectedDate}
              />

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
          grid-template-columns: repeat(2, minmax(0, 1fr));
          grid-template-areas:
            "snapshot snapshot"
            "pending team";
          gap: 18px;
          align-items: start;
        }

        .time-overview-band > * {
          min-width: 0;
        }

        .time-overview-slot--snapshot { grid-area: snapshot; }
        .time-overview-slot--pending  { grid-area: pending; }
        .time-overview-slot--team     { grid-area: team; }

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

        .time-insight-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 10px;
        }

        .time-insight-list li {
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background:
            radial-gradient(circle at top right, rgba(34, 197, 94, 0.1), transparent 48%),
            rgba(255, 255, 255, 0.03);
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.6;
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

        .time-agenda-entry__title {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }

        .time-agenda-entry__title strong {
          margin-bottom: 0;
        }

        .time-agenda-reason {
          display: inline-flex;
          align-items: center;
          height: 20px;
          padding: 0 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .time-agenda-reason--automation_failed,
        .time-agenda-reason--overdue {
          color: #ffb4b4;
          background: rgba(239, 68, 68, 0.18);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .time-agenda-reason--awaiting_decision,
        .time-agenda-reason--team_blocked {
          color: #ffd79a;
          background: rgba(245, 158, 11, 0.18);
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .time-agenda-reason--due_today {
          color: #b6f3df;
          background: rgba(16, 163, 127, 0.18);
          border: 1px solid rgba(16, 163, 127, 0.3);
        }

        .time-digest-source {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 6px;
        }

        .time-digest-source__dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.7);
        }

        .time-digest-source--model .time-digest-source__dot {
          background: rgba(34, 197, 94, 0.9);
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
    console.info("[时间规划] 切换迷你月历月份", {
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

/** 渲染左侧今日摘要卡，作为用户进入时间规划后的第一视线区域。 */
function TodaySnapshotCard({
  todayDateKey,
  timezone,
  todayBrief,
  snapshot,
  digest,
  digestSource,
  pendingCount,
  teamExecutionCount,
  onSelectDate,
}: {
  todayDateKey: string;
  timezone: string;
  todayBrief: TodayBrief | null;
  snapshot: ReturnType<typeof buildTodaySnapshot>;
  digest: string[];
  digestSource: "model" | "rule";
  pendingCount: number;
  teamExecutionCount: number;
  onSelectDate: (dateKey: string) => void;
}) {
  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">今日团队摘要</h3>
          <p className="time-section-subtitle">先给你判断，再让你进入时间线和待处理明细。</p>
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
            <span className="time-muted-copy">待我处理</span>
            <h4 style={{ fontSize: 28, marginTop: 6 }}>{pendingCount}</h4>
          </div>
          <div className="time-highlight-card">
            <span className="time-muted-copy">团队节点</span>
            <h4 style={{ fontSize: 28, marginTop: 6 }}>{teamExecutionCount}</h4>
          </div>
          <div className="time-highlight-card">
            <span className="time-muted-copy">建议时间块</span>
            <h4 style={{ fontSize: 28, marginTop: 6 }}>{snapshot.suggestionCount}</h4>
          </div>
        </div>

        <div>
          <h4 className="time-panel-list-title">今日助手摘要</h4>
          <ul className="time-insight-list">
            {digest.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className={`time-digest-source time-digest-source--${digestSource}`}>
            <span className="time-digest-source__dot" />
            {digestSource === "model" ? "模型生成" : "规则兜底"}
          </div>
        </div>

        <div>
          <h4 className="time-panel-list-title">今日重点事项</h4>
          {todayBrief?.items?.length ? (
            <ul className="time-mini-list">
              {todayBrief.items.slice(0, 3).map((item) => (
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
            <p className="time-empty-state">今天还没有进入时间规划的事项。</p>
          )}
        </div>

        <div className="time-focus-strip">
          <span className="time-focus-chip">时区 {timezone}</span>
          <span className="time-focus-chip">提醒 {snapshot.reminderCount}</span>
          <span className="time-focus-chip">待排任务 {snapshot.pendingTaskCount}</span>
        </div>
      </div>
    </section>
  );
}

/** 渲染顶部待我处理卡，把所有需要用户亲自拍板的事项集中暴露。 */
function PendingDecisionCard({
  entries,
  dateLabel,
}: {
  entries: AgendaEntry[];
  dateLabel: string;
}) {
  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">待我处理</h3>
          <p className="time-section-subtitle">{dateLabel}需要你拍板、确认、补资料或先盯住的事项。</p>
        </div>
        <span className="glass-pill glass-pill--muted">{entries.length}</span>
      </div>

      <div className="glass-card__body">
        <AgendaEntryList entries={entries} emptyText="今天没有明显阻塞，可以先进入你的核心推进项。" />
      </div>
    </section>
  );
}

/** 渲染顶部团队执行动态卡，把硅基员工相关节点从个人日程里剥出来单看。 */
function TeamExecutionCard({
  entries,
  dateLabel,
}: {
  entries: AgendaEntry[];
  dateLabel: string;
}) {
  return (
    <section className="glass-card">
      <div className="glass-card__header">
        <div>
          <h3 className="time-section-title">团队执行动态</h3>
          <p className="time-section-subtitle">{dateLabel}由硅基员工推进、回收或触发的关键节点都会集中显示在这里。</p>
        </div>
        <span className="glass-pill glass-pill--muted">{entries.length}</span>
      </div>

      <div className="glass-card__body">
        <AgendaEntryList entries={entries} emptyText="今天还没有团队回收节点，主导权更多在你自己的时间线上。" />
      </div>
    </section>
  );
}

/** 渲染右侧未排期任务卡，把还没稳定落位的任务单独收束。 */
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
          <h3 className="time-section-title">未排期任务池</h3>
          <p className="time-section-subtitle">这些任务还没有稳定落到今天的时间轴里，适合你稍后统一排位。</p>
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
          <p className="time-empty-state">当前没有悬空待办，今天的任务基本都已经有落位了。</p>
        )}
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

/** 渲染按日期聚合的动态列表，支持不同空态文案。 */
function AgendaEntryList({
  entries,
  emptyText = "这一天还没有排期与提醒，可以直接从右下角创建安排。",
}: {
  entries: AgendaEntry[];
  emptyText?: string;
}) {
  if (entries.length === 0) {
    return <p className="time-empty-state">{emptyText}</p>;
  }

  return (
    <ul className="time-agenda-list">
      {entries.map((entry) => (
        <li key={entry.id} className={`time-agenda-entry time-agenda-entry--${entry.tone}`}>
          <div className="time-agenda-entry__title">
            <strong>{entry.title}</strong>
            {entry.reason ? (
              <span className={`time-agenda-reason time-agenda-reason--${entry.reason}`}>
                {REASON_LABEL[entry.reason]}
              </span>
            ) : null}
          </div>
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

/** 构建指定日期的个人 agenda 条目列表，团队节点会单独进入团队动态卡。 */
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
    if (event.ownerScope === "silicon_person") {
      continue;
    }
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
    if (reminder.ownerScope === "silicon_person") {
      continue;
    }
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
    if (task.ownerScope === "silicon_person") {
      continue;
    }
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

/**
 * 构建“待我处理”列表，按设计文档 5.2 只收三类：
 *  A. 需要拍板/确认的事项（高优+逾期的个人任务、硅基员工高优逾期任务）
 *  B. 今天到点必须关注的提醒/任务
 *  C. 自动任务失败、执行记录失败
 * running 的正常节点不视为阻塞，归入团队执行动态。
 */
function buildPendingAttentionEntries(input: {
  selectedDate: string;
  timezone: string;
  tasks: TaskCommitment[];
  reminders: Reminder[];
  jobs: ScheduleJob[];
  runs: ExecutionRun[];
  siliconPersonNameById: ReadonlyMap<string, string>;
}) {
  const entries: AgendaEntry[] = [];
  const jobById = new Map(input.jobs.map((job) => [job.id, job]));

  for (const task of input.tasks) {
    if (task.status === "completed" || task.status === "cancelled" || !task.dueAt) {
      continue;
    }
    const dueDateKey = resolveItemDateKey(task.dueAt, task.timezone);
    if (dueDateKey > input.selectedDate) {
      continue;
    }

    const ownerLabel = resolveOwnerLabel(task.ownerScope, task.ownerId, input.siliconPersonNameById);
    const isPersonal = task.ownerScope !== "silicon_person";
    const isHighPriority = task.priority === "urgent" || task.priority === "high";
    const isOverdue = dueDateKey < input.selectedDate;

    let reason: AgendaEntryReason | null = null;
    if (isPersonal) {
      if (isOverdue) reason = "overdue";
      else if (isHighPriority) reason = "awaiting_decision";
      else reason = "due_today";
    } else if (isHighPriority && (isOverdue || dueDateKey === input.selectedDate)) {
      reason = "team_blocked";
    }
    if (!reason) continue;

    entries.push({
      id: `attention-task-${task.id}`,
      sourceKey: `task:${task.id}`,
      kind: "task_commitment",
      title: task.title,
      summary: `${ownerLabel} · ${formatTaskSummary(task, input.timezone)}`,
      sortAt: task.dueAt,
      tone: reason === "overdue" || reason === "awaiting_decision" || reason === "team_blocked" ? "warning" : "accent",
      reason,
    });
  }

  for (const reminder of input.reminders) {
    if (reminder.status !== "scheduled") continue;
    if (reminder.ownerScope === "silicon_person") continue;
    if (resolveItemDateKey(reminder.triggerAt, reminder.timezone) !== input.selectedDate) continue;

    const ownerLabel = resolveOwnerLabel(reminder.ownerScope, reminder.ownerId, input.siliconPersonNameById);
    entries.push({
      id: `attention-reminder-${reminder.id}`,
      sourceKey: `reminder:${reminder.id}`,
      kind: "reminder",
      title: reminder.title,
      summary: `${ownerLabel} · ${formatReminderSummary(reminder.triggerAt, reminder.timezone, reminder.status)}`,
      sortAt: reminder.triggerAt,
      tone: "accent",
      reason: "due_today",
    });
  }

  for (const job of input.jobs) {
    if (!job.nextRunAt) continue;
    if (resolveItemDateKey(job.nextRunAt, job.timezone) !== input.selectedDate) continue;
    if (job.status !== "failed") continue;

    const ownerLabel = resolveOwnerLabel(job.ownerScope, job.ownerId, input.siliconPersonNameById);
    entries.push({
      id: `attention-job-${job.id}`,
      sourceKey: `job:${job.id}`,
      kind: "schedule_job",
      title: job.title,
      summary: `${ownerLabel} · ${formatJobSummary(job.nextRunAt, job.status, job.scheduleKind, job.timezone)}`,
      sortAt: job.nextRunAt,
      tone: "warning",
      reason: "automation_failed",
    });
  }

  for (const run of input.runs) {
    if (run.status !== "failed") continue;
    const referenceAt = run.finishedAt ?? run.startedAt;
    if (resolveItemDateKey(referenceAt, input.timezone) !== input.selectedDate) continue;

    const relatedJob = jobById.get(run.jobId);
    const ownerLabel = relatedJob
      ? resolveOwnerLabel(relatedJob.ownerScope, relatedJob.ownerId, input.siliconPersonNameById)
      : "团队";
    entries.push({
      id: `attention-run-${run.id}`,
      sourceKey: `run:${run.id}`,
      kind: "execution_run",
      title: relatedJob?.title ?? formatExecutionRunTitle(run),
      summary: `${ownerLabel} · ${mapExecutionRunStatus(run.status)} · ${formatExecutionRunSummary(run)}`,
      sortAt: referenceAt,
      tone: "warning",
      reason: "automation_failed",
    });
  }

  const reasonRank: Record<AgendaEntryReason, number> = {
    automation_failed: 0,
    overdue: 1,
    awaiting_decision: 2,
    team_blocked: 3,
    due_today: 4,
  };

  return entries
    .sort((left, right) => {
      const delta = reasonRank[left.reason ?? "due_today"] - reasonRank[right.reason ?? "due_today"];
      if (delta !== 0) return delta;
      return left.sortAt.localeCompare(right.sortAt);
    })
    .slice(0, 6);
}

/**
 * 构建团队执行动态列表，只保留硅基员工相关的今日节点。
 * 同一个节点若已进入“待我处理”则跳过，避免两卡重复。
 */
function buildTeamExecutionEntries(input: {
  selectedDate: string;
  timezone: string;
  events: CalendarEvent[];
  tasks: TaskCommitment[];
  jobs: ScheduleJob[];
  runs: ExecutionRun[];
  siliconPersonNameById: ReadonlyMap<string, string>;
  pendingSourceKeys: ReadonlySet<string>;
}) {
  const entries: AgendaEntry[] = [];
  const jobById = new Map(input.jobs.map((job) => [job.id, job]));

  for (const event of input.events) {
    if (event.ownerScope !== "silicon_person" || resolveItemDateKey(event.startsAt, event.timezone) !== input.selectedDate) {
      continue;
    }
    const sourceKey = `event:${event.id}`;
    if (input.pendingSourceKeys.has(sourceKey)) continue;
    const ownerLabel = resolveOwnerLabel(event.ownerScope, event.ownerId, input.siliconPersonNameById);
    entries.push({
      id: `team-event-${event.id}`,
      sourceKey,
      kind: "calendar_event",
      title: event.title,
      summary: `${ownerLabel} · ${formatDateTimeWindow(event.startsAt, event.endsAt, event.timezone)}`,
      sortAt: event.startsAt,
      tone: "accent",
    });
  }

  for (const task of input.tasks) {
    if (task.ownerScope !== "silicon_person" || !task.dueAt || resolveItemDateKey(task.dueAt, task.timezone) !== input.selectedDate) {
      continue;
    }
    const sourceKey = `task:${task.id}`;
    if (input.pendingSourceKeys.has(sourceKey)) continue;
    const ownerLabel = resolveOwnerLabel(task.ownerScope, task.ownerId, input.siliconPersonNameById);
    entries.push({
      id: `team-task-${task.id}`,
      sourceKey,
      kind: "task_commitment",
      title: task.title,
      summary: `${ownerLabel} · ${formatTaskSummary(task, input.timezone)}`,
      sortAt: task.dueAt,
      tone: task.priority === "urgent" || task.priority === "high" ? "warning" : "muted",
    });
  }

  for (const job of input.jobs) {
    const anchorAt = job.nextRunAt ?? job.startsAt;
    if (!anchorAt || resolveItemDateKey(anchorAt, job.timezone) !== input.selectedDate) {
      continue;
    }
    if (job.ownerScope !== "silicon_person" && job.executor !== "silicon_person") {
      continue;
    }
    const sourceKey = `job:${job.id}`;
    if (input.pendingSourceKeys.has(sourceKey)) continue;
    const ownerLabel = resolveOwnerLabel(job.ownerScope, job.ownerId, input.siliconPersonNameById);
    entries.push({
      id: `team-job-${job.id}`,
      sourceKey,
      kind: "schedule_job",
      title: job.title,
      summary: `${ownerLabel} · ${formatJobSummary(job.nextRunAt ?? job.startsAt, job.status, job.scheduleKind, job.timezone)}`,
      sortAt: anchorAt,
      tone: job.status === "failed" ? "warning" : "muted",
    });
  }

  for (const run of input.runs) {
    const relatedJob = jobById.get(run.jobId);
    if (!relatedJob || (relatedJob.ownerScope !== "silicon_person" && relatedJob.executor !== "silicon_person")) {
      continue;
    }
    const referenceAt = run.finishedAt ?? run.startedAt;
    if (resolveItemDateKey(referenceAt, relatedJob.timezone) !== input.selectedDate) {
      continue;
    }
    const sourceKey = `run:${run.id}`;
    if (input.pendingSourceKeys.has(sourceKey)) continue;
    const ownerLabel = resolveOwnerLabel(relatedJob.ownerScope, relatedJob.ownerId, input.siliconPersonNameById);
    entries.push({
      id: `team-run-${run.id}`,
      sourceKey,
      kind: "execution_run",
      title: relatedJob.title,
      summary: `${ownerLabel} · ${mapExecutionRunStatus(run.status)} · ${formatExecutionRunSummary(run)}`,
      sortAt: referenceAt,
      tone: run.status === "failed" ? "warning" : run.status === "running" ? "accent" : "muted",
    });
  }

  return entries
    .sort((left, right) => left.sortAt.localeCompare(right.sortAt))
    .slice(0, 6);
}

/** 构建右侧全局动态，把个人日程和团队动态合并成一个顺序视图。 */
function buildDailyControlFeed(input: {
  personalEntries: AgendaEntry[];
  teamEntries: AgendaEntry[];
}) {
  return [...input.personalEntries, ...input.teamEntries]
    .sort((left, right) => left.sortAt.localeCompare(right.sortAt))
    .slice(0, 10);
}

/** 构建左侧今日摘要的聚合快照。 */
function buildTodaySnapshot(input: {
  todayDateKey: string;
  timezone: string;
  todayBrief: TodayBrief | null;
  events: CalendarEvent[];
  tasks: TaskCommitment[];
  reminders: Reminder[];
  jobs: ScheduleJob[];
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

  const eventCount = input.events.filter(
    (event) => resolveItemDateKey(event.startsAt, event.timezone) === input.todayDateKey,
  ).length;
  const taskCount = input.tasks.filter(
    (task) => task.dueAt && resolveItemDateKey(task.dueAt, task.timezone) === input.todayDateKey,
  ).length;
  const reminderCount = input.reminders.filter(
    (reminder) => resolveItemDateKey(reminder.triggerAt, reminder.timezone) === input.todayDateKey,
  ).length;
  const jobCount = input.jobs.filter(
    (job) => job.nextRunAt && resolveItemDateKey(job.nextRunAt, job.timezone) === input.todayDateKey,
  ).length;
  const suggestionCount = input.suggestions.filter(
    (suggestion) => resolveItemDateKey(suggestion.startsAt, suggestion.timezone) === input.todayDateKey,
  ).length;

  return {
    totalItems: eventCount + taskCount + reminderCount + jobCount + suggestionCount,
    pendingTaskCount: input.tasks.filter((task) => task.status === "pending" || task.status === "scheduled").length,
    reminderCount,
    suggestionCount,
    topEntries,
  };
}

/** 基于今日摘要和关键列表生成首页助手判断，首版先用可解释规则收敛成四句。 */
function buildTodayDigest(input: {
  todayBrief: TodayBrief | null;
  snapshot: ReturnType<typeof buildTodaySnapshot>;
  pendingEntries: AgendaEntry[];
  teamEntries: AgendaEntry[];
  personalEntries: AgendaEntry[];
}) {
  const lines: string[] = [];
  const leadBrief = input.todayBrief?.items[0];
  const leadPersonal = input.personalEntries[0];
  const leadPending = input.pendingEntries[0];

  lines.push(
    leadBrief
      ? `今日目标：优先盯住「${leadBrief.title}」。`
      : leadPersonal
      ? `今日目标：先推进「${leadPersonal.title}」。`
      : "今日目标：今天还比较空，可以先补齐最关键的一条安排。",
  );
  lines.push(
    leadPending
      ? `当前风险：${leadPending.title} 需要你尽快处理。`
      : "当前风险：目前没有明显阻塞，可以直接进入连续工作。",
  );
  lines.push(
    input.teamEntries.length > 0
      ? `团队动态：今天有 ${input.teamEntries.length} 个硅基员工节点会推进或回收到你这里。`
      : "团队动态：今天暂时没有团队回收节点，重心可以放在你自己的推进节奏上。",
  );
  lines.push(
    input.pendingEntries.length > 0
      ? `建议动作：先清掉 ${Math.min(input.pendingEntries.length, 2)} 个待我处理项，再进入深度工作。`
      : input.snapshot.pendingTaskCount > 0
      ? `建议动作：先给 ${Math.min(input.snapshot.pendingTaskCount, 2)} 个待排任务找落位。`
      : "建议动作：直接从今天最重要的安排开始，别让首页变成新的待办池。",
  );

  return lines;
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

/**
 * 构建右侧未排期任务池：按设计 5.5 只收“还没稳定落进今天时间轴”的任务。
 * 判定口径：个人任务 + 未完成 + 今天 suggestion 未覆盖 + （dueAt≤今天 或 无dueAt但高优）。
 */
function buildPendingTaskBacklog(input: {
  tasks: TaskCommitment[];
  suggestions: SuggestedTimebox[];
  todayDateKey: string;
  timezone: string;
}) {
  const todaySuggestedCommitmentIds = new Set(
    input.suggestions
      .filter((suggestion) => resolveItemDateKey(suggestion.startsAt, suggestion.timezone) === input.todayDateKey)
      .map((suggestion) => suggestion.commitmentId),
  );

  function shouldShowOnToday(task: TaskCommitment): boolean {
    if (task.status === "completed" || task.status === "cancelled") return false;
    if (task.ownerScope === "silicon_person") return false;
    if (todaySuggestedCommitmentIds.has(task.id)) return false;
    if (task.dueAt) {
      const dueKey = resolveItemDateKey(task.dueAt, task.timezone);
      return dueKey <= input.todayDateKey;
    }
    return task.priority === "urgent" || task.priority === "high";
  }

  return input.tasks
    .filter(shouldShowOnToday)
    .slice()
    .sort((left, right) => {
      const priorityDelta = resolveTaskPriorityRank(right.priority) - resolveTaskPriorityRank(left.priority);
      if (priorityDelta !== 0) return priorityDelta;
      return (left.dueAt ?? "9999-12-31T23:59:59.999Z").localeCompare(right.dueAt ?? "9999-12-31T23:59:59.999Z");
    })
    .slice(0, 6)
    .map((task) => ({
      task,
      summary: task.dueAt
        ? `${formatTaskSummary(task, input.timezone)} · 未生成建议时间块`
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

/** 解析事项归属人文案，统一给团队视角卡片复用。 */
function resolveOwnerLabel(
  ownerScope: "personal" | "silicon_person",
  ownerId: string | undefined,
  siliconPersonNameById: ReadonlyMap<string, string>,
): string {
  if (ownerScope === "personal") {
    return "你自己";
  }
  return ownerId ? (siliconPersonNameById.get(ownerId) ?? "硅基员工") : "硅基员工";
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
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const nextRunLabel = nextRunAt ? formatDateTime(nextRunAt, timezone) : "等待首次调度";
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
