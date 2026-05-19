import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CapabilityBundle, CloudProjectBinding, ProjectCapabilityRef } from "../shared/contracts";
import type { MyClawPaths } from "../src/main/services/directory-service";
import { ProjectCapabilityDatabase } from "../src/main/services/project-capability-database";

let tempRoot = "";
let paths: MyClawPaths;

/** 构造测试用路径对象，避免触碰真实用户数据目录。 */
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

/** 构造本地项目绑定记录。 */
function createProject(overrides: Partial<CloudProjectBinding> = {}): CloudProjectBinding {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    id: "local-project-1",
    cloudProjectId: "1",
    tenantId: "default",
    accountId: "local",
    code: "customer-service",
    name: "客服平台",
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
    ...overrides,
  };
}

/** 构造项目能力引用记录。 */
function createRef(overrides: Partial<ProjectCapabilityRef> = {}): ProjectCapabilityRef {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    id: "ref-skill-1",
    localProjectId: "local-project-1",
    kind: "skill",
    cloudCapabilityId: "skill-project-qa",
    cloudReleaseId: "release-skill-1",
    alias: null,
    displayName: "项目问答",
    description: null,
    defaultEnabled: true,
    manifestJson: { name: "project-qa" },
    artifactJson: { downloadUrl: "https://example.com/skill.zip", sha256: "", size: 10 },
    artifactHash: null,
    runtimePolicyJson: null,
    cloudConfigJson: null,
    syncStatus: "synced",
    syncWarning: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "myclaw-project-capability-"));
  paths = createTestPaths(tempRoot);
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("project capability database", () => {
  it("creates all project capability tables", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    db.close();

    const SQL = await initSqlJs();
    const sqlite = new SQL.Database(readFileSync(paths.projectCapabilitiesDbFile));
    const rows = sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat() ?? [];
    expect(rows).toEqual(expect.arrayContaining([
      "cloud_projects",
      "project_capability_refs",
      "project_capability_prefs",
      "capability_installations",
      "session_project_bindings",
      "run_capability_snapshots",
    ]));
    sqlite.close();
  });

  it("upserts a bound project", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);

    db.upsertProject(createProject());
    db.upsertProject(createProject({ name: "客服平台 V2", cloudVersion: 2 }));

    expect(db.listProjects()).toHaveLength(1);
    expect(db.getProject("local-project-1")?.name).toBe("客服平台 V2");
    db.close();
  });

  it("upserts refs without overwriting existing prefs", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    db.upsertProject(createProject());
    db.upsertCapabilityRefs("local-project-1", [createRef()]);
    db.setCapabilityLocalState("ref-skill-1", "disabled", "local-test");

    db.upsertCapabilityRefs("local-project-1", [createRef({ displayName: "项目问答 V2" })]);

    const detail = db.getProjectCapabilityView("local-project-1");
    expect(detail.refs[0]?.displayName).toBe("项目问答 V2");
    expect(detail.prefs[0]?.localState).toBe("disabled");
    db.close();
  });

  it("local disabled survives a second sync with Cloud default enabled", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    db.upsertProject(createProject());
    db.upsertCapabilityRefs("local-project-1", [createRef({ defaultEnabled: false })]);
    db.setCapabilityLocalState("ref-skill-1", "disabled");

    db.upsertCapabilityRefs("local-project-1", [createRef({ defaultEnabled: true })]);

    const detail = db.getProjectCapabilityView("local-project-1");
    expect(detail.refs[0]?.defaultEnabled).toBe(true);
    expect(detail.prefs[0]?.localState).toBe("disabled");
    db.close();
  });

  it("stores and reads run_capability_snapshots", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    const bundle: CapabilityBundle = {
      id: "bundle-1",
      hash: "hash-1",
      sessionId: "session-1",
      project: null,
      skills: [],
      mcpTools: [],
      functionNameMap: {},
      createdAt: "2026-05-18T00:00:00.000Z",
    };

    db.saveRunCapabilitySnapshot({
      runId: "run-1",
      sessionId: "session-1",
      localProjectId: null,
      bundleHash: bundle.hash,
      bundleJson: bundle,
    });

    const snapshots = db.listRunCapabilitySnapshots("session-1");
    expect(snapshots[0]?.runId).toBe("run-1");
    expect((snapshots[0]?.bundleJson as CapabilityBundle).hash).toBe("hash-1");
    expect(existsSync(paths.projectCapabilitiesDbFile)).toBe(true);
    db.close();
  });
});
