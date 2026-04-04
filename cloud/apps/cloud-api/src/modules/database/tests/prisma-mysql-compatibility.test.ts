import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("prisma mysql compatibility", () => {
  it("does not assign default values to TEXT columns", () => {
    const schemaPath = resolve(__dirname, "../../../../prisma/schema.prisma");
    const schema = readFileSync(schemaPath, "utf-8");

    expect(schema).not.toContain('@default("") @db.Text');
  });
});
