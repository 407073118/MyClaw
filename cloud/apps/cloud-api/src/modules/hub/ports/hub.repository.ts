import type { HubItemDetail, HubManifest, HubReleaseUploadResponse, HubItemType } from "@myclaw-cloud/shared";

/** 创建 Hub 条目时使用的输入结构。 */
export type CreateItemInput = {
  id: string;
  type: HubItemType;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
};

/** 创建 Hub 发布记录时使用的输入结构。 */
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

/** Hub 聚合仓储接口，统一封装列表、详情与发布入库操作。 */
export interface HubRepository {
  /** 查询 Hub 中的全部条目详情。 */
  list(): Promise<HubItemDetail[]>;

  /** 按条目 ID 查询 Hub 详情。 */
  findById(id: string): Promise<HubItemDetail | null>;

  /** 创建新的 Hub 条目。 */
  createItem(input: CreateItemInput): Promise<HubItemDetail>;

  /** 为指定条目创建一个新的发布版本。 */
  createRelease<TManifest extends HubManifest>(
    input: CreateReleaseInput<TManifest>,
  ): Promise<HubReleaseUploadResponse<TManifest>>;
}

export const HUB_REPOSITORY = Symbol("HUB_REPOSITORY");
