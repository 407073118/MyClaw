import type { CreateMcpItemInput } from "@myclaw-cloud/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { McpService } from "./mcp.service";

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

@Controller("api/mcp")
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get("items")
  async list() {
    return {
      items: await this.mcpService.list()
    };
  }

  @Get("items/:id")
  async detail(@Param("id") id: string) {
    const item = await this.mcpService.findById(id);
    if (!item) {
      throw new NotFoundException("mcp_item_not_found");
    }

    return item;
  }

  @Post("items/:id/releases")
  @UseInterceptors(FileInterceptor("file"))
  async publishRelease(
    @Param("id") id: string,
    @Body() body: PublishReleaseBody,
    @UploadedFile() file?: UploadedZipFile
  ) {
    this.assertReleaseBody(body);
    const checkedFile = this.requireReleaseZip(file, "mcp_zip_required");

    return this.mcpService.publishMcpRelease(id, {
      version: body.version!,
      releaseNotes: body.releaseNotes!,
      fileName: checkedFile.originalname,
      contentType: checkedFile.mimetype,
      fileBytes: checkedFile.buffer
    });
  }

  @Post("items")
  @UseInterceptors(FileInterceptor("file"))
  async createMcp(
    @Body() body: CreateMcpItemInput,
    @UploadedFile() file?: UploadedZipFile
  ) {
    this.assertCreateMcpBody(body);
    const checkedFile = this.requireReleaseZip(file, "mcp_zip_required");

    return this.mcpService.createMcpWithInitialRelease({
      id: body.id.trim(),
      name: body.name.trim(),
      summary: body.summary.trim(),
      description: body.description.trim(),
      version: body.version.trim(),
      releaseNotes: body.releaseNotes.trim(),
      fileName: checkedFile.originalname,
      contentType: checkedFile.mimetype,
      fileBytes: checkedFile.buffer
    });
  }

  @Get("releases/:releaseId/manifest")
  manifest(@Param("releaseId") releaseId: string) {
    return this.mcpService.manifest(releaseId);
  }

  private assertReleaseBody(body: PublishReleaseBody) {
    if (!body.version?.trim()) {
      throw new BadRequestException("release_version_required");
    }

    if (!body.releaseNotes?.trim()) {
      throw new BadRequestException("release_notes_required");
    }
  }

  private assertCreateMcpBody(body: CreateMcpItemInput) {
    if (!body.id?.trim()) {
      throw new BadRequestException("mcp_item_id_required");
    }

    if (!body.name?.trim()) {
      throw new BadRequestException("mcp_item_name_required");
    }

    if (!body.summary?.trim()) {
      throw new BadRequestException("mcp_item_summary_required");
    }

    if (!body.description?.trim()) {
      throw new BadRequestException("mcp_item_description_required");
    }

    this.assertReleaseBody(body);
  }

  private requireReleaseZip(file: UploadedZipFile | undefined, missingCode: string): UploadedZipFile {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException(missingCode);
    }

    if (!file.originalname.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException("mcp_package_must_be_zip");
    }

    return file;
  }
}
