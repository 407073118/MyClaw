export type ArtifactDownloadDescriptor = {
  downloadUrl: string;
  expiresIn: number;
};

export type StoreSkillArtifactInput = {
  fileBytes: Buffer;
  fileName: string;
  releaseId: string;
};

export type StoredSkillArtifact = {
  fileName: string;
  fileSize: number;
  storageKey: string;
  storageUrl: string;
};

export type SkillArtifactReadStream = {
  fileName: string;
  contentType: string | null;
  contentLength: number | null;
  stream: ReadableStream<Uint8Array>;
};

export interface ArtifactStoragePort {
  /** 创建下载描述，供上层接口返回给客户端。 */
  createDownloadDescriptor(releaseId: string): Promise<ArtifactDownloadDescriptor>;
  /** 保存 Skill 制品并返回可持久化元数据。 */
  storeSkillArtifact(input: StoreSkillArtifactInput): Promise<StoredSkillArtifact>;
  /** 打开制品读取流，供控制器进行流式响应。 */
  openSkillArtifactReadStream(artifact: StoredSkillArtifact): Promise<SkillArtifactReadStream>;
}

export const ARTIFACT_STORAGE_PORT = Symbol("ARTIFACT_STORAGE_PORT");
