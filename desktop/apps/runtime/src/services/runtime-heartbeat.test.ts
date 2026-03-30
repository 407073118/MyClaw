import { describe, expect, it } from "vitest";

import type { PendingWorkItem } from "../store/pending-work-store";
import { runHeartbeat } from "./runtime-heartbeat";

describe("runtime heartbeat", () => {
  it("promotes due waiting work to ready, expires stale work, and leaves running work untouched", () => {
    const input: PendingWorkItem[] = [
      {
        id: "pending-ready",
        employeeId: "employee-a",
        workflowId: "workflow-a",
        title: "Follow up tomorrow",
        status: "waiting",
        dueAt: "2026-03-24T00:00:00.000Z",
        expiresAt: "2026-03-25T00:00:00.000Z",
        attemptCount: 0,
        maxAttempts: 2,
        resumePolicy: { kind: "time", value: "2026-03-24T00:00:00.000Z" },
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
      {
        id: "pending-expired",
        employeeId: "employee-a",
        workflowId: "workflow-a",
        title: "Stale follow up",
        status: "waiting",
        dueAt: "2026-03-20T00:00:00.000Z",
        expiresAt: "2026-03-21T00:00:00.000Z",
        attemptCount: 1,
        maxAttempts: 2,
        resumePolicy: { kind: "time", value: "2026-03-20T00:00:00.000Z" },
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      {
        id: "pending-running",
        employeeId: "employee-a",
        workflowId: "workflow-a",
        title: "Already running",
        status: "running",
        dueAt: "2026-03-20T00:00:00.000Z",
        expiresAt: "2026-03-25T00:00:00.000Z",
        attemptCount: 0,
        maxAttempts: 2,
        resumePolicy: { kind: "heartbeat" },
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
    ];

    const result = runHeartbeat({
      items: input,
      now: "2026-03-24T12:00:00.000Z",
    });

    expect(result.readyIds).toEqual(["pending-ready"]);
    expect(result.expiredIds).toEqual(["pending-expired"]);
    expect(result.items.find((item) => item.id === "pending-ready")?.status).toBe("ready");
    expect(result.items.find((item) => item.id === "pending-expired")?.status).toBe("expired");
    expect(result.items.find((item) => item.id === "pending-running")?.status).toBe("running");
  });
});
