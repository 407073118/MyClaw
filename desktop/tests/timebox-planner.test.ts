import { describe, expect, it } from "vitest";

import { planTimeboxes } from "../src/main/services/timebox-planner";

describe("planTimeboxes", () => {
  it("places a 120-minute task into the earliest valid free window", () => {
    const result = planTimeboxes({
      events: [
        {
          startsAt: "2026-04-21T01:00:00.000Z",
          endsAt: "2026-04-21T02:00:00.000Z",
        },
      ],
      commitments: [
        {
          id: "task-1",
          title: "Write weekly summary",
          dueAt: "2026-04-21T10:00:00.000Z",
          durationMinutes: 120,
          priority: "high",
        },
      ],
      timezone: "Asia/Shanghai",
    });

    expect(result[0]?.commitmentId).toBe("task-1");
    expect(result[0]?.startsAt).toBe("2026-04-21T02:00:00.000Z");
    expect(result[0]?.endsAt).toBe("2026-04-21T04:00:00.000Z");
  });
});
