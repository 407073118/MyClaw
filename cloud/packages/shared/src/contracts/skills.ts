export type SkillCategory =
  | "ai-assistant"
  | "data-analysis"
  | "dev-tools"
  | "writing"
  | "productivity"
  | "design"
  | "education"
  | "other";

export const SKILL_CATEGORIES: { value: SkillCategory; label: string }[] = [
  { value: "ai-assistant", label: "AI 助手" },
  { value: "data-analysis", label: "数据分析" },
  { value: "dev-tools", label: "开发工具" },
  { value: "writing", label: "文档写作" },
  { value: "productivity", label: "效率工具" },
  { value: "design", label: "设计创意" },
  { value: "education", label: "教育学习" },
  { value: "other", label: "其他" },
];

export type SkillSummary = {
  id: string;
  name: string;
  summary: string;
  description: string;
  icon: string;
  category: SkillCategory;
  tags: string[];
  author: string;
  downloadCount: number;
  latestVersion: string | null;
  latestReleaseId: string | null;
  updatedAt: string;
};

export type SkillReleaseSummary = {
  id: string;
  version: string;
  releaseNotes: string;
  createdAt: string;
};

export type SkillReleaseManifest = {
  name: string;
  version: string;
  entryFile: string;
  readme: string;
};

export type SkillDetail = SkillSummary & {
  releases: SkillReleaseSummary[];
  readme: string;
  createdAt: string;
};

export type CreateSkillInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
  icon?: string;
  category?: SkillCategory;
  tags?: string[];
  author?: string;
};

export type UpdateSkillInput = {
  name?: string;
  summary?: string;
  description?: string;
  icon?: string;
  category?: SkillCategory;
  tags?: string[];
  author?: string;
};

export type CreateSkillResponse = {
  skill: SkillDetail;
};

export type PublishSkillReleaseResponse = {
  skillId: string;
  releaseId: string;
  version: string;
  releaseNotes: string;
  manifest: SkillReleaseManifest;
  artifact: {
    fileName: string;
    fileSize: number;
    downloadUrl: string;
    expiresIn: number;
  };
};

export type SkillListQuery = {
  category?: SkillCategory;
  keyword?: string;
  sort?: "latest" | "downloads" | "name";
  tag?: string;
};
