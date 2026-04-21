import { describe, expect, it } from "vitest";

import type { AvailabilityPolicy, CalendarEvent, Reminder } from "@shared/contracts";

import { buildTimeAssistantSnapshot } from "../src/renderer/utils/time-assistant-presence";

/** 构造最小可用的时间策略，供时间助理状态测试复用。 */
function createAvailabilityPolicy(timezone: string): AvailabilityPolicy {
  return {
    timezone,
    workingHours: [],
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "08:00",
    },
    notificationWindows: [],
    focusBlocks: [],
  };
}

/** 构造测试日历事件，避免在每个用例里重复填写噪声字段。 */
function createCalendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    kind: "calendar_event",
    title: "产品评审",
    startsAt: "2026-04-20T02:15:00.000Z",
    endsAt: "2026-04-20T03:00:00.000Z",
    timezone: "Asia/Shanghai",
    ownerScope: "personal",
    status: "confirmed",
    source: "manual",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

/** 构造测试提醒，便于验证即将到来的提醒优先级。 */
function createReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: "reminder-1",
    kind: "reminder",
    title: "喝水",
    triggerAt: "2026-04-20T02:10:00.000Z",
    timezone: "Asia/Shanghai",
    ownerScope: "personal",
    status: "scheduled",
    source: "manual",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildTimeAssistantSnapshot", () => {
  it("surfaces an upcoming meeting in the compact and expanded status", () => {
    const snapshot = buildTimeAssistantSnapshot({
      nowIso: "2026-04-20T02:00:00.000Z",
      fallbackTimezone: "Asia/Shanghai",
      calendarEvents: [createCalendarEvent({})],
      reminders: [],
      availabilityPolicy: createAvailabilityPolicy("Asia/Shanghai"),
    });

    expect(snapshot.compactLabel).toBe("15 分钟后会议");
    expect(snapshot.statusLabel).toBe("即将开始");
    expect(snapshot.title).toBe("产品评审");
    expect(snapshot.detail).toContain("15 分钟后开始");
  });

  it("prefers an active calendar block over reminders and reports elapsed progress", () => {
    const snapshot = buildTimeAssistantSnapshot({
      nowIso: "2026-04-20T02:30:00.000Z",
      fallbackTimezone: "Asia/Shanghai",
      calendarEvents: [
        createCalendarEvent({
          startsAt: "2026-04-20T02:00:00.000Z",
          endsAt: "2026-04-20T03:00:00.000Z",
        }),
      ],
      reminders: [createReminder({ triggerAt: "2026-04-20T02:35:00.000Z", title: "会后整理纪要" })],
      availabilityPolicy: createAvailabilityPolicy("Asia/Shanghai"),
    });

    expect(snapshot.compactLabel).toBe("进行中：产品评审");
    expect(snapshot.statusLabel).toBe("当前时间段");
    expect(snapshot.detail).toContain("已进行 30 分钟");
    expect(snapshot.detail).toContain("还剩 30 分钟");
  });
});
