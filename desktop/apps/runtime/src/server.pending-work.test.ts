import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

describe("runtime server pending work", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-pending-work-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates memory and pending work records from an employee workflow run", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const employeeResponse = await fetch(`${app.baseUrl}/api/employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Onboarding Assistant",
        description: "Guides setup and follow-up tasks.",
      }),
    });
    const employeePayload = await employeeResponse.json();

    const workflowResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Onboarding Workflow",
        description: "Covers setup and completion checks.",
      }),
    });
    const workflowPayload = await workflowResponse.json();

    const runResponse = await fetch(
      `${app.baseUrl}/api/employees/${employeePayload.employee.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowId: workflowPayload.workflow.id,
          summary: "The assistant completed kickoff and needs a document follow-up.",
          memory: {
            kind: "episodic-summary",
            subject: "Kickoff summary",
            content: "The workspace startup steps were confirmed.",
          },
          pendingWork: {
            title: "Check for returned onboarding documents",
            dueAt: "2026-03-24T00:00:00.000Z",
            expiresAt: "2026-03-26T00:00:00.000Z",
            maxAttempts: 3,
            resumePolicy: {
              kind: "time",
              value: "2026-03-24T00:00:00.000Z",
            },
          },
        }),
      },
    );
    const runPayload = await runResponse.json();

    expect(runResponse.status).toBe(201);
    expect(runPayload.run.employeeId).toBe(employeePayload.employee.id);
    expect(runPayload.memoryRecord.kind).toBe("episodic-summary");
    expect(runPayload.pendingWork.status).toBe("waiting");

    const pendingListResponse = await fetch(`${app.baseUrl}/api/pending-work`);
    const pendingListPayload = await pendingListResponse.json();

    expect(pendingListResponse.status).toBe(200);
    expect(pendingListPayload.items).toHaveLength(1);
    expect(pendingListPayload.items[0].title).toContain("documents");
  });

  it("runs heartbeat over pending work and updates item states", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const employeeResponse = await fetch(`${app.baseUrl}/api/employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Follow-up Assistant",
        description: "Rechecks pending onboarding tasks.",
      }),
    });
    const employeePayload = await employeeResponse.json();

    const workflowResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Follow-up Workflow",
        description: "Tracks incomplete onboarding tasks.",
      }),
    });
    const workflowPayload = await workflowResponse.json();

    await fetch(`${app.baseUrl}/api/employees/${employeePayload.employee.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: workflowPayload.workflow.id,
        summary: "Waiting for a response.",
        pendingWork: {
          title: "Ready soon",
          dueAt: "2026-03-24T00:00:00.000Z",
          expiresAt: "2026-03-26T00:00:00.000Z",
          maxAttempts: 3,
          resumePolicy: {
            kind: "time",
            value: "2026-03-24T00:00:00.000Z",
          },
        },
      }),
    });

    await fetch(`${app.baseUrl}/api/employees/${employeePayload.employee.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: workflowPayload.workflow.id,
        summary: "This one should expire.",
        pendingWork: {
          title: "Too late",
          dueAt: "2026-03-20T00:00:00.000Z",
          expiresAt: "2026-03-21T00:00:00.000Z",
          maxAttempts: 1,
          resumePolicy: {
            kind: "time",
            value: "2026-03-20T00:00:00.000Z",
          },
        },
      }),
    });

    const heartbeatResponse = await fetch(`${app.baseUrl}/api/pending-work/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        now: "2026-03-24T12:00:00.000Z",
      }),
    });
    const heartbeatPayload = await heartbeatResponse.json();

    expect(heartbeatResponse.status).toBe(200);
    expect(heartbeatPayload.readyIds).toHaveLength(1);
    expect(heartbeatPayload.expiredIds).toHaveLength(1);

    const pendingListResponse = await fetch(`${app.baseUrl}/api/pending-work`);
    const pendingListPayload = await pendingListResponse.json();

    expect(pendingListPayload.items.some((item: { status: string; title: string }) => item.title === "Ready soon" && item.status === "ready")).toBe(true);
    expect(pendingListPayload.items.some((item: { status: string; title: string }) => item.title === "Too late" && item.status === "expired")).toBe(true);
  });
});
