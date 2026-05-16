import { describe, expect, it } from "vitest";

import { enumerateCronRunsOnDate } from "../shared/time/cron";

describe("time cron utilities", () => {
  it("limits dense cron enumeration when a caller only needs a preview", () => {
    const runs = enumerateCronRunsOnDate("* * * * *", "2026-05-07", "Asia/Shanghai", { limit: 6 });

    expect(runs).toHaveLength(6);
    expect(runs[0]).toBe("2026-05-07T00:00:00.000Z");
    expect(runs[5]).toBe("2026-05-07T00:05:00.000Z");
  });

  it("matches weekday ranges when enumerating a local date", () => {
    const mondayRuns = enumerateCronRunsOnDate("0 9 * * 1-5", "2026-04-20", "Asia/Shanghai");
    const saturdayRuns = enumerateCronRunsOnDate("0 9 * * 1-5", "2026-04-25", "Asia/Shanghai");

    expect(mondayRuns).toEqual(["2026-04-20T01:00:00.000Z"]);
    expect(saturdayRuns).toEqual([]);
  });
});
