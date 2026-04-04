import type {
  CreateSkillInput,
  PublishSkillReleaseResponse,
  SkillDetail,
  SkillListQuery,
  SkillSummary,
  UpdateSkillInput
} from "@myclaw-cloud/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { ArtifactService } from "../../artifact/services/artifact.service";
import { SKILLS_REPOSITORY, type SkillsRepository } from "../ports/skills.repository";

type PublishSkillReleaseInput = {
  entryFile: string;
  fileBytes: Buffer;
  fileName: string;
  readme: string;
  releaseNotes: string;
  version: string;
};

@Injectable()
export class SkillsService {
  constructor(
    @Inject(SKILLS_REPOSITORY)
    private readonly skillsRepository: SkillsRepository,
    private readonly artifactService: ArtifactService
  ) {}

  list(query?: SkillListQuery): Promise<SkillSummary[]> {
    return this.skillsRepository.list(query);
  }

  findById(id: string): Promise<SkillDetail | null> {
    return this.skillsRepository.findById(id);
  }

  async createSkill(input: CreateSkillInput): Promise<SkillDetail> {
    const existing = await this.skillsRepository.findById(input.id.trim());

    if (existing) {
      throw new BadRequestException("skill_already_exists");
    }

    return this.skillsRepository.createSkill({
      id: input.id.trim(),
      name: input.name.trim(),
      summary: input.summary.trim(),
      description: input.description.trim(),
      icon: input.icon,
      category: input.category,
      tags: input.tags,
      author: input.author
    });
  }

  async updateSkill(id: string, input: UpdateSkillInput): Promise<SkillDetail> {
    const existing = await this.skillsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException("skill_not_found");
    }

    const updated = await this.skillsRepository.updateSkill(id, input);
    return updated!;
  }

  async publishRelease(skillId: string, input: PublishSkillReleaseInput): Promise<PublishSkillReleaseResponse> {
    const skill = await this.skillsRepository.findById(skillId);
    if (!skill) {
      throw new NotFoundException("skill_not_found");
    }

    if (!input.fileName.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException("skill_package_must_be_zip");
    }

    const version = input.version.trim();
    const releaseNotes = input.releaseNotes.trim();
    const releaseId = this.buildReleaseId(skillId, version);
    const storedArtifact = await this.artifactService.storeSkillArtifact({
      releaseId,
      fileBytes: input.fileBytes,
      fileName: input.fileName
    });
    const downloadToken = await this.artifactService.createDownloadToken(releaseId);

    return this.skillsRepository.createRelease({
      skillId,
      releaseId,
      version,
      releaseNotes,
      manifest: {
        name: skill.name,
        version,
        entryFile: input.entryFile.trim(),
        readme: input.readme
      },
      artifact: {
        fileName: storedArtifact.fileName,
        fileSize: storedArtifact.fileSize,
        storagePath: storedArtifact.storageKey,
        downloadUrl: downloadToken.downloadUrl,
        downloadExpiresIn: downloadToken.expiresIn
      }
    });
  }

  private buildReleaseId(skillId: string, version: string) {
    return `release-${skillId}-${version}`;
  }
}
