import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import JSZip from "jszip";
import type { CapabilityInstallation, CloudProjectBinding, ProjectCapabilityRef } from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import { ProjectCapabilityDatabase } from "./project-capability-database";

type ProjectSkillArtifact = {
  downloadUrl: string;
  sha256: string;
  size?: number;
};

/** 判断 target 是否仍位于 base 目录下，避免 zip-slip 和缓存越界写入。 */
function isInside(base: string, target: string): boolean {
  const normalizedBase = resolve(base).toLowerCase();
  const normalizedTarget = resolve(target).toLowerCase();
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${/^[a-z]:/i.test(normalizedBase) ? "\\" : "/"}`);
}

/** 计算 Buffer 的 sha256。 */
function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 解析项目 Skill 的 artifact 元数据。 */
function parseArtifact(ref: ProjectCapabilityRef): ProjectSkillArtifact {
  const artifact = ref.artifactJson;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("project_skill_artifact_missing");
  }
  const downloadUrl = String((artifact as { downloadUrl?: unknown }).downloadUrl ?? "");
  if (!downloadUrl) {
    throw new Error("project_skill_download_url_missing");
  }
  const artifactHash = typeof (artifact as { sha256?: unknown }).sha256 === "string"
    ? (artifact as { sha256: string }).sha256.trim()
    : "";
  if (!artifactHash) {
    console.warn("[project-skill-installer] 项目 Skill 工件缺少 sha256，拒绝安装", { capabilityRefId: ref.id });
    throw new Error("project_skill_artifact_hash_required");
  }
  return {
    downloadUrl,
    sha256: artifactHash,
    size: typeof (artifact as { size?: unknown }).size === "number"
      ? (artifact as { size: number }).size
      : undefined,
  };
}

/** 项目 Skill 安装器：把项目能力安装到项目缓存目录，不污染全局 skills。 */
export class ProjectSkillInstaller {
  constructor(
    private readonly paths: MyClawPaths,
    private readonly database: ProjectCapabilityDatabase,
  ) {}

  /** 下载、解压并校验项目 Skill，然后写入安装状态。 */
  async installProjectSkill(project: CloudProjectBinding, ref: ProjectCapabilityRef): Promise<CapabilityInstallation> {
    if (ref.kind !== "skill") {
      throw new Error("Project MCP installation is not supported yet");
    }
    const releaseId = ref.cloudReleaseId;
    if (!releaseId) {
      throw new Error("project_skill_release_missing");
    }
    const destination = this.resolveInstallDir(project, ref);
    const startedAt = new Date().toISOString();
    console.info("[project-skill-installer] 开始安装项目 Skill", {
      localProjectId: project.id,
      capabilityRefId: ref.id,
      destination,
    });

    try {
      const artifact = parseArtifact(ref);
      const archiveBytes = await this.downloadArtifact(artifact.downloadUrl);
      if (artifact.sha256 !== sha256(archiveBytes)) {
        console.warn("[project-skill-installer] 项目 Skill 工件 sha256 不匹配，拒绝安装", {
          capabilityRefId: ref.id,
          expectedHash: artifact.sha256,
          actualHash: sha256(archiveBytes),
        });
        throw new Error("project_skill_artifact_hash_mismatch");
      }

      await mkdir(this.paths.projectCapabilitiesDir, { recursive: true });
      const workingRoot = await mkdtemp(join(this.paths.projectCapabilitiesDir, ".install-"));
      const extractRoot = join(workingRoot, "extract");
      try {
        await mkdir(extractRoot, { recursive: true });
        await this.extractZip(archiveBytes, extractRoot);
        const source = await this.resolveSkillSource(extractRoot);
        await rm(destination, { recursive: true, force: true });
        await mkdir(destination, { recursive: true });
        await cp(source, destination, { recursive: true, force: true });
      } finally {
        await rm(workingRoot, { recursive: true, force: true });
      }

      const skillMd = await readFile(join(destination, "SKILL.md"));
      const installation: CapabilityInstallation = {
        id: `install-${ref.id}`,
        sourceType: "project_skill",
        localProjectId: project.id,
        capabilityRefId: ref.id,
        installDir: destination,
        manifestHash: sha256(skillMd),
        artifactHash: artifact.sha256,
        installedReleaseId: releaseId,
        installedAt: startedAt,
        verifiedAt: new Date().toISOString(),
        installStatus: "ready",
        lastError: null,
      };
      this.database.upsertInstallation(installation);
      console.info("[project-skill-installer] 项目 Skill 安装完成", {
        capabilityRefId: ref.id,
        installDir: destination,
      });
      return installation;
    } catch (error) {
      const installation: CapabilityInstallation = {
        id: `install-${ref.id}-${randomUUID()}`,
        sourceType: "project_skill",
        localProjectId: project.id,
        capabilityRefId: ref.id,
        installDir: destination,
        manifestHash: null,
        artifactHash: ref.artifactHash,
        installedReleaseId: releaseId,
        installedAt: null,
        verifiedAt: null,
        installStatus: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      };
      this.database.upsertInstallation(installation);
      console.warn("[project-skill-installer] 项目 Skill 安装失败", {
        capabilityRefId: ref.id,
        error: installation.lastError,
      });
      throw error;
    }
  }

  /** 解析项目 Skill 的目标安装目录，并确保位于项目能力缓存根目录内。 */
  resolveInstallDir(project: CloudProjectBinding, ref: ProjectCapabilityRef): string {
    const destination = resolve(
      this.paths.projectCapabilitiesDir,
      project.tenantId,
      project.cloudProjectId,
      "skills",
      ref.cloudCapabilityId,
      ref.cloudReleaseId ?? "unknown-release",
    );
    if (!isInside(this.paths.projectCapabilitiesDir, destination)) {
      throw new Error("project_skill_install_path_out_of_cache");
    }
    return destination;
  }

  /** 下载工件，兼容 http(s) 与 file:// 测试路径。 */
  private async downloadArtifact(downloadUrl: string): Promise<Buffer> {
    console.info("[project-skill-installer] 下载项目 Skill 工件", { downloadUrl });
    if (downloadUrl.startsWith("file://")) {
      return readFile(new URL(downloadUrl));
    }
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`project_skill_download_failed:${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** 使用 JSZip 安全解压 Skill 工件。 */
  private async extractZip(bytes: Buffer, extractRoot: string): Promise<void> {
    const zip = await JSZip.loadAsync(bytes);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const outputPath = resolve(extractRoot, entry.name);
      if (!isInside(extractRoot, outputPath)) {
        console.warn("[project-skill-installer] 拒绝越界 zip 条目", { entryName: entry.name, outputPath });
        throw new Error("project_skill_archive_path_out_of_bounds");
      }
      await mkdir(resolve(outputPath, ".."), { recursive: true });
      await writeFile(outputPath, Buffer.from(await entry.async("uint8array")));
    }
  }

  /** 解析 Skill 根目录，支持 zip 内多一层目录的常见结构。 */
  private async resolveSkillSource(extractRoot: string): Promise<string> {
    if (existsSync(join(extractRoot, "SKILL.md"))) {
      return extractRoot;
    }
    const entries = await readdir(extractRoot, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    if (directories.length === 1) {
      const nested = join(extractRoot, directories[0]!.name);
      if (existsSync(join(nested, "SKILL.md"))) {
        return nested;
      }
    }
    throw new Error("project_skill_manifest_missing");
  }
}
