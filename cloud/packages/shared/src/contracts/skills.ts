export type SkillSummary = {
  id: string;
  name: string;
  summary: string;
  description: string;
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
  createdAt: string;
};

export type CreateSkillInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
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
