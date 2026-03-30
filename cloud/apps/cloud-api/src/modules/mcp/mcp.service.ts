import type {
  CreateMcpItemInput,
  CreateMcpReleaseResponse,
  McpItemDetail,
  McpItemSummary,
  McpManifest,
  McpReleaseUploadResponse
} from "@myclaw-cloud/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { ArtifactService } from "../artifact/artifact.service";
import { MCP_REPOSITORY, type McpRepository } from "./mcp.repository";

type PublishMcpReleaseInput = {
  contentType: string;
  fileBytes: Buffer;
  fileName: string;
  releaseNotes: string;
  version: string;
};

type CreateMcpWithInitialReleaseInput = CreateMcpItemInput & {
  contentType: string;
  fileBytes: Buffer;
  fileName: string;
};

@Injectable()
export class McpService {
  constructor(
    @Inject(MCP_REPOSITORY)
    private readonly mcpRepository: McpRepository,
    private readonly artifactService: ArtifactService
  ) {}

  list(): Promise<McpItemSummary[]> {
    return this.mcpRepository.list();
  }

  findById(id: string): Promise<McpItemDetail | null> {
    return this.mcpRepository.findById(id);
  }

  async publishMcpRelease(itemId: string, input: PublishMcpReleaseInput): Promise<McpReleaseUploadResponse> {
    const item = await this.mcpRepository.findById(itemId);
    if (!item) {
      throw new NotFoundException("mcp_item_not_found");
    }

    if (!input.fileName.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException("mcp_package_must_be_zip");
    }

    const version = input.version.trim();
    const releaseNotes = input.releaseNotes.trim();
    const releaseId = this.buildReleaseId(itemId, version);
    const manifest: McpManifest = {
      kind: "mcp",
      name: item.name,
      version,
      description: item.description,
      transport: "stdio"
    };

    const storedArtifact = await this.artifactService.storeSkillArtifact({
      releaseId,
      fileBytes: input.fileBytes,
      fileName: input.fileName
    });
    const downloadToken = await this.artifactService.createDownloadToken(releaseId);

    return this.mcpRepository.createRelease({
      itemId,
      releaseId,
      version,
      latestVersion: version,
      manifest,
      releaseNotes,
      artifact: {
        fileName: storedArtifact.fileName,
        fileSize: storedArtifact.fileSize,
        storagePath: storedArtifact.storageKey,
        downloadUrl: downloadToken.downloadUrl,
        downloadExpiresIn: downloadToken.expiresIn
      }
    });
  }

  async createMcpWithInitialRelease(input: CreateMcpWithInitialReleaseInput): Promise<CreateMcpReleaseResponse> {
    const itemId = input.id.trim();
    const existing = await this.mcpRepository.findById(itemId);

    if (existing) {
      throw new BadRequestException("mcp_item_already_exists");
    }

    const version = input.version.trim();
    const item = await this.mcpRepository.createItem({
      id: itemId,
      name: input.name.trim(),
      summary: input.summary.trim(),
      description: input.description.trim(),
      latestVersion: version
    });

    const release = await this.publishMcpRelease(itemId, {
      version,
      releaseNotes: input.releaseNotes.trim(),
      fileName: input.fileName,
      contentType: input.contentType,
      fileBytes: input.fileBytes
    });

    return {
      item,
      ...release
    };
  }

  manifest(releaseId: string) {
    return this.artifactService.getManifest(releaseId);
  }

  private buildReleaseId(itemId: string, version: string) {
    return `release-${itemId}-${version}`;
  }
}
