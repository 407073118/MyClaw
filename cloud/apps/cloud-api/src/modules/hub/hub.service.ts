import type {
  EmployeePackageManifest,
  EmployeePackageReleaseUploadResponse,
  HubItem,
  HubItemDetail,
  HubItemType,
  HubReleaseUploadResponse,
  WorkflowPackageManifest,
  WorkflowPackageReleaseUploadResponse
} from "@myclaw-cloud/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { ArtifactService } from "../artifact/artifact.service";
import { HUB_REPOSITORY, type HubRepository } from "./hub.repository";

type PublishPackageReleaseInput = {
  contentType: string;
  fileBytes: Buffer;
  fileName: string;
  releaseNotes: string;
  version: string;
};

@Injectable()
export class HubService {
  constructor(
    @Inject(HUB_REPOSITORY)
    private readonly hubRepository: HubRepository,
    private readonly artifactService: ArtifactService
  ) {}

  async list(type?: HubItemType, keyword?: string): Promise<HubItem[]> {
    const items = await this.hubRepository.list();

    return items
      .filter((item) => !type || item.type === type)
      .filter((item) => !keyword || item.name.toLowerCase().includes(keyword.toLowerCase()))
      .map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        summary: item.summary,
        latestVersion: item.latestVersion,
        iconUrl: `/api/hub/items/${item.id}/icon`
      }));
  }

  findById(id: string): Promise<HubItemDetail | null> {
    return this.hubRepository.findById(id);
  }

  async publishEmployeePackageRelease(
    itemId: string,
    input: PublishPackageReleaseInput
  ): Promise<EmployeePackageReleaseUploadResponse> {
    return this.publishReleaseForType(
      itemId,
      input,
      "employee-package",
      "hub_item_not_employee_package",
      (item) => ({
        kind: "employee-package",
        name: item.name,
        version: input.version.trim(),
        description: item.description,
        role: item.id
      })
    );
  }

  async publishWorkflowPackageRelease(
    itemId: string,
    input: PublishPackageReleaseInput
  ): Promise<WorkflowPackageReleaseUploadResponse> {
    return this.publishReleaseForType(
      itemId,
      input,
      "workflow-package",
      "hub_item_not_workflow_package",
      (item) => ({
        kind: "workflow-package",
        name: item.name,
        version: input.version.trim(),
        description: item.description,
        entryWorkflowId: item.id
      })
    );
  }

  private buildReleaseId(itemId: string, version: string) {
    return `release-${itemId}-${version}`;
  }

  private async publishReleaseForType<
    TManifest extends EmployeePackageManifest | WorkflowPackageManifest
  >(
    itemId: string,
    input: PublishPackageReleaseInput,
    expectedType: Exclude<HubItemType, "mcp">,
    typeErrorCode: string,
    createManifest: (item: HubItemDetail) => TManifest
  ): Promise<HubReleaseUploadResponse<TManifest>> {
    const item = await this.hubRepository.findById(itemId);
    if (!item) {
      throw new NotFoundException("hub_item_not_found");
    }

    if (item.type !== expectedType) {
      throw new BadRequestException(typeErrorCode);
    }

    if (!input.fileName.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException("hub_package_must_be_zip");
    }

    const version = input.version.trim();
    const releaseNotes = input.releaseNotes.trim();
    const releaseId = this.buildReleaseId(itemId, version);
    const manifest = createManifest(item);

    const storedArtifact = await this.artifactService.storeSkillArtifact({
      releaseId,
      fileBytes: input.fileBytes,
      fileName: input.fileName
    });
    const downloadToken = await this.artifactService.createDownloadToken(releaseId);

    await this.hubRepository.createRelease({
      artifact: {
        fileName: storedArtifact.fileName,
        fileSize: storedArtifact.fileSize,
        storagePath: storedArtifact.storageKey,
        downloadUrl: downloadToken.downloadUrl,
        downloadExpiresIn: downloadToken.expiresIn
      },
      itemId,
      releaseId,
      version,
      latestVersion: version,
      manifest,
      releaseNotes
    });

    return {
      itemId,
      releaseId,
      version,
      latestVersion: version,
      manifest,
      artifact: {
        fileName: storedArtifact.fileName,
        fileSize: storedArtifact.fileSize,
        downloadUrl: downloadToken.downloadUrl,
        expiresIn: downloadToken.expiresIn
      }
    };
  }
}
