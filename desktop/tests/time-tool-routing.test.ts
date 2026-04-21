import { describe, expect, it, vi } from "vitest";

import { executeTimeTool } from "../src/main/ipc/sessions";
import { buildToolLabel, functionNameToToolId } from "../src/main/services/tool-schemas";

describe("time tool routing", () => {
  it("keeps multi-word time tool ids stable", () => {
    expect(functionNameToToolId("reminder_create")).toBe("reminder.create");
    expect(functionNameToToolId("schedule_job_create")).toBe("schedule_job.create");
    expect(functionNameToToolId("today_brief_get")).toBe("today_brief.get");
  });

  it("serializes time tool arguments as json labels", () => {
    const reminderLabel = buildToolLabel("reminder_create", {
      title: "Call doctor",
      triggerAt: "2026-04-20T07:00:00.000Z",
    });
    expect(JSON.parse(reminderLabel)).toEqual({
      title: "Call doctor",
      triggerAt: "2026-04-20T07:00:00.000Z",
    });

    const jobLabel = buildToolLabel("schedule_job_create", {
      title: "Weekly report",
      scheduleKind: "cron",
      cronExpression: "0 0 9 * * 1",
    });
    expect(JSON.parse(jobLabel)).toEqual({
      title: "Weekly report",
      scheduleKind: "cron",
      cronExpression: "0 0 9 * * 1",
    });
  });

  it("creates reminders through the session tool-family handler", async () => {
    const saveReminder = vi.fn(async (input: Record<string, unknown>) => ({
      id: "rem-1",
      kind: "reminder",
      title: input.title,
      body: input.body,
      triggerAt: input.triggerAt,
      timezone: input.timezone,
      ownerScope: "personal",
      status: "scheduled",
      source: "agent",
      createdAt: "2026-04-18T08:00:00.000Z",
      updatedAt: "2026-04-18T08:00:00.000Z",
    }));

    const result = await executeTimeTool(
      {
        services: {
          timeApplication: {
            saveReminder,
            listReminders: vi.fn(),
            saveScheduleJob: vi.fn(),
            listScheduleJobs: vi.fn(),
            getTodayBrief: vi.fn(),
            getAvailabilityPolicy: vi.fn(async () => null),
          },
        },
      } as any,
      "reminder.create",
      {
        title: "Call doctor",
        triggerAt: "2026-04-20T07:00:00.000Z",
      },
    );

    expect(result.success).toBe(true);
    expect(result.mutated).toBe(true);
    expect(saveReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Call doctor",
        triggerAt: "2026-04-20T07:00:00.000Z",
        source: "agent",
      }),
    );
    expect(JSON.parse(result.output)).toEqual(
      expect.objectContaining({
        id: "rem-1",
        kind: "reminder",
        title: "Call doctor",
      }),
    );
  });

  it("returns the today brief through the same dispatcher without mutations", async () => {
    const getTodayBrief = vi.fn(async () => ({
      generatedAt: "2026-04-18T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      items: [
        {
          id: "brief-1",
          kind: "reminder",
          title: "Call doctor",
          startsAt: "2026-04-20T07:00:00.000Z",
          summary: "Reminder at 2026-04-20T07:00:00.000Z",
        },
      ],
    }));

    const result = await executeTimeTool(
      {
        services: {
          timeApplication: {
            saveReminder: vi.fn(),
            listReminders: vi.fn(),
            saveScheduleJob: vi.fn(),
            listScheduleJobs: vi.fn(),
            getTodayBrief,
            getAvailabilityPolicy: vi.fn(async () => null),
          },
        },
      } as any,
      "today_brief.get",
      {},
    );

    expect(result.success).toBe(true);
    expect(result.mutated).toBe(false);
    expect(getTodayBrief).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.output)).toEqual(
      expect.objectContaining({
        timezone: "Asia/Shanghai",
      }),
    );
  });
});
