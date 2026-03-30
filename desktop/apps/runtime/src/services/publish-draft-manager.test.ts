import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LocalEmployeeSummary, WorkflowDefinitionSummary } from "@myclaw-desktop/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPublishDraft } from "./publish-draft-manager";

describe("publish draft manager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-publish-draft-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates an employee package draft without memory or pending work state", async () => {
    const employee: LocalEmployeeSummary = {
      id: "employee-onboarding",
      name: "Onboarding Assistant",
      description: "Guides setup and follow-up tasks.",
      status: "active",
      source: "personal",
      workflowIds: ["workflow-onboarding"],
      updatedAt: "2026-03-24T08:00:00.000Z",
    };
    const workflows: WorkflowDefinitionSummary[] = [
      {
        id: "workflow-onboarding",
        name: "Onboarding Workflow",
        description: "Covers setup and completion checks.",
        status: "active",
        source: "personal",
        updatedAt: "2026-03-24T08:00:00.000Z",
      },
    ];

    const draft = await createPublishDraft({
      outputDir: tempDir,
      kind: "employee-package",
      version: "1.0.0",
      employee,
      workflows,
      now: "2026-03-24T09:00:00.000Z",
    });

    const fileContents = readFileSync(draft.filePath, "utf8");

    expect(draft.kind).toBe("employee-package");
    expect(draft.manifest.kind).toBe("employee-package");
    if (draft.manifest.kind !== "employee-package") {
      throw new Error("Expected employee package manifest");
    }
    expect(draft.manifest.defaultWorkflowIds).toEqual(["workflow-onboarding"]);
    expect(fileContents).toContain("\"kind\": \"employee-package\"");
    expect(fileContents).not.toContain("memoryRecords");
    expect(fileContents).not.toContain("pendingWorkItems");
    expect(fileContents).not.toContain("runHistory");
  });
});
