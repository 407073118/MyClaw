import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("hub prisma schema", () => {
  it("declares HubItem and HubRelease models for repository access", () => {
    const schemaPath = resolve(__dirname, "../../../../prisma/schema.prisma");
    const schema = readFileSync(schemaPath, "utf-8");

    expect(schema).toContain("model HubItem");
    expect(schema).toContain("model HubRelease");
    expect(schema).toContain("@@map(\"hub_item\")");
    expect(schema).toContain("@@map(\"hub_release\")");
  });
});
