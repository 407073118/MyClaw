import type {
  HubItemDetail,
  HubManifest,
  HubReleaseUploadResponse,
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../database/services/database.service";
import { HUB_SEED_ITEMS } from "../data/hub-seed-data";
import type { CreateReleaseInput, HubRepository } from "../ports/hub.repository";

@Injectable()
export class PrismaHubRepository implements HubRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /** 查询全部 Hub 条目详情，若数据库为空则回退到种子数据。 */
  async list(): Promise<HubItemDetail[]> {
    const items = await this.databaseService.hubItem.findMany({
      include: {
        releases: {
          orderBy: {
            createdAt: "desc"
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    if (items.length === 0) {
      return HUB_SEED_ITEMS;
    }

    return items.map((item) => ({
      id: item.id,
      type: item.type as HubItemDetail["type"],
      name: item.name,
      summary: item.summary,
      description: item.description,
      latestVersion: item.latestVersion ?? "",
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes
      }))
    }));
  }

  /** 根据 ID 查询 Hub 条目，缺失时尝试回退到种子数据。 */
  async findById(id: string): Promise<HubItemDetail | null> {
    const item = await this.databaseService.hubItem.findUnique({
      where: { id },
      include: {
        releases: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    if (!item) {
      return HUB_SEED_ITEMS.find((seed) => seed.id === id) ?? null;
    }

    return {
      id: item.id,
      type: item.type as HubItemDetail["type"],
      name: item.name,
      summary: item.summary,
      description: item.description,
      latestVersion: item.latestVersion ?? "",
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes
      }))
    };
  }

  /** 创建新的 Hub 条目记录。 */
  async createItem(input: {
    id: string;
    type: HubItemDetail["type"];
    name: string;
    summary: string;
    description: string;
    latestVersion: string;
  }): Promise<HubItemDetail> {
    const item = await this.databaseService.hubItem.create({
      data: {
        id: input.id,
        type: input.type,
        name: input.name,
        summary: input.summary,
        description: input.description,
        latestVersion: input.latestVersion,
      },
      include: {
        releases: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    return {
      id: item.id,
      type: item.type as HubItemDetail["type"],
      name: item.name,
      summary: item.summary,
      description: item.description,
      latestVersion: item.latestVersion ?? "",
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes,
      })),
    };
  }

  /** 创建 Hub Release，并同步持久化 artifact 元数据用于后续按 releaseId 解析工件。 */
  async createRelease<TManifest extends HubManifest>(
    input: CreateReleaseInput<TManifest>,
  ): Promise<HubReleaseUploadResponse<TManifest>> {
    console.info("[hub-repository] 准备写入 HubRelease", {
      itemId: input.itemId,
      releaseId: input.releaseId,
      version: input.version,
      artifactFileName: input.artifact.fileName,
      artifactFileSize: input.artifact.fileSize,
      artifactStoragePath: input.artifact.storagePath,
      artifactDownloadUrl: input.artifact.downloadUrl,
      artifactDownloadExpiresIn: input.artifact.downloadExpiresIn,
    });
    await this.databaseService.$transaction(async (transaction) => {
      await transaction.hubRelease.create({
        data: {
          id: input.releaseId,
          itemId: input.itemId,
          version: input.version,
          releaseNotes: input.releaseNotes,
          manifestJson: input.manifest,
          artifactFileName: input.artifact.fileName,
          artifactFileSize: input.artifact.fileSize,
          artifactStoragePath: input.artifact.storagePath,
          artifactDownloadUrl: input.artifact.downloadUrl,
          artifactDownloadExpires: input.artifact.downloadExpiresIn,
        }
      });

      await transaction.hubItem.update({
        where: { id: input.itemId },
        data: {
          latestVersion: input.latestVersion
        }
      });
    });
    console.info("[hub-repository] HubRelease 写入完成", {
      itemId: input.itemId,
      releaseId: input.releaseId,
    });

    return {
      itemId: input.itemId,
      releaseId: input.releaseId,
      version: input.version,
      latestVersion: input.latestVersion,
      manifest: input.manifest,
      artifact: {
        fileName: input.artifact.fileName,
        fileSize: input.artifact.fileSize,
        downloadUrl: input.artifact.downloadUrl,
        expiresIn: input.artifact.downloadExpiresIn,
      }
    };
  }
}
