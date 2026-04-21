import type { AvailabilityPolicy, CalendarEvent, Reminder } from "@shared/contracts";
import { isoToDateKey, weekdayFromDateKey } from "@shared/time/local-time";

export type TimeAssistantSnapshot = {
  mode: "current_event" | "focus_block" | "upcoming_event" | "upcoming_reminder" | "next_item" | "idle";
  tone: "accent" | "warning" | "neutral";
  compactLabel: string;
  statusLabel: string;
  title: string;
  detail: string;
  nowLabel: string;
  nextLabel: string | null;
  timezone: string;
};

type BuildTimeAssistantSnapshotInput = {
  nowIso: string;
  fallbackTimezone: string;
  calendarEvents: CalendarEvent[];
  reminders: Reminder[];
  availabilityPolicy: AvailabilityPolicy | null;
};

/** 构造全局时间助理快照，统一给标题栏和悬浮胶囊复用。 */
export function buildTimeAssistantSnapshot(input: BuildTimeAssistantSnapshotInput): TimeAssistantSnapshot {
  const timezone = resolveAssistantTimezone(input.availabilityPolicy, input.fallbackTimezone);
  const now = new Date(input.nowIso);
  const activeEvent = findActiveCalendarEvent(input.calendarEvents, now);

  if (activeEvent) {
    const elapsedMinutes = clampMinutesDifference(activeEvent.startsAt, input.nowIso);
    const remainingMinutes = clampMinutesDifference(input.nowIso, activeEvent.endsAt);
    return {
      mode: "current_event",
      tone: "accent",
      compactLabel: `进行中：${activeEvent.title}`,
      statusLabel: "当前时间段",
      title: activeEvent.title,
      detail: `已进行 ${elapsedMinutes} 分钟，还剩 ${remainingMinutes} 分钟`,
      nowLabel: formatNowLabel(input.nowIso, timezone),
      nextLabel: buildNextLabel({
        timezone,
        event: findUpcomingCalendarEvent(input.calendarEvents, now),
        reminder: findUpcomingReminder(input.reminders, now),
      }),
      timezone,
    };
  }

  const activeFocusBlock = findActiveFocusBlock(input.availabilityPolicy, input.nowIso, timezone);
  if (activeFocusBlock) {
    const elapsedMinutes = clampMinutesDifference(activeFocusBlock.startsAt, input.nowIso);
    const remainingMinutes = clampMinutesDifference(input.nowIso, activeFocusBlock.endsAt);
    return {
      mode: "focus_block",
      tone: "accent",
      compactLabel: `专注中 ${elapsedMinutes} 分钟`,
      statusLabel: "当前专注",
      title: activeFocusBlock.label,
      detail: `已专注 ${elapsedMinutes} 分钟，${remainingMinutes} 分钟后结束`,
      nowLabel: formatNowLabel(input.nowIso, timezone),
      nextLabel: buildNextLabel({
        timezone,
        event: findUpcomingCalendarEvent(input.calendarEvents, now),
        reminder: findUpcomingReminder(input.reminders, now),
      }),
      timezone,
    };
  }

  const upcomingEvent = findUpcomingCalendarEvent(input.calendarEvents, now);
  if (upcomingEvent) {
    const minutesUntilStart = clampMinutesDifference(input.nowIso, upcomingEvent.startsAt);
    if (minutesUntilStart <= 15) {
      return {
        mode: "upcoming_event",
        tone: "warning",
        compactLabel: `${minutesUntilStart} 分钟后会议`,
        statusLabel: "即将开始",
        title: upcomingEvent.title,
        detail: `${minutesUntilStart} 分钟后开始，建议现在收口`,
        nowLabel: formatNowLabel(input.nowIso, timezone),
        nextLabel: formatEventLabel(upcomingEvent, timezone),
        timezone,
      };
    }

    if (isSameLocalDay(input.nowIso, upcomingEvent.startsAt, timezone)) {
      return {
        mode: "next_item",
        tone: "neutral",
        compactLabel: `下一安排 · ${formatClockLabel(upcomingEvent.startsAt, timezone)}`,
        statusLabel: "下一安排",
        title: upcomingEvent.title,
        detail: `${clampMinutesDifference(input.nowIso, upcomingEvent.startsAt)} 分钟后开始`,
        nowLabel: formatNowLabel(input.nowIso, timezone),
        nextLabel: formatEventLabel(upcomingEvent, timezone),
        timezone,
      };
    }
  }

  const upcomingReminder = findUpcomingReminder(input.reminders, now);
  if (upcomingReminder) {
    const minutesUntilTrigger = clampMinutesDifference(input.nowIso, upcomingReminder.triggerAt);
    if (minutesUntilTrigger <= 15) {
      return {
        mode: "upcoming_reminder",
        tone: "warning",
        compactLabel: `${minutesUntilTrigger} 分钟后提醒`,
        statusLabel: "即将提醒",
        title: upcomingReminder.title,
        detail: `${minutesUntilTrigger} 分钟后触发，适合现在切换上下文`,
        nowLabel: formatNowLabel(input.nowIso, timezone),
        nextLabel: formatReminderLabel(upcomingReminder, timezone),
        timezone,
      };
    }
  }

  return {
    mode: "idle",
    tone: "neutral",
    compactLabel: "时间助理",
    statusLabel: "当前空档",
    title: "当前没有紧急安排",
    detail: upcomingEvent
      ? `下一项是 ${formatClockLabel(upcomingEvent.startsAt, timezone)} 的 ${upcomingEvent.title}`
      : upcomingReminder
      ? `下一条提醒在 ${formatClockLabel(upcomingReminder.triggerAt, timezone)}`
      : "可以继续当前工作，或打开时间中心安排接下来的时间块",
    nowLabel: formatNowLabel(input.nowIso, timezone),
    nextLabel: buildNextLabel({
      timezone,
      event: upcomingEvent,
      reminder: upcomingReminder,
    }),
    timezone,
  };
}

/** 解析时间助理要使用的主时区，优先复用用户的时间策略。 */
function resolveAssistantTimezone(policy: AvailabilityPolicy | null, fallbackTimezone: string): string {
  return policy?.timezone ?? fallbackTimezone;
}

/** 找出当前正在进行中的日历事件，忽略已经取消的事项。 */
function findActiveCalendarEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  return events
    .filter((event) => event.status !== "cancelled")
    .find((event) => {
      const startsAt = Date.parse(event.startsAt);
      const endsAt = Date.parse(event.endsAt);
      return startsAt <= now.getTime() && now.getTime() < endsAt;
    }) ?? null;
}

/** 找出距离现在最近的未来日历事件。 */
function findUpcomingCalendarEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  return events
    .filter((event) => event.status !== "cancelled" && Date.parse(event.startsAt) > now.getTime())
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0] ?? null;
}

/** 找出距离现在最近的未来提醒。 */
function findUpcomingReminder(reminders: Reminder[], now: Date): Reminder | null {
  return reminders
    .filter((reminder) => reminder.status === "scheduled" && Date.parse(reminder.triggerAt) > now.getTime())
    .sort((left, right) => left.triggerAt.localeCompare(right.triggerAt))[0] ?? null;
}

/** 判断当前是否落在某个专注时间块内，并补齐 UTC 起止时间。 */
function findActiveFocusBlock(policy: AvailabilityPolicy | null, nowIso: string, timezone: string) {
  if (!policy?.focusBlocks?.length) {
    return null;
  }

  const dateKey = isoToDateKey(nowIso, timezone);
  const weekday = weekdayFromDateKey(dateKey);
  const currentClock = formatClockLabel(nowIso, timezone);

  const activeBlock = policy.focusBlocks.find((block) =>
    block.weekday === weekday && currentClock >= block.start && currentClock < block.end
  );

  if (!activeBlock) {
    return null;
  }

  return {
    label: activeBlock.label,
    startsAt: new Date(`${dateKey}T${activeBlock.start}:00`).toISOString(),
    endsAt: new Date(`${dateKey}T${activeBlock.end}:00`).toISOString(),
  };
}

/** 生成顶部与胶囊通用的“当前时间”标签。 */
function formatNowLabel(nowIso: string, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    day: "numeric",
  }).format(new Date(nowIso));
}

/** 生成时间标签中的 `HH:mm` 文案，避免在多个地方重复格式化逻辑。 */
function formatClockLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 构造下一项标签，优先展示最近的事件，其次展示提醒。 */
function buildNextLabel({
  timezone,
  event,
  reminder,
}: {
  timezone: string;
  event: CalendarEvent | null;
  reminder: Reminder | null;
}): string | null {
  if (event) {
    return formatEventLabel(event, timezone);
  }
  if (reminder) {
    return formatReminderLabel(reminder, timezone);
  }
  return null;
}

/** 生成事件的紧凑时间标签，供胶囊底部展示下一项。 */
function formatEventLabel(event: CalendarEvent, timezone: string): string {
  return `${formatClockLabel(event.startsAt, timezone)} - ${event.title}`;
}

/** 生成提醒的紧凑时间标签，供胶囊底部展示下一项。 */
function formatReminderLabel(reminder: Reminder, timezone: string): string {
  return `${formatClockLabel(reminder.triggerAt, timezone)} 提醒 · ${reminder.title}`;
}

/** 计算两个 ISO 时间的分钟差，并保证返回值不出现负数。 */
function clampMinutesDifference(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
}

/** 判断两个时间点是否位于同一时区内的同一天。 */
function isSameLocalDay(leftIso: string, rightIso: string, timezone: string): boolean {
  return isoToDateKey(leftIso, timezone) === isoToDateKey(rightIso, timezone);
}
