import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Controller, Get, InternalServerErrorException, Logger, NotFoundException, Param, Res } from "@nestjs/common";

import { ArtifactService } from "./artifact.service";

@Controller("api/artifacts")
export class ArtifactController {
  private readonly logger = new Logger(ArtifactController.name);

  constructor(private readonly artifactService: ArtifactService) {}

  /** 下载指定 release 的制品，从 FastDFS 拉取后流式透传给客户端。 */
  @Get("download/:releaseId")
  async download(@Param("releaseId") releaseId: string, @Res() response: any) {
    this.logger.log(`收到制品下载请求，releaseId=${releaseId}`);
    const artifact = await this.artifactService.getStoredSkillArtifact(releaseId);

    if (!artifact) {
      this.logger.warn(`制品不存在，releaseId=${releaseId}`);
      throw new NotFoundException("artifact_not_found");
    }

    const artifactStream = await this.artifactService.openSkillArtifactReadStream(artifact);
    response.setHeader("Content-Type", artifactStream.contentType || "application/octet-stream");
    response.setHeader("Content-Disposition", this.buildAttachmentHeader(artifactStream.fileName));
    if (artifactStream.contentLength !== null) {
      response.setHeader("Content-Length", String(artifactStream.contentLength));
    }

    try {
      await pipeline(Readable.fromWeb(artifactStream.stream as any), response);
      this.logger.log(`制品下载完成，releaseId=${releaseId}, fileName=${artifactStream.fileName}`);
    } catch (error) {
      this.logger.error(
        `制品下载流式透传失败，releaseId=${releaseId}, error=${error instanceof Error ? error.message : "未知错误"}`,
      );
      if (!response.headersSent) {
        throw new InternalServerErrorException("artifact_stream_failed");
      }
      response.destroy(error as Error);
    }
  }

  /** 构建兼容中文文件名的附件下载头。 */
  private buildAttachmentHeader(fileName: string) {
    return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }
}
