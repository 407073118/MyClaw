import { describe, expect, it } from "vitest";

import type {
  CapabilityInstallation,
  CloudProjectBinding,
  ProjectCapabilityDetail,
  ProjectCapabilityPref,
  ProjectCapabilityRef,
  SkillDefinition,
} from "../shared/contracts";
import { CapabilityBundleResolver } from "../src/main/services/capability-bundle-resolver";

/** 构造测试全局 Skill。 */
function skill(id: string, name = id): SkillDefinition {
  return {
    id,
    name,
    description: `${name} description`,
    path: `/skills/${id}`,
    enabled: true,
  } as SkillDefinition;
}

/** 构造测试项目详情。 */
function projectDetail(input?: {
  ref?: Partial<ProjectCapabilityRef>;
  pref?: Partial<ProjectCapabilityPref>;
  installation?: Partial<CapabilityInstallation>;
  mcpRef?: Partial<ProjectCapabilityRef>;
  mcpPref?: Partial<ProjectCapabilityPref>;
}): ProjectCapabilityDetail {
  const now = "2026-05-18T00:00:00.000Z";
  const project: CloudProjectBinding = {
    id: "local-project-1",
    cloudProjectId: "1",
    tenantId: "default",
    accountId: "local",
    code: "crm",
    name: "CRM",
    description: null,
    cloudVersion: 1,
    etag: "etag-1",
    policyEpoch: 1,
    syncedAt: now,
    expiresAt: null,
    revokedAt: null,
    deletedAt: null,
    lastSyncStatus: "synced",
    lastSyncError: null,
    createdAt: now,
    updatedAt: now,
  };
  const ref: ProjectCapabilityRef = {
    id: "ref-skill-1",
    localProjectId: project.id,
    kind: "skill",
    cloudCapabilityId: "review",
    cloudReleaseId: "release-skill-1",
    alias: "review",
    displayName: "review",
    description: "project review",
    defaultEnabled: true,
    manifestJson: {},
    artifactJson: {},
    artifactHash: null,
    runtimePolicyJson: null,
    cloudConfigJson: null,
    syncStatus: "synced",
    syncWarning: null,
    createdAt: now,
    updatedAt: now,
    ...input?.ref,
  };
  const pref: ProjectCapabilityPref = {
    id: "pref-ref-skill-1",
    localProjectId: project.id,
    capabilityRefId: ref.id,
    localState: "inherit",
    reason: null,
    updatedBy: null,
    updatedAt: now,
    ...input?.pref,
  };
  const installation: CapabilityInstallation = {
    id: "install-ref-skill-1",
    sourceType: "project_skill",
    localProjectId: project.id,
    capabilityRefId: ref.id,
    installDir: "/project-cache/review",
    manifestHash: "manifest-hash",
    artifactHash: "artifact-hash",
    installedReleaseId: "release-skill-1",
    installedAt: now,
    verifiedAt: now,
    installStatus: "ready",
    lastError: null,
    ...input?.installation,
  };
  const mcpRef: ProjectCapabilityRef = {
    id: "ref-mcp-1",
    localProjectId: project.id,
    kind: "mcp",
    cloudCapabilityId: "jira",
    cloudReleaseId: "release-mcp-1",
    alias: "jira-search",
    displayName: "Jira Search",
    description: "Jira project search",
    defaultEnabled: true,
    manifestJson: { inputSchema: { type: "object" } },
    artifactJson: null,
    artifactHash: null,
    runtimePolicyJson: { allowAutoExposeToModel: true, riskLevel: "low" },
    cloudConfigJson: null,
    syncStatus: "synced",
    syncWarning: null,
    createdAt: now,
    updatedAt: now,
    ...input?.mcpRef,
  };
  const mcpPref: ProjectCapabilityPref = {
    id: "pref-ref-mcp-1",
    localProjectId: project.id,
    capabilityRefId: mcpRef.id,
    localState: "inherit",
    reason: null,
    updatedBy: null,
    updatedAt: now,
    localPolicyJson: { localConfirmed: false, secretsConfigured: false, allowExposeToModel: false },
    ...input?.mcpPref,
  };
  return {
    project,
    refs: [ref, mcpRef],
    prefs: [pref, mcpPref],
    installations: [installation],
  };
}

/** 构造 resolver 依赖桩。 */
function resolver(detail: ProjectCapabilityDetail | null) {
  return new CapabilityBundleResolver({
    getSessionProjectBinding: () => detail?.project.id ?? null,
    getProjectDetail: () => detail,
  } as never, {
    listToolsForCapability: async () => [{
      name: "search",
      description: "Search project data",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    }],
  } as never);
}

describe("capability bundle resolver", () => {
  it("unbound session returns global enabled Skills only", async () => {
    const bundle = await resolver(null).resolveForSession({
      sessionId: "session-1",
      globalSkills: [skill("global-review"), { ...skill("disabled"), enabled: false }],
      globalMcpTools: [],
    });

    expect(bundle.project).toBeNull();
    expect(bundle.skills).toHaveLength(1);
    expect(Object.keys(bundle.functionNameMap)[0]).toContain("global_review");
    expect(bundle.skills[0]?.installDir).toBe("/skills/global-review");
  });

  it("preserves global MCP legacy function name and runtime fields", async () => {
    const inputSchema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    const bundle = await resolver(null).resolveForSession({
      sessionId: "session-1",
      globalSkills: [],
      globalMcpTools: [{
        id: "mcp__global__search",
        serverId: "global",
        name: "search",
        description: "Global search",
        inputSchema,
      }],
    });

    expect(bundle.functionNameMap["mcp__global__search"]).toMatchObject({
      source: "global",
      kind: "mcp",
      serverId: "global",
      toolName: "search",
      inputSchema,
    });
  });

  it("bound session returns global enabled Skills plus project ready Skills", async () => {
    const bundle = await resolver(projectDetail()).resolveForSession({
      sessionId: "session-1",
      globalSkills: [skill("review", "review")],
      globalMcpTools: [],
    });

    expect(bundle.project?.id).toBe("local-project-1");
    expect(bundle.skills.map((item) => item.source)).toEqual(["global", "project"]);
    expect(bundle.skills.find((item) => item.source === "project")?.installDir).toBe("/project-cache/review");
  });

  it("local disabled project Skill is excluded", async () => {
    const bundle = await resolver(projectDetail({ pref: { localState: "disabled" } })).resolveForSession({
      sessionId: "session-1",
      globalSkills: [],
      globalMcpTools: [],
    });

    expect(bundle.skills).toHaveLength(0);
  });

  it("missing, failed, or revoked installation is excluded", async () => {
    const bundle = await resolver(projectDetail({ installation: { installStatus: "failed" } })).resolveForSession({
      sessionId: "session-1",
      globalSkills: [],
      globalMcpTools: [],
    });

    expect(bundle.skills).toHaveLength(0);
  });

  it("same-name global and project Skills produce distinct function names", async () => {
    const bundle = await resolver(projectDetail()).resolveForSession({
      sessionId: "session-1",
      globalSkills: [skill("review", "review")],
      globalMcpTools: [],
    });

    const functionNames = Object.keys(bundle.functionNameMap);
    expect(new Set(functionNames).size).toBe(functionNames.length);
    expect(functionNames.some((name) => name.includes("project_crm_review"))).toBe(true);
    expect(functionNames.some((name) => name.includes("global_review"))).toBe(true);
  });

  it("functionNameMap points to the exact project install dir", async () => {
    const bundle = await resolver(projectDetail()).resolveForSession({
      sessionId: "session-1",
      globalSkills: [],
      globalMcpTools: [],
    });
    const projectName = Object.keys(bundle.functionNameMap).find((name) => name.includes("project_crm_review"))!;

    expect(bundle.functionNameMap[projectName].installDir).toBe("/project-cache/review");
  });

  it("project MCP is excluded unless locally confirmed and policy allows model exposure", async () => {
    const blocked = await resolver(projectDetail()).resolveForSession({
      sessionId: "session-1",
      globalSkills: [],
      globalMcpTools: [],
    });
    const allowed = await resolver(projectDetail({
      mcpPref: {
        localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true },
      },
    })).resolveForSession({
      sessionId: "session-1",
      globalSkills: [],
      globalMcpTools: [],
    });

    expect(blocked.mcpTools).toHaveLength(0);
    expect(allowed.mcpTools[0]).toMatchObject({
      source: "project",
      serverId: "ref-mcp-1",
      toolName: "search",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    });
  });
});
