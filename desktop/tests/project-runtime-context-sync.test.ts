import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MyClawPaths } from "../src/main/services/directory-service";
import { ProjectCapabilityDatabase } from "../src/main/services/project-capability-database";
import { ProjectCapabilityService } from "../src/main/services/project-capability-service";
import type { ProjectRuntimeContext } from "../src/main/services/project-runtime-context-client";

let tempRoot = "";
let paths: MyClawPaths;

/** 构造测试路径对象。 */
function createTestPaths(rootDir: string): MyClawPaths {
  const myClawDir = join(rootDir, "myClaw");
  return {
    rootDir,
    myClawDir,
    skillsDir: join(myClawDir, "skills"),
    projectCapabilitiesDir: join(myClawDir, "project-capabilities"),
    projectCapabilitiesDbFile: join(myClawDir, "project-capabilities.db"),
    workspaceDir: join(myClawDir, "workspace"),
    artifactsDir: join(myClawDir, "artifacts"),
    cacheDir: join(myClawDir, "cache"),
    sessionsDir: join(myClawDir, "sessions"),
    sessionsDbFile: join(myClawDir, "sessions.db"),
    timeDbFile: join(myClawDir, "time.db"),
    modelsDir: join(myClawDir, "models"),
    settingsFile: join(myClawDir, "settings.json"),
  };
}

/** 构造 Cloud runtime-context 响应。 */
function context(overrides: Partial<ProjectRuntimeContext> = {}): ProjectRuntimeContext {
  return {
    project: {
      id: 1,
      code: "customer-service",
      tenantId: "default",
      name: "客服平台",
      description: null,
      version: 1,
      etag: "etag-1",
      policyEpoch: 1,
      expiresAt: null,
      revokedAt: null,
      deletedAt: null,
    },
    skills: [
      {
        id: "skill-project-qa",
        releaseId: "release-skill-1",
        alias: null,
        displayName: "项目问答",
        description: null,
        defaultEnabled: true,
        manifest: { name: "project-qa" },
        artifact: { downloadUrl: "https://example.com/skill.zip", sha256: "hash-1", size: 1 },
        config: null,
      },
    ],
    mcps: [
      {
        id: "mcp-project-gateway",
        releaseId: "release-mcp-1",
        alias: null,
        displayName: "项目网关",
        description: null,
        defaultEnabled: true,
        transport: "stdio",
        manifest: {},
        artifact: null,
        config: null,
        runtimePolicy: {
          requiresLocalConfirmation: true,
          allowAutoExposeToModel: false,
          riskLevel: "high",
        },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "myclaw-project-runtime-sync-"));
  paths = createTestPaths(tempRoot);
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("project runtime context sync", () => {
  it("binding a Cloud project stores cloud_projects, refs, and inherit prefs", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    const service = new ProjectCapabilityService(db);

    const detail = service.syncRuntimeContext(context(), { accountId: "jianing" });

    expect(detail.project.cloudProjectId).toBe("1");
    expect(detail.refs).toHaveLength(2);
    expect(detail.prefs.every((pref) => pref.localState === "inherit")).toBe(true);
    db.close();
  });

  it("a second sync updates refs but preserves local disabled prefs", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    const service = new ProjectCapabilityService(db);
    const first = service.syncRuntimeContext(context(), { accountId: "jianing" });
    const skillRef = first.refs.find((ref) => ref.kind === "skill")!;
    service.setCapabilityLocalState(skillRef.id, "disabled");

    const second = service.syncRuntimeContext(context({
      project: { ...context().project, version: 2, etag: "etag-2" },
      skills: [{ ...context().skills[0]!, displayName: "项目问答 V2", defaultEnabled: true }],
    }), { accountId: "jianing" });

    expect(second.refs.find((ref) => ref.kind === "skill")?.displayName).toBe("项目问答 V2");
    expect(second.prefs.find((pref) => pref.capabilityRefId === skillRef.id)?.localState).toBe("disabled");
    db.close();
  });

  it("revoked or deleted context marks local project unavailable", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    const service = new ProjectCapabilityService(db);

    const detail = service.syncRuntimeContext(context({
      project: {
        ...context().project,
        revokedAt: "2026-05-18T01:00:00.000Z",
      },
    }), { accountId: "jianing" });

    expect(detail.project.lastSyncStatus).toBe("revoked");
    expect(() => service.bindSessionProject("session-1", detail.project.id)).toThrow("project_binding_unavailable");
    db.close();
  });
});
