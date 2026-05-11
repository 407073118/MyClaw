import { describe, expect, it } from "vitest";

import { createTimeNotificationService } from "../src/main/services/time-notification-service";

describe("time notification service", () => {
  it("suppresses notifications during quiet hours when delivery policy is normal", async () => {
    const sent: string[] = [];
    const service = createTimeNotificationService({
      send: async (title) => {
        sent.push(title);
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
