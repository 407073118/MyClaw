import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

describe("runtime server employees api", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-employees-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("lists, creates, reads, and updates local employees", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const listResponse = await fetch(`${app.baseUrl}/api/employees`);
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.items).toEqual([]);

    const createResponse = await fetch(`${app.baseUrl}/api/employees`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Onboarding Assistant",
        description: "Guides local startup and follow-up tasks.",
      }),
    });
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createPayload.employee.name).toBe("Onboarding Assistant");
    expect(createPayload.employee.status).toBe("draft");
    expect(createPayload.employee.source).toBe("personal");
    expect(createPayload.employee.workflowIds).toEqual([]);

    const employeeId = createPayload.employee.id as string;

    const detailResponse = await fetch(`${app.baseUrl}/api/employees/${employeeId}`);
    const detailPayload = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.employee.id).toBe(employeeId);

    const updateResponse = await fetch(`${app.baseUrl}/api/employees/${employeeId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "active",
        workflowIds: ["workflow-onboarding"],
      }),
    });
    const updatePayload = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updatePayload.employee.status).toBe("active");
    expect(updatePayload.employee.workflowIds).toEqual(["workflow-onboarding"]);

    const secondListResponse = await fetch(`${app.baseUrl}/api/employees`);
    const secondListPayload = await secondListResponse.json();

    expect(secondListResponse.status).toBe(200);
    expect(secondListPayload.items).toHaveLength(1);
    expect(secondListPayload.items[0].id).toBe(employeeId);
  });
});
