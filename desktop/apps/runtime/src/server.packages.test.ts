import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveRuntimeLayout } from "./services/runtime-layout";
import { createRuntimeApp } from "./server";

describe("runtime server package install and publish draft", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-packages-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("installs a hub employee package into local employee state and package storage", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/employee-packages/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: "hub-employee-onboarding",
        releaseId: "release-employee-onboarding-1-0-0",
        name: "Onboarding Assistant",
        summary: "Guides setup and follow-up tasks.",
        downloadUrl: "https://example.com/onboarding-assistant.zip",
        manifest: {
          kind: "employee-package",
          name: "onboarding-assistant",
          version: "1.0.0",
          description: "Guides setup and follow-up tasks.",
          role: "Onboarding coordinator",
          defaultWorkflowIds: ["workflow-onboarding"],
        },
      }),
    });
    const payload = await response.json();
    const layout = resolveRuntimeLayout(stateFilePath);

    expect(response.status).toBe(201);
    expect(payload.employee.source).toBe("hub");
    expect(payload.employee.workflowIds).toEqual(["workflow-onboarding"]);
    expect(payload.items).toHaveLength(1);
    expect(existsSync(payload.packageRecord.filePath)).toBe(true);
    expect(payload.packageRecord.filePath.startsWith(layout.employeePackagesDir)).toBe(true);
  });

  it("installs a hub workflow package into the local workflow library", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/workflow-packages/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: "hub-workflow-onboarding",
        releaseId: "release-workflow-onboarding-1-0-0",
        name: "Onboarding Workflow",
        summary: "Covers setup and completion checks.",
        downloadUrl: "https://example.com/onboarding-workflow.zip",
        manifest: {
          kind: "workflow-package",
          name: "onboarding-workflow",
          version: "1.0.0",
          description: "Covers setup and completion checks.",
          entryWorkflowId: "workflow-onboarding",
        },
      }),
    });
    const payload = await response.json();
    const layout = resolveRuntimeLayout(stateFilePath);

    expect(response.status).toBe(201);
    expect(payload.workflow.source).toBe("hub");
    expect(payload.items).toHaveLength(1);
    expect(existsSync(payload.packageRecord.filePath)).toBe(true);
    expect(payload.packageRecord.filePath.startsWith(layout.workflowsDir)).toBe(true);
  });

  it("creates a publish draft from a local employee without exporting memory or pending work data", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const employeeResponse = await fetch(`${app.baseUrl}/api/employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Research Assistant",
        description: "Tracks recurring checks and summaries.",
      }),
    });
    const employeePayload = await employeeResponse.json();

    const workflowResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Weekly Review",
        description: "Runs weekly backlog and status checks.",
      }),
    });
    const workflowPayload = await workflowResponse.json();

    await fetch(`${app.baseUrl}/api/employees/${employeePayload.employee.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowIds: [workflowPayload.workflow.id],
        status: "active",
      }),
    });

    await fetch(`${app.baseUrl}/api/employees/${employeePayload.employee.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: workflowPayload.workflow.id,
        summary: "Created memory and pending work before packaging.",
        memory: {
          kind: "episodic-summary",
          subject: "Run summary",
          content: "Should not leak into package draft.",
        },
        pendingWork: {
          title: "Follow up later",
          dueAt: "2026-03-25T00:00:00.000Z",
          expiresAt: "2026-03-30T00:00:00.000Z",
          maxAttempts: 2,
          resumePolicy: {
            kind: "time",
            value: "2026-03-25T00:00:00.000Z",
          },
        },
      }),
    });

    const publishResponse = await fetch(`${app.baseUrl}/api/publish-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "employee-package",
        sourceId: employeePayload.employee.id,
        version: "1.2.0",
      }),
    });
    const publishPayload = await publishResponse.json();
    const fileContents = readFileSync(publishPayload.draft.filePath, "utf8");

    expect(publishResponse.status).toBe(201);
    expect(publishPayload.draft.manifest.kind).toBe("employee-package");
    expect(fileContents).not.toContain("Should not leak into package draft");
    expect(fileContents).not.toContain("Follow up later");
    expect(fileContents).not.toContain("pendingWorkItems");
  });
});
