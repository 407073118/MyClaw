import { describe, expect, it } from "vitest";

import {
  SILICON_PERSON_STATUS_VALUES,
  resolveSiliconPersonCurrentSessionId,
} from "@shared/contracts";

describe("Session state contracts", () => {
  it("exports the shared silicon session status vocabulary", () => {
    expect(SILICON_PERSON_STATUS_VALUES).toEqual(
      expect.arrayContaining([
        "idle",
        "running",
        "needs_approval",
        "done",
        "error",
        "canceling",
        "canceled",
      ]),
    );
  });

  it("keeps currentSession stable unless an explicit switch target is missing", () => {
    const sessions = [
      { id: "session-1" },
      { id: "session-2" },
    ];

    expect(
      resolveSiliconPersonCurrentSessionId({
        currentSessionId: "session-2",
        sessions,
      }),
    ).toBe("session-2");

    expect(
      resolveSiliconPersonCurrentSessionId({
        currentSessionId: "missing-session",
        sessions,
      }),
    ).toBe("session-1");

    expect(
      resolveSiliconPersonCurrentSessionId({
        currentSessionId: null,
        sessions,
      }),
    ).toBe("session-1");

    expect(
      resolveSiliconPersonCurrentSessionId({
        currentSessionId: null,
        sessions: [],
      }),
    ).toBeNull();
  });
});
