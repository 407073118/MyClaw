import type {
  CreateSkillInput,
  PublishSkillReleaseResponse,
  SkillDetail,
  SkillListQuery,
  SkillSummary,
  UpdateSkillInput
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../database/services/database.service";
import type { CreateSkillReleaseInput, SkillsRepository } from "../ports/skills.repository";

@Injectable()
export class PrismaSkillsRepository implements SkillsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async list(query?: SkillListQuery): Promise<SkillSummary[]> {
    const where: Record<string, unknown> = {};

    if (query?.category) {
      where.category = query.category;
    }

    if (query?.keyword) {
      // MySQL 默认 utf8mb4_general_ci 排序规则即为大小写不敏感
      where.OR = [
        { name: { contains: query.keyword } },
        { summary: { contains: query.keyword } },
        { description: { contains: query.keyword } }
      ];
    }

    if (query?.tag) {
      where.tags = { array_contains: [query.tag] };
    }

    // 排序方式
    let orderBy: Record<string, string>;
    switch (query?.sort) {
      case "downloads":
        orderBy = { downloadCount: "desc" };
        break;
      case "name":
        orderBy = { name: "asc" };
        break;
      default:
        orderBy = { updatedAt: "desc" };
        break;
    }

    const skills = await this.databaseService.skill.findMany({
      where,
      orderBy
    });

    return skills.map((skill) => this.mapSummary(skill));
  }

  async findById(id: string): Promise<SkillDetail | null> {
    const skill = await this.databaseService.skill.findUnique({
      where: { id },
      include: {
        releases: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    return skill ? this.mapDetail(skill) : null;
  }

  async createSkill(input: CreateSkillInput): Promise<SkillDetail> {
    const skill = await this.databaseService.skill.create({
      data: {
        id: input.id,
        name: input.name,
        summary: input.summary,
        description: input.description,
        icon: input.icon ?? "",
        category: input.category ?? "other",
        tags: input.tags ?? [],
        author: input.author ?? ""
      },
      include: {
        releases: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    return this.mapDetail(skill);
  }

  async updateSkill(id: string, input: UpdateSkillInput): Promise<SkillDetail | null> {
    const existing = await this.databaseService.skill.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.summary !== undefined) data.summary = input.summary;
    if (input.description !== undefined) data.description = input.description;
    if (input.icon !== undefined) data.icon = input.icon;
    if (input.category !== undefined) data.category = input.category;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.author !== undefined) data.author = input.author;

    const skill = await this.databaseService.skill.update({
      where: { id },
      data,
      include: {
        releases: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    return this.mapDetail(skill);
  }

  async createRelease(input: CreateSkillReleaseInput): Promise<PublishSkillReleaseResponse> {
    await this.databaseService.$transaction(async (transaction) => {
      await transaction.skillRelease.create({
        data: {
          id: input.releaseId,
          skillId: input.skillId,
          version: input.version,
          releaseNotes: input.releaseNotes,
          manifestJson: input.manifest,
          artifactFileName: input.artifact.fileName,
          artifactFileSize: input.artifact.fileSize,
          artifactStoragePath: input.artifact.storagePath,
          artifactDownloadUrl: input.artifact.downloadUrl,
          artifactDownloadExpires: input.artifact.downloadExpiresIn
        }
      });

      await transaction.skill.update({
        where: { id: input.skillId },
        data: {
          latestVersion: input.version,
          latestReleaseId: input.releaseId
        }
      });
    });

    return {
      skillId: input.skillId,
      releaseId: input.releaseId,
      version: input.version,
      releaseNotes: input.releaseNotes,
      manifest: input.manifest,
      artifact: {
        fileName: input.artifact.fileName,
        fileSize: input.artifact.fileSize,
        downloadUrl: input.artifact.downloadUrl,
        expiresIn: input.artifact.downloadExpiresIn
      }
    };
  }

  private mapSummary(skill: {
    id: string;
    name: string;
    summary: string;
    description: string;
    icon: string;
    category: string;
    tags: unknown;
    author: string;
    downloadCount: number;
    latestVersion: string | null;
    latestReleaseId: string | null;
    updatedAt: Date;
  }): SkillSummary {
    // tags 在数据库中存储为 JSON，需要解析为字符串数组
    const tags = Array.isArray(skill.tags) ? (skill.tags as string[]) : [];

    return {
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      description: skill.description,
      icon: skill.icon,
      category: skill.category as SkillSummary["category"],
      tags,
      author: skill.author,
      downloadCount: skill.downloadCount,
      latestVersion: skill.latestVersion,
      latestReleaseId: skill.latestReleaseId,
      updatedAt: skill.updatedAt.toISOString()
    };
  }

  private mapDetail(skill: {
    id: string;
    name: string;
    summary: string;
    description: string;
    icon: string;
    category: string;
    tags: unknown;
    author: string;
    downloadCount: number;
    latestVersion: string | null;
    latestReleaseId: string | null;
    createdAt: Date;
    updatedAt: Date;
    releases: Array<{
      id: string;
      version: string;
      releaseNotes: string;
      manifestJson: unknown;
      createdAt: Date;
    }>;
  }): SkillDetail {
    // 从最新 release 的 manifestJson 中提取 readme
    let readme = "";
    if (skill.releases.length > 0) {
      const latestManifest = skill.releases[0].manifestJson;
      if (latestManifest && typeof latestManifest === "object" && "readme" in latestManifest) {
        readme = (latestManifest as { readme: string }).readme ?? "";
      }
    }

    return {
      ...this.mapSummary(skill),
      readme,
      createdAt: skill.createdAt.toISOString(),
      releases: skill.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes,
        createdAt: release.createdAt.toISOString()
      }))
    };
  }
}
