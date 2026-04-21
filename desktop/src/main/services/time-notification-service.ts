import { Notification } from "electron";

import type { AvailabilityPolicy } from "@shared/contracts";

type ReminderLike = {
  title: string;
  body?: string;
  timezone?: string;
};

export type TimeNotificationServiceDeps = {
  now?: () => Date;
  send?: (title: string, body?: string) => Promise<void>;
};

export type TimeNotificationService = ReturnType<typeof createTimeNotificationService>;

function parseClock(clock: string): number {
  const [hour, minute] = clock.split(":").map((value) => Number(value));
  return (hour * 60) + minute;
}

function resolveCurrentMinutes(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return (hour * 60) + minute;
}

function isWithinQuietHours(now: Date, policy: AvailabilityPolicy): boolean {
  if (!policy.quietHours.enabled) {
    return false;
  }
  const currentMinutes = resolveCurrentMinutes(now, policy.timezone);
  const startMinutes = parseClock(policy.quietHours.start);
  const endMinutes = parseClock(policy.quietHours.end);
  if (startMinutes === endMinutes) {
    return true;
  }
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function createTimeNotificationService(deps: TimeNotificationServiceDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const send = deps.send ?? (async (title: string, body?: string) => {
    new Notification({ title, body }).show();
  });

  return {
    /**
     * 按可用时段策略投递提醒，静默时段内默认抑制通知。
     */
    async deliverReminder(reminder: ReminderLike, policy: AvailabilityPolicy | null): Promise<boolean> {
      console.info("[time-notification] 尝试投递提醒", {
        title: reminder.title,
        timezone: policy?.timezone ?? reminder.timezone ?? "system",
      });
      if (policy && isWithinQuietHours(now(), policy)) {
        console.info("[time-notification] 命中静默时段，抑制提醒", {
          title: reminder.title,
          timezone: policy.timezone,
        });
        return false;
      }

      await send(reminder.title, reminder.body);
      console.info("[time-notification] 已发送提醒通知", { title: reminder.title });
      return true;
    },
  };
}
