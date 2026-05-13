import { describe, expect, it } from "vitest";

import { resolveSiliconDesktopConfig } from "../src/desktop/desktop-config";

describe("silicon desktop config", () => {
  it("uses an app data runtime root so users do not need CLI setup", () => {
    const config = resolveSiliconDesktopConfig({
      argv: [],
      env: {},
      userDataDir: "C:\\Users\\Ada\\AppData\\Roaming\\Silicon Desktop",
    });

    expect(config.runtimeRoot).toBe("C:\\Users\\Ada\\AppData\\Roaming\\Silicon Desktop\\runtime");
    expect(config.port).toBe(17321);
    expect(config.host).toBe("127.0.0.1");
  });

  it("allows advanced overrides without making them required", () => {
    const config = resolveSiliconDesktopConfig({
      argv: ["--runtime-root", "F:\\tmp\\silicon-runtime", "--port", "18001"],
      env: {},
      userDataDir: "C:\\Users\\Ada\\AppData\\Roaming\\Silicon Desktop",
    });

    expect(config.runtimeRoot).toBe("F:\\tmp\\silicon-runtime");
    expect(config.port).toBe(18001);
  });
});
