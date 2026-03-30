import type {
  McpItemDetail,
  McpItemSummary,
  McpReleaseUploadResponse
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import type { CreateMcpItemRecordInput, CreateMcpReleaseInput, McpRepository } from "./mcp.repository";

@Injectable()
export class PrismaMcpRepository implements McpRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async list(): Promise<McpItemSummary[]> {
    const items = await this.databaseService.mcpItem.findMany({
      orderBy: {
        updatedAt: "desc"
      }
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary,
      latestVersion: item.latestVersion,
      iconUrl: `/api/mcp/items/${item.id}/icon`
    }));
  }

  async findById(id: string): Promise<McpItemDetail | null> {
    const item = await this.databaseService.mcpItem.findUnique({
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
      return null;
    }

    return {
      id: item.id,
      name: item.name,
      summary: item.summary,
      description: item.description,
      latestVersion: item.latestVersion,
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes
      }))
    };
  }

  async createItem(input: CreateMcpItemRecordInput): Promise<McpItemDetail> {
    const item = await this.databaseService.mcpItem.create({
      data: {
        id: input.id,
        name: input.name,
        summary: input.summary,
        description: input.description,
        latestVersion: input.latestVersion
      },
      include: {
        releases: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    return {
      id: item.id,
      name: item.name,
      summary: item.summary,
      description: item.description,
      latestVersion: item.latestVersion,
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes
      }))
    };
  }

  async createRelease(input: CreateMcpReleaseInput): Promise<McpReleaseUploadResponse> {
    await this.databaseService.$transaction(async (transaction) => {
      await transaction.mcpRelease.create({
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
          artifactDownloadExpires: input.artifact.downloadExpiresIn
        }
      });

      await transaction.mcpItem.update({
        where: { id: input.itemId },
        data: {
          latestVersion: input.latestVersion
        }
      });
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
        expiresIn: input.artifact.downloadExpiresIn
      }
    };
  }
}
