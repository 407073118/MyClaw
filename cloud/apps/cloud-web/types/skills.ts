export type {
  CreateSkillInput,
  CreateSkillResponse,
  PublishSkillReleaseResponse,
  SkillDetail,
  SkillReleaseSummary,
  SkillSummary
} from "@myclaw-cloud/shared";

export type SkillFileRecord = {
  name: string;
  content: string;
};

export type LocalSkill = {
  id: string;
  name: string;
  version: string;
  description: string;
  files: SkillFileRecord[];
};

export type SkillTreeFileNode = {
  type: "file";
  name: string;
  path: string;
};

export type SkillTreeDirectoryNode = {
  type: "directory";
  name: string;
  path: string;
  children: SkillTreeNode[];
};

export type SkillTreeNode = SkillTreeFileNode | SkillTreeDirectoryNode;
