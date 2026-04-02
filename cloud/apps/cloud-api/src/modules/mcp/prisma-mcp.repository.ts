import type {
  McpItemDetail,
  McpItemSummary,
  McpReleaseDetail,
  McpServerConfig
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import type { CreateMcpItemRecordInput, CreateMcpReleaseRecordInput, McpRepository } from "./mcp.repository";

@Injectable()
export class PrismaMcpRepository implements McpRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /** 获取所有 MCP 条目列表 */
  async list(): Promise<McpItemSummary[]> {
    const items = await this.databaseService.mcpServer.findMany({
      orderBy: { updatedAt: "desc" }
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary,
      latestVersion: item.latestVersion ?? ""
    }));
  }

  /** 根据 ID 查找 MCP 条目详情 */
  async findById(id: string): Promise<McpItemDetail | null> {
    const item = await this.databaseService.mcpServer.findUnique({
      where: { id },
      include: {
        releases: { orderBy: { createdAt: "desc" } }
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
      latestVersion: item.latestVersion ?? "",
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes
      }))
    };
  }

  /** 创建 MCP 条目 */
  async createItem(input: CreateMcpItemRecordInput): Promise<McpItemDetail> {
    const item = await this.databaseService.mcpServer.create({
      data: {
        id: input.id,
        name: input.name,
        summary: input.summary,
        description: input.description,
        latestVersion: input.latestVersion
      },
      include: {
        releases: { orderBy: { createdAt: "desc" } }
      }
    });

    return {
      id: item.id,
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

  /** 创建 MCP 版本，同时更新条目的最新版本号 */
  async createRelease(input: CreateMcpReleaseRecordInput): Promise<McpReleaseDetail> {
    const item = await this.databaseService.mcpServer.findUnique({
      where: { id: input.itemId }
    });

    if (!item) {
      throw new Error(`mcp_item_not_found:${input.itemId}`);
    }

    const release = await this.databaseService.$transaction(async (tx) => {
      const created = await tx.mcpServerRelease.create({
        data: {
          id: input.releaseId,
          serverId: input.itemId,
          version: input.version,
          releaseNotes: input.releaseNotes,
          configJson: input.config as object
        }
      });

      await tx.mcpServer.update({
        where: { id: input.itemId },
        data: {
          latestVersion: input.latestVersion,
          latestReleaseId: input.releaseId
        }
      });

      return created;
    });

    return {
      id: release.id,
      version: release.version,
      releaseNotes: release.releaseNotes,
      config: release.configJson as McpServerConfig
    };
  }

  /** 根据版本 ID 获取版本详情 */
  async findReleaseById(releaseId: string): Promise<McpReleaseDetail | null> {
    const release = await this.databaseService.mcpServerRelease.findUnique({
      where: { id: releaseId }
    });

    if (!release) {
      return null;
    }

    return {
      id: release.id,
      version: release.version,
      releaseNotes: release.releaseNotes,
      config: release.configJson as McpServerConfig
    };
  }
}
