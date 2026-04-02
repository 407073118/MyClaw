export type CloudHubItemType = "skill" | "mcp" | "employee-package" | "workflow-package";

export type CloudSkillCategory =
  | "ai-assistant"
  | "data-analysis"
  | "dev-tools"
  | "writing"
  | "productivity"
  | "design"
  | "education"
  | "other";

export type CloudSkillSummary = {
  id: string;
  name: string;
  summary: string;
  description: string;
  icon: string;
  category: CloudSkillCategory;
  tags: string[];
  author: string;
  downloadCount: number;
  latestVersion: string;
  latestReleaseId: string;
  updatedAt: string;
};

export type CloudSkillDetail = CloudSkillSummary & {
  releases: Array<{
    id: string;
    version: string;
    releaseNotes: string;
  }>;
  readme: string;
  createdAt: string;
};

export type CloudHubItem = {
  id: string;
  type: CloudHubItemType;
  name: string;
  summary: string;
  latestVersion: string;
  iconUrl: string | null;
};

export type CloudHubRelease = {
  id: string;
  version: string;
  releaseNotes: string;
};

export type CloudHubItemDetail = {
  id: string;
  type: CloudHubItemType;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
  releases: CloudHubRelease[];
};

export type CloudSkillManifest = {
  kind: "skill";
  name: string;
  version: string;
  description: string;
  entry: string;
};

export type CloudMcpManifest = {
  kind: "mcp";
  name: string;
  version: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  endpoint?: string;
};

export type CloudEmployeePackageManifest = {
  kind: "employee-package";
  name: string;
  version: string;
  description: string;
  role: string;
  defaultWorkflowIds?: string[];
};

export type CloudWorkflowPackageManifest = {
  kind: "workflow-package";
  name: string;
  version: string;
  description: string;
  entryWorkflowId: string;
};

export type CloudHubManifest =
  | CloudSkillManifest
  | CloudMcpManifest
  | CloudEmployeePackageManifest
  | CloudWorkflowPackageManifest;

export type CloudDownloadToken = {
  downloadUrl: string;
  expiresIn: number;
};

function buildRuntimeProxyUrl(runtimeBaseUrl: string, path: string, configure?: (url: URL) => void): string {
  const url = new URL(path, runtimeBaseUrl);
  configure?.(url);
  return url.toString();
}

function buildProxyHeaders(accessToken?: string): HeadersInit | undefined {
  if (!accessToken?.trim()) {
    return undefined;
  }

  return {
    authorization: `Bearer ${accessToken.trim()}`,
  };
}

async function readJson<T>(url: string, accessToken?: string): Promise<T> {
  const headers = buildProxyHeaders(accessToken);
  const response = headers ? await fetch(url, { headers }) : await fetch(url);

  if (!response.ok) {
    throw new Error(`Cloud hub request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

/** 通过 runtime 代理读取云端 Skills 列表。 */
export async function fetchCloudSkills(
  runtimeBaseUrl: string,
  query?: { category?: CloudSkillCategory; keyword?: string; sort?: "latest" | "downloads" | "name"; tag?: string },
  accessToken?: string,
): Promise<CloudSkillSummary[]> {
  const payload = await readJson<{ skills: CloudSkillSummary[] }>(
    buildRuntimeProxyUrl(runtimeBaseUrl, "/api/cloud-hub/skills", (url) => {
      if (query?.category) url.searchParams.set("category", query.category);
      if (query?.keyword) url.searchParams.set("keyword", query.keyword);
      if (query?.sort) url.searchParams.set("sort", query.sort);
      if (query?.tag) url.searchParams.set("tag", query.tag);
    }),
    accessToken,
  );
  return payload.skills;
}

/** 通过 runtime 代理读取云端 Skill 详情。 */
export async function fetchCloudSkillDetail(
  runtimeBaseUrl: string,
  skillId: string,
  accessToken?: string,
): Promise<CloudSkillDetail> {
  return readJson<CloudSkillDetail>(
    buildRuntimeProxyUrl(runtimeBaseUrl, `/api/cloud-hub/skills/${encodeURIComponent(skillId)}`),
    accessToken,
  );
}

/** 通过 runtime 代理读取云端 Hub 列表，避免桌面前端直接跨域访问外部服务。 */
export async function fetchCloudHubItems(
  runtimeBaseUrl: string,
  type: "all" | CloudHubItemType,
  accessToken?: string,
): Promise<CloudHubItem[]> {
  const payload = await readJson<{ items: CloudHubItem[] }>(
    buildRuntimeProxyUrl(runtimeBaseUrl, "/api/cloud-hub/items", (url) => {
      if (type !== "all") {
        url.searchParams.set("type", type);
      }
    }),
    accessToken,
  );
  return payload.items;
}

export async function fetchCloudHubDetail(
  runtimeBaseUrl: string,
  itemId: string,
  accessToken?: string,
): Promise<CloudHubItemDetail> {
  return readJson<CloudHubItemDetail>(
    buildRuntimeProxyUrl(runtimeBaseUrl, `/api/cloud-hub/items/${encodeURIComponent(itemId)}`),
    accessToken,
  );
}

export async function fetchCloudHubManifest(
  runtimeBaseUrl: string,
  releaseId: string,
  accessToken?: string,
): Promise<CloudHubManifest> {
  return readJson<CloudHubManifest>(
    buildRuntimeProxyUrl(runtimeBaseUrl, `/api/cloud-hub/releases/${encodeURIComponent(releaseId)}/manifest`),
    accessToken,
  );
}

export async function fetchCloudHubDownloadToken(
  runtimeBaseUrl: string,
  releaseId: string,
  accessToken?: string,
): Promise<CloudDownloadToken> {
  return readJson<CloudDownloadToken>(
    buildRuntimeProxyUrl(
      runtimeBaseUrl,
      `/api/cloud-hub/releases/${encodeURIComponent(releaseId)}/download-token`,
    ),
    accessToken,
  );
}
