import { describe, expect, it } from "vitest";

describe("app shell branding", () => {
  it("exposes a desktop-oriented brand descriptor instead of a version label", async () => {
    const { sidebarBranding } = await import("../src/renderer/utils/app-shell-branding");

    expect(sidebarBranding.title).toBe("MyClaw");
    expect(sidebarBranding.descriptor).toBe("Desktop Assistant");
    expect(sidebarBranding).not.toHaveProperty("version");
  });
});
