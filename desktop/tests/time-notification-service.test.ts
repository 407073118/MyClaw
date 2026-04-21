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
});
