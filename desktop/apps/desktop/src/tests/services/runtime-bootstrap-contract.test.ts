import { describe, expect, it } from "vitest";

import type { BootstrapPayload } from "@/services/runtime-client";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

describe("runtime bootstrap contract", () => {
  it("exposes .myClaw storage paths in fixture payload", () => {
    const fixture = createWorkspaceFixture();
    const storagePaths: Pick<
      BootstrapPayload,
      "myClawRootPath" | "skillsRootPath" | "sessionsRootPath"
    > = fixture;

    expect(storagePaths.myClawRootPath.endsWith(".myClaw")).toBe(true);
    expect(storagePaths.skillsRootPath.endsWith(".myClaw/skills")).toBe(true);
    expect(storagePaths.sessionsRootPath.endsWith(".myClaw/sessions")).toBe(true);
  });
});
