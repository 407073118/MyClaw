import type {
  CreateSkillInput,
  PublishSkillReleaseResponse,
  SkillDetail,
  SkillSummary
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import type { CreateSkillReleaseInput, SkillsRepository } from "./skills.repository";

@Injectable()
export class PrismaSkillsRepository implements SkillsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async list(): Promise<SkillSummary[]> {
    const skills = await this.databaseService.skill.findMany({
      orderBy: {
        updatedAt: "desc"
      }
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
        description: input.description
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
    latestVersion: string | null;
    latestReleaseId: string | null;
    updatedAt: Date;
  }): SkillSummary {
    return {
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      description: skill.description,
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
    latestVersion: string | null;
    latestReleaseId: string | null;
    createdAt: Date;
    updatedAt: Date;
    releases: Array<{
      id: string;
      version: string;
      releaseNotes: string;
      createdAt: Date;
    }>;
  }): SkillDetail {
    return {
      ...this.mapSummary(skill),
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
