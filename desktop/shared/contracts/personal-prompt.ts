export type PersonalPromptProfile = {
  prompt: string;
  summary: string;
  tags: string[];
  updatedAt: string | null;
};

/** 创建默认的个人长期 Prompt 档案。 */
export function createDefaultPersonalPromptProfile(): PersonalPromptProfile {
  return {
    prompt: "",
    summary: "",
    tags: [],
    updatedAt: null,
  };
}
