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
};

export type SkillDetail = SkillDefinition & {
  entryPath: string;
  content: string;
};
