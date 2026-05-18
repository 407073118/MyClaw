import { describe, expect, it } from "vitest";

import { LocalSessionLockService } from "../../src/modules/delivery/local-session-lock.service";

describe("LocalSessionLockService", () => {
  it("allows one running delivery per local session", () => {
    const lock = new LocalSessionLockService();

    expect(lock.acquire("session-1", "delivery-1")).toEqual({ acquired: true });
    expect(lock.acquire("session-1", "delivery-2")).toEqual({ acquired: false, position: 1 });
  });

  it("promotes queued delivery after release", () => {
    const lock = new LocalSessionLockService();
    lock.acquire("session-1", "delivery-1");
    lock.acquire("session-1", "delivery-2");

    expect(lock.release("session-1", "delivery-1")).toEqual({ nextDeliveryId: "delivery-2" });
    expect(lock.isRunning("session-1", "delivery-2")).toBe(true);
  });
});
