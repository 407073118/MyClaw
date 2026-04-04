import type {
  CreateSkillInput,
  PublishSkillReleaseResponse,
  SkillDetail,
  SkillListQuery,
  SkillReleaseManifest,
  SkillSummary,
  UpdateSkillInput
} from "@myclaw-cloud/shared";

/** 创建 Skill 发布版本时写入仓储的输入结构。 */
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

/** Skill 仓储接口，封装列表、详情、更新与发布能力。 */
export interface SkillsRepository {
  /** 按查询条件列出 Skill 摘要。 */
  list(query?: SkillListQuery): Promise<SkillSummary[]>;
  /** 根据 ID 查询 Skill 详情。 */
  findById(id: string): Promise<SkillDetail | null>;
  /** 创建新的 Skill 条目。 */
  createSkill(input: CreateSkillInput): Promise<SkillDetail>;
  /** 更新指定 Skill 的基础信息。 */
  updateSkill(id: string, input: UpdateSkillInput): Promise<SkillDetail | null>;
  /** 为 Skill 创建新的发布版本。 */
  createRelease(input: CreateSkillReleaseInput): Promise<PublishSkillReleaseResponse>;
}

export const SKILLS_REPOSITORY = Symbol("SKILLS_REPOSITORY");
