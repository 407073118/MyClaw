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
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";

import { prepareSkillPackageUpload, type UploadedSkillPackageFile } from "../skill-package";
import { SkillsService } from "../services/skills.service";

type PublishSkillReleaseBody = {
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

  /** 校验上传的 Skill 包结构，并从 SKILL.md 自动补齐发布元数据。 */
  @Post(":id/releases")
  @UseInterceptors(AnyFilesInterceptor())
  async publishRelease(
    @Param("id") id: string,
    @Body() body: PublishSkillReleaseBody,
    @UploadedFiles() files?: UploadedSkillPackageFile[]
  ) {
    console.info("[skills-controller] 开始处理 Skill 发布上传", {
      id,
      fileCount: files?.length ?? 0,
      hasReleaseNotes: Boolean(body.releaseNotes?.trim()),
      versionMode: body.version?.trim() ? "manual" : "auto"
    });
    const preparedPackage = prepareSkillPackageUpload(this.requireReleaseFiles(files));

    return this.skillsService.publishRelease(id, {
      version: body.version?.trim() || undefined,
      releaseNotes: body.releaseNotes?.trim() || "从 SKILL.md 自动发布",
      entryFile: preparedPackage.entryFile,
      readme: preparedPackage.skillMarkdown,
      fileName: preparedPackage.fileName,
      fileBytes: preparedPackage.fileBytes
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

  /** 确保发布请求至少带有一个上传文件。 */
  private requireReleaseFiles(files: UploadedSkillPackageFile[] | undefined) {
    console.info("[skills-controller] 校验 Skill 发布文件列表", { fileCount: files?.length ?? 0 });
    if (!files?.length) {
      throw new BadRequestException("skill_zip_required");
    }

    const validFiles = files.filter((file) => file.buffer?.length && file.originalname);
    if (!validFiles.length) {
      throw new BadRequestException("skill_zip_required");
    }

    return validFiles;
  }
}
