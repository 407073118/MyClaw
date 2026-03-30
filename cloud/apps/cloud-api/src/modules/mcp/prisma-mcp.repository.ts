import type {
  HubManifest,
  McpItemDetail,
  McpItemSummary,
  McpReleaseDetail,
  McpServerConfig
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import { HUB_SEED_ITEMS } from "../hub/hub-seed-data";
import type { CreateMcpItemRecordInput, CreateMcpReleaseRecordInput, McpRepository } from "./mcp.repository";

@Injectable()
export class PrismaMcpRepository implements McpRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /** 获取所有 MCP 条目列表 */
  async list(): Promise<McpItemSummary[]> {
    const items = await this.databaseService.hubItem.findMany({
      where: { type: "mcp" },
      orderBy: { updatedAt: "desc" }
    });

    if (items.length === 0) {
      return HUB_SEED_ITEMS
        .filter((item) => item.type === "mcp")
        .map((item) => ({
          id: item.id,
          name: item.name,
          summary: item.summary,
          latestVersion: item.latestVersion
        }));
    }

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary,
      latestVersion: item.latestVersion
    }));
  }

  /** 根据 ID 查找 MCP 条目详情 */
  async findById(id: string): Promise<McpItemDetail | null> {
    const item = await this.databaseService.hubItem.findUnique({
      where: { id },
      include: {
        releases: { orderBy: { createdAt: "desc" } }
      }
    });

    if (!item) {
      const seedItem = HUB_SEED_ITEMS.find((candidate) => candidate.id === id && candidate.type === "mcp");
      return seedItem
        ? {
            id: seedItem.id,
            name: seedItem.name,
            summary: seedItem.summary,
            description: seedItem.description,
            latestVersion: seedItem.latestVersion,
            releases: seedItem.releases.map((release) => ({
              id: release.id,
              version: release.version,
              releaseNotes: release.releaseNotes
            }))
          }
        : null;
    }

    if (item.type !== "mcp") {
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

  /** 创建 MCP 条目 */
  async createItem(input: CreateMcpItemRecordInput): Promise<McpItemDetail> {
    const item = await this.databaseService.hubItem.create({
      data: {
        id: input.id,
        type: "mcp",
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
      latestVersion: item.latestVersion,
      releases: item.releases.map((release) => ({
        id: release.id,
        version: release.version,
        releaseNotes: release.releaseNotes
      }))
    };
  }

  /** 创建 MCP 版本，同时更新条目的最新版本号 */
  async createRelease(input: CreateMcpReleaseRecordInput): Promise<McpReleaseDetail> {
    const item = await this.databaseService.hubItem.findUnique({
      where: { id: input.itemId }
    });

    if (!item || item.type !== "mcp") {
      throw new Error(`mcp_item_not_found:${input.itemId}`);
    }

    const release = await this.databaseService.$transaction(async (tx) => {
      const created = await tx.hubRelease.create({
        data: {
          id: input.releaseId,
          itemId: input.itemId,
          version: input.version,
          releaseNotes: input.releaseNotes,
          manifestJson: {
            kind: "mcp",
            name: item.name,
            version: input.version,
            description: item.description,
            config: input.config
          } satisfies HubManifest
        }
      });

      await tx.hubItem.update({
        where: { id: input.itemId },
        data: { latestVersion: input.latestVersion }
      });

      return created;
    });

    return {
      id: release.id,
      version: release.version,
      releaseNotes: release.releaseNotes,
      config: this.readConfigFromManifest(release.manifestJson)
    };
  }

  /** 根据版本 ID 获取版本详情 */
  async findReleaseById(releaseId: string): Promise<McpReleaseDetail | null> {
    const release = await this.databaseService.hubRelease.findUnique({
      where: { id: releaseId },
      include: {
        item: true
      }
    });

    if (!release || release.item.type !== "mcp") {
      return null;
    }

    return {
      id: release.id,
      version: release.version,
      releaseNotes: release.releaseNotes,
      config: this.readConfigFromManifest(release.manifestJson)
    };
  }

  /** 从统一的 Hub manifest 中提取 MCP 连接配置。 */
  private readConfigFromManifest(manifestJson: unknown): McpServerConfig {
    if (!manifestJson || typeof manifestJson !== "object") {
      throw new Error("mcp_manifest_invalid");
    }

    const manifest = manifestJson as {
      kind?: unknown;
      config?: unknown;
    };

    if (manifest.kind !== "mcp" || !manifest.config || typeof manifest.config !== "object") {
      throw new Error("mcp_manifest_config_missing");
    }

    return manifest.config as McpServerConfig;
  }
}
