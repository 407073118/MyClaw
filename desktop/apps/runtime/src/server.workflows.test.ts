import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

describe("runtime server workflows api", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-workflows-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("lists summaries and creates draft workflow definitions", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const listResponse = await fetch(`${app.baseUrl}/api/workflows`);
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.items).toEqual([]);

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Onboarding Workflow",
        description: "Covers setup and completion checks.",
      }),
    });
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createPayload.workflow.name).toBe("Onboarding Workflow");
    expect(createPayload.workflow.status).toBe("draft");
    expect(createPayload.workflow.source).toBe("personal");
    expect(createPayload.workflow.entryNodeId).toBeTruthy();
    expect(createPayload.workflow.nodes).toHaveLength(2);
    expect(createPayload.workflow.edges).toHaveLength(1);
    expect(createPayload.workflow.version).toBe(1);
    expect(createPayload.workflow.nodeCount).toBe(2);
    expect(createPayload.workflow.edgeCount).toBe(1);
    expect(createPayload.workflow.libraryRootId).toBe("personal");

    const workflowId = createPayload.workflow.id as string;

    const secondListResponse = await fetch(`${app.baseUrl}/api/workflows`);
    const secondListPayload = await secondListResponse.json();

    expect(secondListResponse.status).toBe(200);
    expect(secondListPayload.items).toHaveLength(1);
    expect(secondListPayload.items[0].id).toBe(workflowId);
    expect(secondListPayload.items[0].version).toBe(1);
    expect(secondListPayload.items[0].nodeCount).toBe(2);
    expect(secondListPayload.items[0].edgeCount).toBe(1);
    expect(secondListPayload.items[0].libraryRootId).toBe("personal");
    expect(secondListPayload.items[0].nodes).toBeUndefined();
    expect(secondListPayload.items[0].edges).toBeUndefined();
  });
});
