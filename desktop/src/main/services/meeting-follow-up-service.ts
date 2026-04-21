import { randomUUID } from "node:crypto";

import type { CalendarEvent, Reminder, TaskCommitment } from "@shared/contracts";

import {
  addDaysToDateKey,
  dateKeyAndClockToUtcIso,
  isoToDateKey,
  weekdayFromDateKey,
} from "../../../shared/time/local-time";
import { createLogger } from "./logger";

const logger = createLogger("meeting-follow-up");

const CHINESE_WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

const ENGLISH_WEEKDAY_MAP: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

export type MeetingFollowUpExtractionInput = {
  title: string;
  summary: string;
  timezone?: string;
  now?: string;
  meetingId?: string;
};

export type MeetingFollowUpExtractionResult = {
  commitments: TaskCommitment[];
  reminders: Reminder[];
  suggestedEvents: CalendarEvent[];
};

type ResolvedTimeCandidate = {
  iso: string;
  dateKey: string;
};

/** 清理会议纪要行文本，只保留适合做 follow-up 解析的正文。 */
function normalizeMeetingLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*•\d\.\)\s]+/, "")
    .trim();
}

/** 取出时间线索后的主动作标题，避免把时间 token 原样塞进时间中心标题。 */
function deriveActionTitle(line: string): string {
  return line
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi, "")
    .replace(/(今天|明天|后天|本周|下周|周[一二三四五六日天])/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .replace(/前/g, "")
    .replace(/^[A-Za-z\u4e00-\u9fa5]{1,20}\s+/, "")
    .replace(/\s+/g, " ")
    .trim() || line.trim();
}

/** 计算当前日期所在周的周一起点，便于解析“下周二”这类表达。 */
function getMondayDateKey(dateKey: string): string {
  const weekday = weekdayFromDateKey(dateKey);
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDaysToDateKey(dateKey, offset);
}

/** 根据周表达式解析目标日期键，支持“周二 / 下周二 / Friday”这类输入。 */
function resolveWeekdayDateKey(
  currentDateKey: string,
  targetWeekday: number,
  mode: "next-occurrence" | "next-week",
): string {
  if (mode === "next-week") {
    const monday = getMondayDateKey(currentDateKey);
    const offset = targetWeekday === 0 ? 6 : targetWeekday - 1;
    return addDaysToDateKey(monday, 7 + offset);
  }

  const currentWeekday = weekdayFromDateKey(currentDateKey);
  let delta = targetWeekday - currentWeekday;
  if (delta < 0) {
    delta += 7;
  }
  return addDaysToDateKey(currentDateKey, delta);
}

/** 从一行文本中解析最有价值的时间线索，供 reminder / event / dueAt 复用。 */
function resolveTimeCandidate(
  line: string,
  timezone: string,
  nowIso: string,
  defaultClock: string,
): ResolvedTimeCandidate | null {
  const nowDateKey = isoToDateKey(nowIso, timezone);

  const absoluteMatch = line.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
  if (absoluteMatch) {
    const dateKey = absoluteMatch[1];
    const clock = absoluteMatch[2] ?? defaultClock;
    return {
      dateKey,
      iso: dateKeyAndClockToUtcIso(dateKey, clock, timezone),
    };
  }

  const relativeDayMatch = line.match(/(今天|明天|后天)(?:\s*(\d{1,2}:\d{2}))?/);
  if (relativeDayMatch) {
    const offset = relativeDayMatch[1] === "今天"
      ? 0
      : relativeDayMatch[1] === "明天"
        ? 1
        : 2;
    const dateKey = addDaysToDateKey(nowDateKey, offset);
    const clock = relativeDayMatch[2] ?? defaultClock;
    return {
      dateKey,
      iso: dateKeyAndClockToUtcIso(dateKey, clock, timezone),
    };
  }

  const chineseWeekdayMatch = line.match(/(下周|本周|周)([一二三四五六日天])(?:\s*(\d{1,2}:\d{2}))?/);
  if (chineseWeekdayMatch) {
    const mode = chineseWeekdayMatch[1] === "下周" ? "next-week" : "next-occurrence";
    const weekday = CHINESE_WEEKDAY_MAP[chineseWeekdayMatch[2]];
    const dateKey = resolveWeekdayDateKey(nowDateKey, weekday, mode);
    const clock = chineseWeekdayMatch[3] ?? defaultClock;
    return {
      dateKey,
      iso: dateKeyAndClockToUtcIso(dateKey, clock, timezone),
    };
  }

  const englishWeekdayMatch = line.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b(?:\s*(\d{1,2}:\d{2}))?/i);
  if (englishWeekdayMatch) {
    const weekday = ENGLISH_WEEKDAY_MAP[englishWeekdayMatch[1].toLowerCase()];
    const dateKey = resolveWeekdayDateKey(nowDateKey, weekday, "next-occurrence");
    const clock = englishWeekdayMatch[2] ?? defaultClock;
    return {
      dateKey,
      iso: dateKeyAndClockToUtcIso(dateKey, clock, timezone),
    };
  }

  return null;
}

/** 判断某一行更像固定时间的事件，而不是普通待办。 */
function shouldCreateEvent(line: string): boolean {
  return /(回看|回顾|复盘|review|sync|会议|会审|对齐)/i.test(line);
}

/** 判断某一行更像提醒表达，适合生成一次性 reminder。 */
function shouldCreateReminder(line: string): boolean {
  return /提醒|remember|ping|催/i.test(line);
}

/**
 * 从会议纪要中提取后续事项草案。
 * 当前版本优先服务 desktop-first 的显式导入链路，不依赖额外模型调用。
 */
export async function extractMeetingFollowUps(
  input: MeetingFollowUpExtractionInput,
): Promise<MeetingFollowUpExtractionResult> {
  const timezone = input.timezone ?? "Asia/Shanghai";
  const nowIso = input.now ?? new Date().toISOString();
  const baseTitle = input.title.trim() || "会议跟进";
  const lines = input.summary
    .split(/\r?\n/)
    .map(normalizeMeetingLine)
    .filter((line) => line.length > 0);

  logger.info("开始提取会议跟进事项", {
    title: baseTitle,
    timezone,
    lineCount: lines.length,
    meetingId: input.meetingId ?? null,
  });

  const commitments: TaskCommitment[] = [];
  const reminders: Reminder[] = [];
  const suggestedEvents: CalendarEvent[] = [];

  for (const line of lines) {
    const now = nowIso;
    const actionTitle = deriveActionTitle(line);
    const relatedRef = input.meetingId ?? baseTitle;

    if (!actionTitle) {
      continue;
    }

    if (shouldCreateReminder(line)) {
      const reminderTime = resolveTimeCandidate(line, timezone, now, "09:00");
      if (reminderTime) {
        reminders.push({
          id: randomUUID(),
          kind: "reminder",
          title: actionTitle,
          body: `来自会议《${baseTitle}》的提醒`,
          triggerAt: reminderTime.iso,
          timezone,
          ownerScope: "personal",
          status: "scheduled",
          source: "meeting",
          externalRef: relatedRef,
          createdAt: now,
          updatedAt: now,
        });
      }
      continue;
    }

    if (shouldCreateEvent(line)) {
      const eventTime = resolveTimeCandidate(line, timezone, now, "09:00");
      if (eventTime) {
        suggestedEvents.push({
          id: randomUUID(),
          kind: "calendar_event",
          title: actionTitle,
          description: `来自会议《${baseTitle}》的后续安排`,
          startsAt: eventTime.iso,
          endsAt: new Date(new Date(eventTime.iso).getTime() + 60 * 60_000).toISOString(),
          timezone,
          ownerScope: "personal",
          status: "confirmed",
          source: "meeting",
          externalRef: relatedRef,
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }
    }

    const dueCandidate = resolveTimeCandidate(line, timezone, now, "18:00");
    commitments.push({
      id: randomUUID(),
      kind: "task_commitment",
      title: actionTitle,
      description: `来自会议《${baseTitle}》的待办`,
      dueAt: dueCandidate?.iso,
      durationMinutes: 60,
      timezone,
      ownerScope: "personal",
      priority: dueCandidate ? "high" : "medium",
      status: "pending",
      source: "meeting",
      externalRef: relatedRef,
      createdAt: now,
      updatedAt: now,
    });
  }

  logger.info("会议跟进事项提取完成", {
    title: baseTitle,
    commitments: commitments.length,
    reminders: reminders.length,
    suggestedEvents: suggestedEvents.length,
  });

  return {
    commitments,
    reminders,
    suggestedEvents,
  };
}
