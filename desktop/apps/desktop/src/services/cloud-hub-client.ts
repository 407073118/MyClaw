export type CloudHubItemType = "skill" | "mcp" | "employee-package" | "workflow-package";

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

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Cloud hub request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

/** 通过 runtime 代理读取云端 Hub 列表，避免桌面前端直接跨域访问外部服务。 */
export async function fetchCloudHubItems(
  runtimeBaseUrl: string,
  type: "all" | CloudHubItemType,
): Promise<CloudHubItem[]> {
  const payload = await readJson<{ items: CloudHubItem[] }>(
    buildRuntimeProxyUrl(runtimeBaseUrl, "/api/cloud-hub/items", (url) => {
      if (type !== "all") {
        url.searchParams.set("type", type);
      }
    }),
  );
  return payload.items;
}

export async function fetchCloudHubDetail(runtimeBaseUrl: string, itemId: string): Promise<CloudHubItemDetail> {
  return readJson<CloudHubItemDetail>(
    buildRuntimeProxyUrl(runtimeBaseUrl, `/api/cloud-hub/items/${encodeURIComponent(itemId)}`),
  );
}

export async function fetchCloudHubManifest(runtimeBaseUrl: string, releaseId: string): Promise<CloudHubManifest> {
  return readJson<CloudHubManifest>(
    buildRuntimeProxyUrl(runtimeBaseUrl, `/api/cloud-hub/releases/${encodeURIComponent(releaseId)}/manifest`),
  );
}

export async function fetchCloudHubDownloadToken(
  runtimeBaseUrl: string,
  releaseId: string,
): Promise<CloudDownloadToken> {
  return readJson<CloudDownloadToken>(
    buildRuntimeProxyUrl(
      runtimeBaseUrl,
      `/api/cloud-hub/releases/${encodeURIComponent(releaseId)}/download-token`,
    ),
  );
}
