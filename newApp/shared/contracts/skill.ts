export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
  workingDirectory?: string | null;
  entrypoint?: string | null;
  hasScriptsDirectory: boolean;
  hasReferencesDirectory: boolean;
  hasAssetsDirectory: boolean;
  hasTestsDirectory: boolean;
  hasAgentsDirectory: boolean;
  /** 该 Skill 目录下是否存在 HTML 视图文件 */
  hasViewFile: boolean;
  /** Skill 目录下所有 .html 文件名列表（如 ["view.html", "dashboard.html"]） */
  viewFiles: string[];
};

export type SkillDetail = SkillDefinition & {
  entryPath: string;
  content: string;
};
