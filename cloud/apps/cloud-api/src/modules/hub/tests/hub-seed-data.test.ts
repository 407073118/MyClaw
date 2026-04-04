import { describe, expect, it } from "vitest";

import { HUB_SEED_ITEMS } from "../data/hub-seed-data";

describe("hub seed data", () => {
  it("contains only hub-managed item types", () => {
    expect(new Set(HUB_SEED_ITEMS.map((item) => item.type))).toEqual(
      new Set(["mcp", "employee-package", "workflow-package"])
    );
  });

  it("ensures every seed item has at least one release", () => {
    expect(HUB_SEED_ITEMS.every((item) => item.releases.length > 0)).toBe(true);
  });
});
