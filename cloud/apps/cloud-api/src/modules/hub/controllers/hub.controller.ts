import type { HubItemType } from "@myclaw-cloud/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { ArtifactService } from "../../artifact/services/artifact.service";
import { HubService } from "../services/hub.service";

type UploadedZipFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

type PublishReleaseBody = {
  releaseNotes?: string;
  version?: string;
};

@Controller("api/hub")
export class HubController {
  constructor(
    private readonly hubService: HubService,
    private readonly artifactService: ArtifactService
  ) {}

  @Get("items")
  async list(
    @Query("type") type?: HubItemType,
    @Query("keyword") keyword?: string
  ) {
    return {
      items: await this.hubService.list(type, keyword)
    };
  }

  @Get("items/:id")
  async detail(@Param("id") id: string) {
    const item = await this.hubService.findById(id);
    if (!item) {
      throw new NotFoundException("hub_item_not_found");
    }

    return item;
  }

  @Post("items/:id/employee-releases")
  @UseInterceptors(FileInterceptor("file"))
  async publishEmployeeRelease(
    @Param("id") id: string,
    @Body() body: PublishReleaseBody,
    @UploadedFile() file?: UploadedZipFile
  ) {
    this.assertReleaseBody(body);
    const checkedFile = this.requireReleaseZip(file, "employee_package_zip_required");

    return this.hubService.publishEmployeePackageRelease(id, {
      version: body.version!,
      releaseNotes: body.releaseNotes!,
      fileName: checkedFile.originalname,
      contentType: checkedFile.mimetype,
      fileBytes: checkedFile.buffer
    });
  }

  @Post("items/:id/workflow-releases")
  @UseInterceptors(FileInterceptor("file"))
  async publishWorkflowRelease(
    @Param("id") id: string,
    @Body() body: PublishReleaseBody,
    @UploadedFile() file?: UploadedZipFile
  ) {
    this.assertReleaseBody(body);
    const checkedFile = this.requireReleaseZip(file, "workflow_package_zip_required");

    return this.hubService.publishWorkflowPackageRelease(id, {
      version: body.version!,
      releaseNotes: body.releaseNotes!,
      fileName: checkedFile.originalname,
      contentType: checkedFile.mimetype,
      fileBytes: checkedFile.buffer
    });
  }

  @Get("releases/:releaseId/manifest")
  manifest(@Param("releaseId") releaseId: string) {
    return this.artifactService.getManifest(releaseId);
  }

  @Get("releases/:releaseId/download-token")
  downloadToken(@Param("releaseId") releaseId: string) {
    return this.artifactService.createDownloadToken(releaseId);
  }

  private assertReleaseBody(body: PublishReleaseBody) {
    if (!body.version?.trim()) {
      throw new BadRequestException("release_version_required");
    }

    if (!body.releaseNotes?.trim()) {
      throw new BadRequestException("release_notes_required");
    }
  }

  private requireReleaseZip(file: UploadedZipFile | undefined, missingCode: string): UploadedZipFile {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException(missingCode);
    }

    if (!file.originalname.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException("hub_package_must_be_zip");
    }

    return file;
  }
}
