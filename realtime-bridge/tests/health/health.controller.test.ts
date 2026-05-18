import { describe, expect, it } from "vitest";

import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController", () => {
  it("returns service status", () => {
    const controller = new HealthController();
    expect(controller.getHealth()).toEqual({
      ok: true,
      service: "realtime-bridge",
    });
  });
});
