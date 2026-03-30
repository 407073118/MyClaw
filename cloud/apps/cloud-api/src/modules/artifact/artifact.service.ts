import type { DownloadTokenResponse, HubManifest } from "@myclaw-cloud/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import {
  ARTIFACT_STORAGE_PORT,
  type ArtifactStoragePort,
  type SkillArtifactReadStream,
  type StoredSkillArtifact
} from "./artifact-storage.port";

@Injectable()
export class ArtifactService {
  private readonly logger = new Logger(ArtifactService.name);

  constructor(
    @Inject(ARTIFACT_STORAGE_PORT)
    private readonly artifactStorage: ArtifactStoragePort,
    private readonly databaseService: DatabaseService
  ) {}

  /** Return the persisted manifest for a hub release, or a safe MCP fallback. */
  async getManifest(releaseId: string): Promise<HubManifest> {
    this.logger.log(`load manifest for releaseId=${releaseId}`);

    const mcpReleaseModel = (
      this.databaseService as unknown as {
        mcpRelease?: {
          findUnique: (args: { where: { id: string } }) => Promise<{ manifestJson?: unknown } | null>;
        };
      }
    ).mcpRelease;
    const hubReleaseModel = (
      this.databaseService as unknown as {
        hubRelease?: {
          findUnique: (args: { where: { id: string } }) => Promise<{ manifestJson?: unknown } | null>;
        };
      }
    ).hubRelease;

    let release: { manifestJson?: unknown } | null = null;
    if (mcpReleaseModel?.findUnique) {
      release = await mcpReleaseModel.findUnique({
        where: { id: releaseId }
      });
    }

    if (hubReleaseModel?.findUnique) {
      release ??= await hubReleaseModel.findUnique({
        where: { id: releaseId }
      });
    } else {
      this.logger.warn(`hubRelease model missing, using fallback manifest for releaseId=${releaseId}`);
    }

    if (release?.manifestJson && typeof release.manifestJson === "object") {
      return release.manifestJson as HubManifest;
    }

    return {
      kind: "mcp",
      name: "Filesystem MCP",
      version: "1.0.0",
      description: "Managed MCP configuration.",
      transport: "stdio",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "."]
    };
  }

  /** Create a download token for a release artifact. */
  async createDownloadToken(releaseId: string): Promise<DownloadTokenResponse> {
    this.logger.log(`create download token for releaseId=${releaseId}`);
    return this.artifactStorage.createDownloadDescriptor(releaseId);
  }

  /** Read persisted artifact metadata for a release. */
  async getStoredSkillArtifact(releaseId: string): Promise<StoredSkillArtifact | null> {
    this.logger.log(`load artifact metadata for releaseId=${releaseId}`);
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
    const mcpReleaseModel = (
      this.databaseService as unknown as {
        mcpRelease?: {
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
    ).mcpRelease;

    const release =
      (await skillReleaseModel?.findUnique?.({
        where: { id: releaseId },
        select: {
          artifactFileName: true,
          artifactFileSize: true,
          artifactStoragePath: true,
          artifactDownloadUrl: true
        }
      })) ??
      (await mcpReleaseModel?.findUnique?.({
        where: { id: releaseId },
        select: {
          artifactFileName: true,
          artifactFileSize: true,
          artifactStoragePath: true,
          artifactDownloadUrl: true
        }
      })) ??
      (await this.databaseService.hubRelease.findUnique({
        where: { id: releaseId },
        select: {
          artifactFileName: true,
          artifactFileSize: true,
          artifactStoragePath: true,
          artifactDownloadUrl: true
        }
      }));

    if (!release) {
      this.logger.warn(`release not found, releaseId=${releaseId}`);
      return null;
    }

    if (!release.artifactFileName || !release.artifactStoragePath) {
      this.logger.warn(`release missing artifact metadata, releaseId=${releaseId}`);
      return null;
    }

    this.logger.log(
      `artifact metadata loaded, releaseId=${releaseId}, storageKey=${release.artifactStoragePath}, fileSize=${release.artifactFileSize}`
    );
    return {
      fileName: release.artifactFileName,
      fileSize: release.artifactFileSize,
      storageKey: release.artifactStoragePath,
      storageUrl: release.artifactDownloadUrl || release.artifactStoragePath
    };
  }

  /** Persist an uploaded artifact in the backing storage. */
  async storeSkillArtifact(input: { fileBytes: Buffer; fileName: string; releaseId: string }) {
    this.logger.log(
      `store artifact releaseId=${input.releaseId}, fileName=${input.fileName}, fileSize=${input.fileBytes.byteLength}`
    );
    return this.artifactStorage.storeSkillArtifact(input);
  }

  /** Open an artifact stream for download proxying. */
  async openSkillArtifactReadStream(artifact: StoredSkillArtifact): Promise<SkillArtifactReadStream> {
    this.logger.log(`open artifact stream for storageKey=${artifact.storageKey}`);
    return this.artifactStorage.openSkillArtifactReadStream(artifact);
  }
}
