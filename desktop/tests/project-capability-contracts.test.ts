import { describe, expect, it } from "vitest";

import type {
  CapabilityBundle,
  ProjectCapabilityKind,
  ProjectCapabilityLocalState,
} from "../shared/contracts";

describe("project capability contracts", () => {
  it("ProjectCapabilityLocalState only accepts local override states", () => {
    const states: ProjectCapabilityLocalState[] = ["inherit", "enabled", "disabled", "hidden"];
    expect(states).toEqual(["inherit", "enabled", "disabled", "hidden"]);
  });

  it("ProjectCapabilityKind only accepts Skill and MCP", () => {
    const kinds: ProjectCapabilityKind[] = ["skill", "mcp"];
    expect(kinds).toEqual(["skill", "mcp"]);
  });

  it("CapabilityBundle functionNameMap can distinguish project and global Skills", () => {
    const bundle: CapabilityBundle = {
      id: "bundle-1",
      hash: "hash-1",
      sessionId: "session-1",
      project: null,
      skills: [],
      mcpTools: [],
      functionNameMap: {
        skill_invoke__project_review: {
          source: "project",
          kind: "skill",
          id: "review",
          localProjectId: "project-local-1",
          capabilityRefId: "ref-1",
        },
        skill_invoke__global_review: {
          source: "global",
          kind: "skill",
          id: "review",
        },
      },
      createdAt: "2026-05-18T00:00:00.000Z",
    };

    expect(bundle.functionNameMap.skill_invoke__project_review.source).toBe("project");
    expect(bundle.functionNameMap.skill_invoke__global_review.source).toBe("global");
  });
});
