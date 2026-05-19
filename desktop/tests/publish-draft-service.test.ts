import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createLocalPublishDraft } from "../src/main/services/publish-draft-service";

describe("publish draft service", () => {
  it("creates a real workflow draft artifact instead of returning a fake success", async () => {
    const root = await mkdtemp(join(tmpdir(), "myclaw-publish-draft-"));
    try {
      const result = await createLocalPublishDraft(
        {
          kind: "workflow-package",
          sourceId: "workflow-1",
          version: "1.2.3",
        },
        {
          artifactsDir: root,
          siliconPersons: [],
          workflows: [],
          workflowDefinitions: {
            "workflow-1": {
              id: "workflow-1",
              name: "Onboarding Flow",
              description: "Test workflow",
              status: "draft",
              source: "personal",
              updatedAt: "2026-05-19T00:00:00.000Z",
              version: 1,
              nodeCount: 0,
              edgeCount: 0,
              libraryRootId: "",
              entryNodeId: "",
              nodes: [],
              edges: [],
              stateSchema: [],
            },
          },
        },
      );

      expect(result.draft.filePath).toContain("publish-drafts");
      expect(existsSync(result.draft.filePath)).toBe(true);
      expect(result.draft.manifest).toMatchObject({
        kind: "workflow",
        name: "Onboarding Flow",
        version: "1.2.3",
      });

      const artifact = JSON.parse(await readFile(result.draft.filePath, "utf8"));
      expect(artifact.draft.id).toBe(result.draft.id);
      expect(artifact.sourceSnapshot.id).toBe("workflow-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails instead of pretending success when the publish source is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "myclaw-publish-draft-"));
    try {
      await expect(createLocalPublishDraft(
        {
          kind: "employee-package",
          sourceId: "missing-employee",
          version: "1.0.0",
        },
        {
          artifactsDir: root,
          siliconPersons: [],
          workflows: [],
          workflowDefinitions: {},
        },
      )).rejects.toThrow("未找到可发布来源");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
