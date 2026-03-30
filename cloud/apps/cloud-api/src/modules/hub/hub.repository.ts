import type { HubItemDetail, HubManifest, HubReleaseUploadResponse, HubItemType } from "@myclaw-cloud/shared";

export type CreateItemInput = {
  id: string;
  type: HubItemType;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
};

export type CreateReleaseInput<TManifest extends HubManifest = HubManifest> = {
  artifact: {
    fileName: string;
    fileSize: number;
    storagePath: string;
    downloadUrl: string;
    downloadExpiresIn: number;
  };
  itemId: string;
  latestVersion: string;
  manifest: TManifest;
  releaseId: string;
  releaseNotes: string;
  version: string;
};

export interface HubRepository {
  list(): Promise<HubItemDetail[]>;
  findById(id: string): Promise<HubItemDetail | null>;
  createItem(input: CreateItemInput): Promise<HubItemDetail>;
  createRelease<TManifest extends HubManifest>(
    input: CreateReleaseInput<TManifest>,
  ): Promise<HubReleaseUploadResponse<TManifest>>;
}

export const HUB_REPOSITORY = Symbol("HUB_REPOSITORY");
