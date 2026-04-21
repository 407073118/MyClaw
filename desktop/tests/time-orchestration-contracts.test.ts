import { describe, expect, it } from "vitest";

import {
  CALENDAR_EVENT_STATUS_VALUES,
  REMINDER_STATUS_VALUES,
  SCHEDULE_JOB_KIND_VALUES,
  createDefaultAvailabilityPolicy,
} from "@shared/contracts";

describe("time orchestration contracts", () => {
  it("builds a desktop-friendly default availability policy", () => {
    const policy = createDefaultAvailabilityPolicy("Asia/Shanghai");

    expect(policy.timezone).toBe("Asia/Shanghai");
    expect(policy.workingHours.length).toBeGreaterThan(0);
    expect(policy.quietHours.enabled).toBe(true);
  });

  it("exports stable enum values for reminders and jobs", () => {
    expect(CALENDAR_EVENT_STATUS_VALUES).toContain("confirmed");
    expect(REMINDER_STATUS_VALUES).toContain("scheduled");
    expect(SCHEDULE_JOB_KIND_VALUES).toEqual(["once", "interval", "cron"]);
  });
});
