import type { DownloadTokenResponse, McpManifest } from "@myclaw-cloud/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../../database/services/database.service";
import {
  ARTIFACT_STORAGE_PORT,
  type ArtifactStoragePort,
  type SkillArtifactReadStream,
  type StoredSkillArtifact
} from "../ports/artifact-storage.port";

@Injectable()
export class ArtifactService {
  private readonly logger = new Logger(ArtifactService.name);

  constructor(
    @Inject(ARTIFACT_STORAGE_PORT)
    private readonly artifactStorage: ArtifactStoragePort,
    private readonly databaseService: DatabaseService
  ) {}

  /** 获取 MCP 版本的连接配置清单 */
  async getManifest(releaseId: string): Promise<McpManifest> {
    this.logger.log(`开始读取 MCP 清单，releaseId=${releaseId}`);

    // 从 mcp_server_release 读取 configJson。
    const mcpRelease = await this.databaseService.mcpServerRelease.findUnique({
      where: { id: releaseId },
      include: { server: true }
    });

    if (mcpRelease) {
      const config = mcpRelease.configJson as McpManifest["config"];
      return {
        kind: "mcp",
        name: mcpRelease.server.name,
        version: mcpRelease.version,
        description: mcpRelease.server.description,
        config
      };
    }

    this.logger.warn(`未找到 MCP 版本，使用兜底清单，releaseId=${releaseId}`);
    return {
      kind: "mcp",
      name: "Filesystem MCP",
      version: "1.0.0",
      description: "Managed MCP configuration.",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem", "."]
      }
    };
  }

  /** 为指定发布版本的工件创建下载令牌。 */
  async createDownloadToken(releaseId: string): Promise<DownloadTokenResponse> {
    this.logger.log(`开始创建下载令牌，releaseId=${releaseId}`);
    return this.artifactStorage.createDownloadDescriptor(releaseId);
  }

  /** 读取指定发布版本已持久化的工件元数据。 */
  async getStoredSkillArtifact(releaseId: string): Promise<StoredSkillArtifact | null> {
    this.logger.log(`开始读取工件元数据，releaseId=${releaseId}`);
    const skillReleaseModel = (
      this.databaseService as unknown as {
        skillRelease?: {
          findUnique: (args: {
            where: { id: string };
            select: {
              artifactFileName: true;
              artifactFileSize: true;
              artifactStoragePath: true;
              artifactDownloadUrl: true;
            };
          }) => Promise<{
            artifactFileName: string;
            artifactFileSize: number;
            artifactStoragePath: string;
            artifactDownloadUrl: string;
          } | null>;
        };
      }
    ).skillRelease;

    const release = await skillReleaseModel?.findUnique?.({
      where: { id: releaseId },
      select: {
        artifactFileName: true,
        artifactFileSize: true,
        artifactStoragePath: true,
        artifactDownloadUrl: true
      }
    });

    if (!release) {
      this.logger.warn(`未找到发布版本记录，releaseId=${releaseId}`);
      return null;
    }

    if (!release.artifactFileName || !release.artifactStoragePath) {
      this.logger.warn(`发布版本缺少工件元数据，releaseId=${releaseId}`);
      return null;
    }

    this.logger.log(
      `工件元数据读取完成，releaseId=${releaseId}，storageKey=${release.artifactStoragePath}，fileSize=${release.artifactFileSize}`
    );
    return {
      fileName: release.artifactFileName,
      fileSize: release.artifactFileSize,
      storageKey: release.artifactStoragePath,
      storageUrl: release.artifactDownloadUrl || release.artifactStoragePath
    };
  }

  /** 将上传的工件持久化到后端存储。 */
  async storeSkillArtifact(input: { fileBytes: Buffer; fileName: string; releaseId: string }) {
    this.logger.log(
      `开始持久化工件，releaseId=${input.releaseId}，fileName=${input.fileName}，fileSize=${input.fileBytes.byteLength}`
    );
    return this.artifactStorage.storeSkillArtifact(input);
  }

  /** 打开工件读取流，供下载代理转发。 */
  async openSkillArtifactReadStream(artifact: StoredSkillArtifact): Promise<SkillArtifactReadStream> {
    this.logger.log(`开始打开工件读取流，storageKey=${artifact.storageKey}`);
    return this.artifactStorage.openSkillArtifactReadStream(artifact);
  }
}
