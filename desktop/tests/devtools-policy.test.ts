import { describe, expect, it } from "vitest";

import { shouldAutoOpenDevTools } from "../src/main/services/devtools-policy";

describe("devtools policy", () => {
  it("does not auto-open DevTools in development by default", () => {
    expect(shouldAutoOpenDevTools({
      isDev: true,
      env: {},
    })).toBe(false);
  });

  it("auto-opens DevTools in development when explicitly enabled", () => {
    expect(shouldAutoOpenDevTools({
      isDev: true,
      env: {
        MYCLAW_OPEN_DEVTOOLS: "1",
      },
    })).toBe(true);
  });

  it("does not auto-open DevTools outside development even when enabled", () => {
    expect(shouldAutoOpenDevTools({
      isDev: false,
      env: {
        MYCLAW_OPEN_DEVTOOLS: "1",
      },
    })).toBe(false);
  });
});
