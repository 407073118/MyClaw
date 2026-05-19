import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CloudProjectBinding, ProjectCapabilityRef } from "../shared/contracts";
import type { MyClawPaths } from "../src/main/services/directory-service";
import { ProjectCapabilityDatabase } from "../src/main/services/project-capability-database";
import { ProjectSkillInstaller } from "../src/main/services/project-skill-installer";

let tempRoot = "";
let paths: MyClawPaths;

/** 构造测试路径。 */
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

/** 构造测试项目。 */
function createProject(): CloudProjectBinding {
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
  };
}

/** 构造测试能力引用。 */
function createRef(archiveUrl: string, hash = ""): ProjectCapabilityRef {
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
    manifestJson: {},
    artifactJson: { downloadUrl: archiveUrl, sha256: hash, size: 1 },
    artifactHash: hash || null,
    runtimePolicyJson: null,
    cloudConfigJson: null,
    syncStatus: "synced",
    syncWarning: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 构造包含或不包含 SKILL.md 的 zip 工件。 */
async function createSkillArchive(hasSkillMd = true): Promise<{ path: string; hash: string }> {
  const zip = new JSZip();
  if (hasSkillMd) {
    zip.file("skill/SKILL.md", "# 项目问答\n");
  } else {
    zip.file("skill/README.md", "missing skill");
  }
  const bytes = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const archivePath = join(tempRoot, hasSkillMd ? "skill.zip" : "bad-skill.zip");
  await writeFile(archivePath, bytes);
  return {
    path: archivePath,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "myclaw-project-skill-installer-"));
  paths = createTestPaths(tempRoot);
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("project skill installer", () => {
  it("downloads and extracts a Skill into projectCapabilitiesDir", async () => {
    const archive = await createSkillArchive();
    const db = await ProjectCapabilityDatabase.create(paths);
    const installer = new ProjectSkillInstaller(paths, db);

    const installation = await installer.installProjectSkill(createProject(), createRef(pathToFileURL(archive.path).href, archive.hash));

    expect(installation.installStatus).toBe("ready");
    expect(installation.installDir?.startsWith(paths.projectCapabilitiesDir)).toBe(true);
    expect(existsSync(join(installation.installDir!, "SKILL.md"))).toBe(true);
    expect(installation.installDir?.startsWith(paths.skillsDir)).toBe(false);
    db.close();
  });

  it("rejects archives without SKILL.md and records failed status", async () => {
    const archive = await createSkillArchive(false);
    const db = await ProjectCapabilityDatabase.create(paths);
    const installer = new ProjectSkillInstaller(paths, db);
    const ref = createRef(pathToFileURL(archive.path).href, archive.hash);

    await expect(installer.installProjectSkill(createProject(), ref)).rejects.toThrow("project_skill_manifest_missing");
    expect(db.getInstallationByRefId(ref.id)?.installStatus).toBe("failed");
    db.close();
  });

  it("verifies artifact hash when provided", async () => {
    const archive = await createSkillArchive();
    const db = await ProjectCapabilityDatabase.create(paths);
    const installer = new ProjectSkillInstaller(paths, db);

    await expect(
      installer.installProjectSkill(createProject(), createRef(pathToFileURL(archive.path).href, "bad-hash")),
    ).rejects.toThrow("project_skill_artifact_hash_mismatch");
    db.close();
  });

  it("rejects artifacts without sha256 and records failed status", async () => {
    const archive = await createSkillArchive();
    const db = await ProjectCapabilityDatabase.create(paths);
    const installer = new ProjectSkillInstaller(paths, db);
    const ref = createRef(pathToFileURL(archive.path).href);

    await expect(installer.installProjectSkill(createProject(), ref)).rejects.toThrow("project_skill_artifact_hash_required");
    expect(db.getInstallationByRefId(ref.id)?.installStatus).toBe("failed");
    db.close();
  });

  it("stores ready installation metadata", async () => {
    const archive = await createSkillArchive();
    const db = await ProjectCapabilityDatabase.create(paths);
    const installer = new ProjectSkillInstaller(paths, db);
    const ref = createRef(pathToFileURL(archive.path).href, archive.hash);

    await installer.installProjectSkill(createProject(), ref);

    const persisted = db.getInstallationByRefId(ref.id);
    expect(persisted?.installStatus).toBe("ready");
    expect(await readFile(join(persisted!.installDir!, "SKILL.md"), "utf8")).toContain("项目问答");
    db.close();
  });
});
