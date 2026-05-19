import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CloudProjectBinding } from "../shared/contracts";
import type { MyClawPaths } from "../src/main/services/directory-service";
import { ProjectCapabilityDatabase } from "../src/main/services/project-capability-database";
import { ProjectCapabilityService } from "../src/main/services/project-capability-service";

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

/** 构造服务测试项目。 */
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

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "myclaw-project-capability-service-"));
  paths = createTestPaths(tempRoot);
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("project capability service", () => {
  it("lists local projects from DB", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    db.upsertProject(createProject());
    const service = new ProjectCapabilityService(db);

    expect(service.listProjects()[0]?.name).toBe("客服平台");
    db.close();
  });

  it("binds a session to a project", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    db.upsertProject(createProject());
    const service = new ProjectCapabilityService(db);

    service.bindSessionProject("session-1", "local-project-1");

    expect(service.getSessionProjectBinding("session-1")).toBe("local-project-1");
    db.close();
  });

  it("refuses binding a revoked or deleted project", async () => {
    const db = await ProjectCapabilityDatabase.create(paths);
    db.upsertProject(createProject({ revokedAt: "2026-05-18T01:00:00.000Z" }));
    const service = new ProjectCapabilityService(db);

    expect(() => service.bindSessionProject("session-1", "local-project-1")).toThrow("project_binding_unavailable");
    db.close();
  });
});
