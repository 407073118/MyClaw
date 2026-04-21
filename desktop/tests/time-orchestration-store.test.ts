import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { derivePaths } from "../src/main/services/directory-service";
import { TimeOrchestrationStore } from "../src/main/services/time-orchestration-store";

describe("TimeOrchestrationStore", () => {
  it("persists reminders and availability policy in time.db", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);

    const reminder = await store.upsertReminder({
      title: "Call doctor",
      triggerAt: "2026-04-20T07:00:00.000Z",
      timezone: "Asia/Shanghai",
    });

    const policy = await store.saveAvailabilityPolicy({
      timezone: "Asia/Shanghai",
      workingHours: [{ weekday: 1, start: "09:00", end: "18:00" }],
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
      notificationWindows: [],
      focusBlocks: [],
    });

    expect((await store.listReminders())[0]?.id).toBe(reminder.id);
    expect((await store.getAvailabilityPolicy())?.timezone).toBe(policy.timezone);

    store.close();
  });
});
