export type McpItemSummary = {
  id: string;
  name: string;
  summary: string;
  latestVersion: string;
  iconUrl: string | null;
};

export type McpRelease = {
  id: string;
  version: string;
  releaseNotes: string;
};

export type McpItemDetail = {
  id: string;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
  releases: McpRelease[];
};

export type CreateMcpItemInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
  version: string;
  releaseNotes: string;
};

export type McpManifest = {
  kind: "mcp";
  name: string;
  version: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  endpoint?: string;
};

export type McpReleaseUploadResponse = {
  itemId: string;
  releaseId: string;
  version: string;
  latestVersion: string;
  manifest: McpManifest;
  artifact: {
    fileName: string;
    fileSize: number;
    downloadUrl: string;
    expiresIn: number;
  };
};

export type CreateMcpReleaseResponse = McpReleaseUploadResponse & {
  item: McpItemDetail;
};
