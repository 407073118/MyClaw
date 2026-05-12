import { describe, expect, it } from "vitest";

import { enumerateCronRunsOnDate } from "../shared/time/cron";

describe("time cron utilities", () => {
  it("limits dense cron enumeration when a caller only needs a preview", () => {
    const runs = enumerateCronRunsOnDate("* * * * *", "2026-05-07", "Asia/Shanghai", { limit: 6 });

    expect(runs).toHaveLength(6);
    expect(runs[0]).toBe("2026-05-07T00:00:00.000Z");
    expect(runs[5]).toBe("2026-05-07T00:05:00.000Z");
  });
});
