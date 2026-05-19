import { describe, expect, it, vi } from "vitest";

import {
  MYCLAW_APP_USER_MODEL_ID,
  configureNativeNotificationIdentity,
  createTimeNotificationService,
  type NativeReminderNotification,
} from "../src/main/services/time-notification-service";

describe("time notification service", () => {
  it("configures the Windows AppUserModelID for native reminder toasts", () => {
    const setAppUserModelId = vi.fn();

    const configured = configureNativeNotificationIdentity({
      platform: "win32",
      setAppUserModelId,
    });

    expect(configured).toBe(true);
    expect(setAppUserModelId).toHaveBeenCalledWith(MYCLAW_APP_USER_MODEL_ID);
  });

  it("does not configure a Windows AppUserModelID on macOS", () => {
    const setAppUserModelId = vi.fn();

    const configured = configureNativeNotificationIdentity({
      platform: "darwin",
      setAppUserModelId,
    });

    expect(configured).toBe(false);
    expect(setAppUserModelId).not.toHaveBeenCalled();
  });

  it("suppresses notifications during quiet hours when delivery policy is normal", async () => {
    const sent: string[] = [];
    const service = createTimeNotificationService({
      send: async (notification) => {
        sent.push(notification.title);
      },
      now: () => new Date("2026-04-20T23:30:00.000Z"),
    });

    await service.deliverReminder(
      { title: "Late ping", body: "Check deploy" } as any,
      {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: { enabled: true, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
    );

    expect(sent).toEqual([]);
  });

  it("sends reminders as persistent native notifications", async () => {
    const sent: NativeReminderNotification[] = [];
    const service = createTimeNotificationService({
      send: async (notification) => {
        sent.push(notification);
      },
      platform: "win32",
      now: () => new Date("2026-04-20T09:30:00.000Z"),
      appIconPath: "F:\\MyClaw\\desktop\\build\\icon.ico",
    });

    const result = await service.deliverReminder(
      { id: "reminder-review", title: "需求评审", body: "15 分钟后开始" } as any,
      {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: { enabled: false, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
    );

    expect(result).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({
        id: "reminder-review",
        title: "需求评审",
        body: "15 分钟后开始",
        timeoutType: "never",
        urgency: undefined,
        subtitle: undefined,
        silent: false,
        icon: "F:\\MyClaw\\desktop\\build\\icon.ico",
      }),
    ]);
  });

  it("sends reminders with macOS native notification fields", async () => {
    const sent: NativeReminderNotification[] = [];
    const service = createTimeNotificationService({
      send: async (notification) => {
        sent.push(notification);
      },
      platform: "darwin",
      now: () => new Date("2026-04-20T09:30:00.000Z"),
      appIconPath: "/Applications/MyClaw.app/Contents/Resources/icon.icns",
    });

    const result = await service.deliverReminder(
      { id: "reminder-mac", title: "站会", body: "现在开始" } as any,
      {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: { enabled: false, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
    );

    expect(result).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({
        id: "reminder-mac",
        title: "站会",
        body: "现在开始",
        subtitle: "MyClaw 提醒",
        timeoutType: undefined,
        urgency: undefined,
        silent: false,
        icon: "/Applications/MyClaw.app/Contents/Resources/icon.icns",
      }),
    ]);
  });

  it("sends reminders with Linux notification urgency", async () => {
    const sent: NativeReminderNotification[] = [];
    const service = createTimeNotificationService({
      send: async (notification) => {
        sent.push(notification);
      },
      platform: "linux",
      now: () => new Date("2026-04-20T09:30:00.000Z"),
    });

    const result = await service.deliverReminder(
      { id: "reminder-linux", title: "巡检", body: "查看任务状态" } as any,
      {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: { enabled: false, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
    );

    expect(result).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({
        id: "reminder-linux",
        title: "巡检",
        body: "查看任务状态",
        subtitle: undefined,
        timeoutType: "default",
        urgency: "normal",
        silent: false,
      }),
    ]);
  });

  it("still emits an in-app reminder when native notification delivery fails", async () => {
    const delivered: Array<{ title: string; body?: string }> = [];
    const service = createTimeNotificationService({
      send: async () => {
        throw new Error("native notification unavailable");
      },
      onDelivered: async (payload) => {
        delivered.push({ title: payload.title, body: payload.body });
      },
      now: () => new Date("2026-04-20T09:30:00.000Z"),
    });

    const result = await service.deliverReminder(
      { title: "需求评审", body: "15 分钟后开始" } as any,
      {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: { enabled: false, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
    );

    expect(result).toBe(true);
    expect(delivered).toEqual([{ title: "需求评审", body: "15 分钟后开始" }]);
  });
});
