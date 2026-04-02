import type {
  CreateSkillInput,
  PublishSkillReleaseResponse,
  SkillDetail,
  SkillListQuery,
  SkillReleaseManifest,
  SkillSummary,
  UpdateSkillInput
} from "@myclaw-cloud/shared";

export type CreateSkillReleaseInput = {
  artifact: {
    fileName: string;
    fileSize: number;
    storagePath: string;
    downloadUrl: string;
    downloadExpiresIn: number;
  };
  manifest: SkillReleaseManifest;
  releaseId: string;
  releaseNotes: string;
  skillId: string;
  version: string;
};

export interface SkillsRepository {
  list(query?: SkillListQuery): Promise<SkillSummary[]>;
  findById(id: string): Promise<SkillDetail | null>;
  createSkill(input: CreateSkillInput): Promise<SkillDetail>;
  updateSkill(id: string, input: UpdateSkillInput): Promise<SkillDetail | null>;
  createRelease(input: CreateSkillReleaseInput): Promise<PublishSkillReleaseResponse>;
}

export const SKILLS_REPOSITORY = Symbol("SKILLS_REPOSITORY");
