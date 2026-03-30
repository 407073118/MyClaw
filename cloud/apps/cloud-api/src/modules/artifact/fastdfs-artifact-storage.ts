import { Injectable, Logger } from "@nestjs/common";

import type {
  ArtifactDownloadDescriptor,
  ArtifactStoragePort,
  SkillArtifactReadStream,
  StoredSkillArtifact,
  StoreSkillArtifactInput
} from "./artifact-storage.port";

type FastdfsConfig = {
  baseUrl: string;
  projectCode: string;
  token: string;
  uploadPath: string;
  downloadPath: string;
  timeoutMs: number;
};

@Injectable()
export class FastdfsArtifactStorage implements ArtifactStoragePort {
  private readonly logger = new Logger(FastdfsArtifactStorage.name);

  /** 生成云端暴露给桌面端的下载描述，保持上层接口稳定。 */
  async createDownloadDescriptor(releaseId: string): Promise<ArtifactDownloadDescriptor> {
    this.logger.log(`生成制品下载描述，releaseId=${releaseId}`);
    return {
      downloadUrl: `/api/artifacts/download/${releaseId}`,
      expiresIn: 300
    };
  }

  /** 上传 Skill zip 到 FastDFS，并返回可落库的制品元数据。 */
  async storeSkillArtifact(input: StoreSkillArtifactInput): Promise<StoredSkillArtifact> {
    const config = this.readFastdfsConfig();
    const uploadUrl = this.buildUploadRequestUrl(config);
    this.logger.log(
      `开始上传制品到 FastDFS，releaseId=${input.releaseId}, fileName=${input.fileName}, fileSize=${input.fileBytes.byteLength}, uploadUrl=${uploadUrl}`,
    );

    const uploadResult = await this.uploadArchiveToFastdfs(uploadUrl, config.timeoutMs, input);

    this.logger.log(
      `制品上传成功，releaseId=${input.releaseId}, storageKey=${uploadResult.storageKey}, storageUrl=${uploadResult.storageUrl}`,
    );
    return {
      fileName: uploadResult.fileName,
      fileSize: uploadResult.fileSize,
      storageKey: uploadResult.storageKey,
      storageUrl: uploadResult.storageUrl
    };
  }

  /** 打开 FastDFS 下载流，供控制器进行流式代理。 */
  async openSkillArtifactReadStream(artifact: StoredSkillArtifact): Promise<SkillArtifactReadStream> {
    const config = this.readFastdfsConfig();
    const downloadUrl = this.buildDownloadRequestUrl(config, artifact.storageKey);
    this.logger.log(`开始打开制品下载流，storageKey=${artifact.storageKey}, downloadUrl=${downloadUrl}`);

    const response = await fetch(downloadUrl, {
      method: "GET",
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    if (!response.ok) {
      const detail = await this.readErrorBody(response);
      this.logger.error(
        `FastDFS 下载失败，storageKey=${artifact.storageKey}, status=${response.status}, detail=${detail || "无"}`,
      );
      throw new Error(`fastdfs_download_failed_${response.status}`);
    }

    if (!response.body) {
      this.logger.error(`FastDFS 返回空响应流，storageKey=${artifact.storageKey}`);
      throw new Error("fastdfs_download_empty_body");
    }

    const rawContentLength = response.headers.get("content-length");
    const contentLength = rawContentLength ? Number(rawContentLength) : null;
    const normalizedContentLength = Number.isFinite(contentLength) ? contentLength : null;
    const contentType = response.headers.get("content-type");

    this.logger.log(
      `制品下载流打开成功，storageKey=${artifact.storageKey}, contentType=${contentType || "application/octet-stream"}, contentLength=${normalizedContentLength ?? -1}`,
    );
    return {
      fileName: artifact.fileName,
      contentType,
      contentLength: normalizedContentLength,
      stream: response.body
    };
  }

  /** 从环境变量读取 FastDFS 必填配置并做兜底校验。 */
  private readFastdfsConfig(): FastdfsConfig {
    const baseUrl = process.env.FASTDFS_BASE_URL?.trim();
    if (!baseUrl) {
      this.logger.error("FASTDFS_BASE_URL 未配置，无法进行制品读写");
      throw new Error("FASTDFS_BASE_URL is required");
    }

    const projectCode = process.env.FASTDFS_PROJECT_CODE?.trim() || "BrTest";
    const token = process.env.FASTDFS_TOKEN?.trim() || "BrTest20210526";
    const uploadPath = process.env.FASTDFS_UPLOAD_PATH?.trim() || "/api/file/uploadSingle";
    const downloadPath = process.env.FASTDFS_DOWNLOAD_PATH?.trim() || "/api/file/download";
    const timeoutMs = Number(process.env.FASTDFS_TIMEOUT_MS ?? "30000");

    return {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      projectCode,
      token,
      uploadPath: uploadPath.startsWith("/") ? uploadPath : `/${uploadPath}`,
      downloadPath: downloadPath.startsWith("/") ? downloadPath : `/${downloadPath}`,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000
    };
  }

  /** 拼接 FastDFS 上传地址。 */
  private buildUploadRequestUrl(config: FastdfsConfig): string {
    const url = new URL(config.uploadPath, `${config.baseUrl}/`);
    url.searchParams.set("projectCode", config.projectCode);
    url.searchParams.set("token", config.token);
    return url.toString();
  }

  /** 拼接 FastDFS 下载地址。 */
  private buildDownloadRequestUrl(config: FastdfsConfig, storageKey: string): string {
    const url = new URL(config.downloadPath, `${config.baseUrl}/`);
    url.searchParams.set("projectCode", config.projectCode);
    url.searchParams.set("token", config.token);
    url.searchParams.set("url", storageKey);
    return url.toString();
  }

  /** 上传 zip 并解析 FastDFS 返回，兼容外层 envelope 与内层业务结构。 */
  private async uploadArchiveToFastdfs(
    uploadUrl: string,
    timeoutMs: number,
    input: StoreSkillArtifactInput,
  ): Promise<{
    fileName: string;
    fileSize: number;
    storageKey: string;
    storageUrl: string;
  }> {
    const formData = new FormData();
    const fileBytes = Uint8Array.from(input.fileBytes);
    formData.set("file", new Blob([fileBytes], { type: "application/zip" }), input.fileName);

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const detail = await this.readErrorBody(response);
      this.logger.error(
        `FastDFS 上传请求失败，releaseId=${input.releaseId}, status=${response.status}, detail=${detail || "无"}`,
      );
      throw new Error(`fastdfs_upload_failed_${response.status}`);
    }

    const payload = await response.json();
    const normalizedPayload = this.unwrapUploadResponse(payload);
    const rawCode = normalizedPayload?.code;
    if (!(rawCode === 0 || rawCode === "0")) {
      this.logger.error(
        `FastDFS 上传业务失败，releaseId=${input.releaseId}, code=${String(rawCode)}, payload=${JSON.stringify(normalizedPayload)}`,
      );
      throw new Error("fastdfs_upload_business_failed");
    }

    const result = normalizedPayload.result as Record<string, unknown> | undefined;
    const rawStorageUrl = typeof result?.url === "string" ? result.url.trim() : "";
    if (!rawStorageUrl) {
      this.logger.error(`FastDFS 上传返回缺少 url 字段，releaseId=${input.releaseId}, payload=${JSON.stringify(normalizedPayload)}`);
      throw new Error("fastdfs_upload_missing_url");
    }

    const fileName = typeof result?.name === "string" && result.name.trim() ? result.name.trim() : input.fileName;
    const fileSizeByte = Number(result?.fileSizeByte ?? input.fileBytes.byteLength);
    const storageKey = this.extractStorageKey(rawStorageUrl);

    return {
      fileName,
      fileSize: Number.isFinite(fileSizeByte) && fileSizeByte >= 0 ? fileSizeByte : input.fileBytes.byteLength,
      storageKey,
      storageUrl: rawStorageUrl
    };
  }

  /** 解包 FastDFS 响应，统一输出 `{ code, result }` 结构。 */
  private unwrapUploadResponse(payload: unknown): {
    code?: unknown;
    result?: unknown;
  } {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }

    const firstLayer = payload as Record<string, unknown>;
    if (firstLayer.code === "00" && firstLayer.result !== undefined) {
      const nested =
        typeof firstLayer.result === "string" ? this.tryParseJson(firstLayer.result) : firstLayer.result;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested as { code?: unknown; result?: unknown };
      }
    }

    return {
      code: firstLayer.code,
      result: firstLayer.result
    };
  }

  /** 从 FastDFS 返回 URL 中提取下载参数所需的路径。 */
  private extractStorageKey(storageUrl: string): string {
    if (!storageUrl) {
      throw new Error("fastdfs_storage_url_required");
    }

    if (/^https?:\/\//i.test(storageUrl)) {
      const parsedUrl = new URL(storageUrl);
      if (!parsedUrl.pathname) {
        throw new Error("fastdfs_storage_key_required");
      }
      return parsedUrl.pathname.startsWith("/") ? parsedUrl.pathname : `/${parsedUrl.pathname}`;
    }

    return storageUrl.startsWith("/") ? storageUrl : `/${storageUrl}`;
  }

  /** 读取错误响应体，便于日志诊断。 */
  private async readErrorBody(response: Response): Promise<string | null> {
    try {
      const text = await response.text();
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  /** 尝试解析 JSON 字符串，失败时返回 null。 */
  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

}
