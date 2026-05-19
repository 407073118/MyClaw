import { Notification } from "electron";

import type { AvailabilityPolicy } from "@shared/contracts";

export const MYCLAW_APP_USER_MODEL_ID = "com.myclaw.desktop";

type ReminderLike = {
  id?: string;
  title: string;
  body?: string;
  timezone?: string;
};

export type NativeReminderNotification = {
  id?: string;
  title: string;
  subtitle?: string;
  body?: string;
  icon?: string | null;
  silent: boolean;
  timeoutType?: "default" | "never";
  urgency?: "normal" | "critical" | "low";
};

export type TimeReminderDeliveredPayload = {
  id?: string;
  title: string;
  body?: string;
  deliveredAt: string;
};

export type TimeNotificationServiceDeps = {
  now?: () => Date;
  platform?: NodeJS.Platform;
  appIconPath?: string | null;
  nativeDeliveryTimeoutMs?: number;
  send?: (notification: NativeReminderNotification) => Promise<void>;
  onNativeClick?: () => Promise<void> | void;
  onDelivered?: (payload: TimeReminderDeliveredPayload) => Promise<void> | void;
};

export type TimeNotificationService = ReturnType<typeof createTimeNotificationService>;

export type NativeNotificationIdentityDeps = {
  platform?: NodeJS.Platform;
  setAppUserModelId?: (id: string) => void;
};

/** 解析 HH:mm 文本为当天分钟数，用于静默时段边界判断。 */
function parseClock(clock: string): number {
  const [hour, minute] = clock.split(":").map((value) => Number(value));
  return (hour * 60) + minute;
}

/** 按指定时区计算当前分钟数，避免系统时区影响用户配置。 */
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

/** 判断当前时间是否落入用户配置的静默时段，支持跨天区间。 */
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

/** 在 Windows 上配置 AppUserModelID，保证系统 Toast 能归属到 MyClaw。 */
export function configureNativeNotificationIdentity(deps: NativeNotificationIdentityDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    console.info("[time-notification] 非 Windows 平台，跳过系统通知身份配置", { platform });
    return false;
  }
  if (!deps.setAppUserModelId) {
    console.warn("[time-notification] Windows 系统通知身份配置缺少 setAppUserModelId 方法");
    return false;
  }
  deps.setAppUserModelId(MYCLAW_APP_USER_MODEL_ID);
  console.info("[time-notification] 已配置 Windows 系统通知 AppUserModelID", {
    appUserModelId: MYCLAW_APP_USER_MODEL_ID,
  });
  return true;
}

/** 构造系统级提醒通知参数，按操作系统只携带其支持的原生字段。 */
function buildNativeReminderNotification(
  reminder: ReminderLike,
  platform: NodeJS.Platform,
  appIconPath?: string | null,
): NativeReminderNotification {
  console.info("[time-notification] 构造系统提醒通知参数", {
    id: reminder.id,
    title: reminder.title,
    platform,
    hasIcon: Boolean(appIconPath),
  });
  const baseNotification: NativeReminderNotification = {
    id: reminder.id,
    title: reminder.title,
    subtitle: undefined,
    body: reminder.body,
    icon: appIconPath,
    silent: false,
    timeoutType: undefined,
    urgency: undefined,
  };
  if (platform === "darwin") {
    return {
      ...baseNotification,
      subtitle: "MyClaw 提醒",
    };
  }
  if (platform === "win32") {
    return {
      ...baseNotification,
      timeoutType: "never",
    };
  }
  if (platform === "linux") {
    return {
      ...baseNotification,
      timeoutType: "default",
      urgency: "normal",
    };
  }
  return baseNotification;
}

/** 通过 Electron Notification 发送原生系统通知，并等待 show / failed 信号。 */
async function sendNativeReminderNotification(
  notification: NativeReminderNotification,
  onNativeClick?: () => Promise<void> | void,
  timeoutMs = 3_000,
): Promise<void> {
  console.info("[time-notification] 准备发送系统提醒通知", {
    title: notification.title,
    timeoutType: notification.timeoutType,
    urgency: notification.urgency,
  });
  if (!Notification.isSupported()) {
    throw new Error("当前系统不支持 Electron 原生通知");
  }

  await new Promise<void>((resolve, reject) => {
    const nativeNotification = new Notification({
      title: notification.title,
      subtitle: notification.subtitle,
      body: notification.body,
      icon: notification.icon || undefined,
      silent: notification.silent,
      timeoutType: notification.timeoutType,
      urgency: notification.urgency,
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn("[time-notification] 系统通知未及时返回 show 事件，按已投递继续", {
        title: notification.title,
        timeoutMs,
      });
      resolve();
    }, timeoutMs);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    nativeNotification.once("show", () => {
      settle(() => {
        console.info("[time-notification] 系统提醒通知已显示", { title: notification.title });
        resolve();
      });
    });
    nativeNotification.once("failed", (_event, error) => {
      settle(() => {
        console.warn("[time-notification] 系统提醒通知显示失败", {
          title: notification.title,
          error,
        });
        reject(new Error(error));
      });
    });
    nativeNotification.on("click", () => {
      console.info("[time-notification] 用户点击系统提醒通知", { title: notification.title });
      void onNativeClick?.();
    });
    nativeNotification.show();
  });
}

export function createTimeNotificationService(deps: TimeNotificationServiceDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const platform = deps.platform ?? process.platform;
  const send = deps.send ?? ((notification: NativeReminderNotification) =>
    sendNativeReminderNotification(notification, deps.onNativeClick, deps.nativeDeliveryTimeoutMs));
  const onDelivered = deps.onDelivered;

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

      let nativeDelivered = false;
      const nativeNotification = buildNativeReminderNotification(reminder, platform, deps.appIconPath);
      try {
        await send(nativeNotification);
        nativeDelivered = true;
        console.info("[time-notification] 已发送系统提醒通知", { title: reminder.title });
      } catch (error) {
        console.warn("[time-notification] 系统提醒通知发送失败，继续发送应用内提醒", {
          title: reminder.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (onDelivered) {
        await onDelivered({
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          deliveredAt: now().toISOString(),
        });
        console.info("[time-notification] 已发送应用内提醒事件", { title: reminder.title });
        return true;
      }

      return nativeDelivered;
    },
  };
}
