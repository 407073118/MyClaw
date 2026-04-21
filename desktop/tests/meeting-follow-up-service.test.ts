import { describe, expect, it } from "vitest";

import { extractMeetingFollowUps } from "../src/main/services/meeting-follow-up-service";

describe("meeting follow-up service", () => {
  it("extracts commitments and suggested events from summary text", async () => {
    const result = await extractMeetingFollowUps({
      title: "Weekly sync",
      summary: "- Alice Friday前交付方案\n- 下周二 10:00 回看结果",
      timezone: "Asia/Shanghai",
      now: "2026-04-18T08:00:00.000Z",
    });

    expect(result.commitments.length).toBeGreaterThan(0);
    expect(result.suggestedEvents.length).toBeGreaterThan(0);
    expect(result.commitments[0]).toEqual(
      expect.objectContaining({
        source: "meeting",
        ownerScope: "personal",
      }),
    );
    expect(result.suggestedEvents[0]).toEqual(
      expect.objectContaining({
        kind: "calendar_event",
        title: expect.stringContaining("回看结果"),
      }),
    );
  });
});
