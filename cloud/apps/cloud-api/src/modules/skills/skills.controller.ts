import type { CreateSkillInput, SkillCategory, UpdateSkillInput } from "@myclaw-cloud/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { SkillsService } from "./skills.service";

type UploadedZipFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

type PublishSkillReleaseBody = {
  entryFile?: string;
  readme?: string;
  releaseNotes?: string;
  version?: string;
};

@Controller("api/skills")
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  async list(
    @Query("category") category?: SkillCategory,
    @Query("keyword") keyword?: string,
    @Query("sort") sort?: "latest" | "downloads" | "name",
    @Query("tag") tag?: string
  ) {
    return {
      skills: await this.skillsService.list({ category, keyword, sort, tag })
    };
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const skill = await this.skillsService.findById(id);
    if (!skill) {
      throw new NotFoundException("skill_not_found");
    }

    return skill;
  }

  @Post()
  async createSkill(@Body() body: CreateSkillInput) {
    this.assertCreateSkillBody(body);

    return {
      skill: await this.skillsService.createSkill({
        id: body.id,
        name: body.name,
        summary: body.summary,
        description: body.description,
        icon: body.icon,
        category: body.category,
        tags: body.tags,
        author: body.author
      })
    };
  }

  @Put(":id")
  async updateSkill(@Param("id") id: string, @Body() body: UpdateSkillInput) {
    return {
      skill: await this.skillsService.updateSkill(id, body)
    };
  }

  @Post(":id/releases")
  @UseInterceptors(FileInterceptor("file"))
  async publishRelease(
    @Param("id") id: string,
    @Body() body: PublishSkillReleaseBody,
    @UploadedFile() file?: UploadedZipFile
  ) {
    this.assertReleaseBody(body);
    const checkedFile = this.requireReleaseZip(file);

    return this.skillsService.publishRelease(id, {
      version: body.version!,
      releaseNotes: body.releaseNotes!,
      entryFile: body.entryFile!,
      readme: body.readme!,
      fileName: checkedFile.originalname,
      fileBytes: checkedFile.buffer
    });
  }

  private assertCreateSkillBody(body: CreateSkillInput) {
    if (!body.id?.trim()) {
      throw new BadRequestException("skill_id_required");
    }

    if (!body.name?.trim()) {
      throw new BadRequestException("skill_name_required");
    }

    if (!body.summary?.trim()) {
      throw new BadRequestException("skill_summary_required");
    }

    if (!body.description?.trim()) {
      throw new BadRequestException("skill_description_required");
    }
  }

  private assertReleaseBody(body: PublishSkillReleaseBody) {
    if (!body.version?.trim()) {
      throw new BadRequestException("release_version_required");
    }

    if (!body.releaseNotes?.trim()) {
      throw new BadRequestException("release_notes_required");
    }

    if (!body.entryFile?.trim()) {
      throw new BadRequestException("skill_entry_file_required");
    }

    if (!body.readme?.trim()) {
      throw new BadRequestException("skill_readme_required");
    }
  }

  private requireReleaseZip(file: UploadedZipFile | undefined) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException("skill_zip_required");
    }

    if (!file.originalname.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException("skill_package_must_be_zip");
    }

    return file;
  }
}
