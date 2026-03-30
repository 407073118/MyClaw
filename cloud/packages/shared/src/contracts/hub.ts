import type { EmployeePackageManifest, WorkflowPackageManifest } from "./employee-package";
import type { McpManifest } from "./mcp";

export type HubItemType = "mcp" | "employee-package" | "workflow-package";

export type HubItem = {
  id: string;
  type: HubItemType;
  name: string;
  summary: string;
  latestVersion: string;
  iconUrl: string | null;
};

export type HubRelease = {
  id: string;
  version: string;
  releaseNotes: string;
};

export type HubItemDetail = {
  id: string;
  type: HubItemType;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
  releases: HubRelease[];
};

export type HubManifest = McpManifest | EmployeePackageManifest | WorkflowPackageManifest;

export type DownloadTokenResponse = {
  downloadUrl: string;
  expiresIn: number;
};

export type HubReleaseUploadResponse<TManifest extends HubManifest = HubManifest> = {
  itemId: string;
  releaseId: string;
  version: string;
  latestVersion: string;
  manifest: TManifest;
  artifact: {
    fileName: string;
    fileSize: number;
    downloadUrl: string;
    expiresIn: number;
  };
};

export type EmployeePackageReleaseUploadResponse = HubReleaseUploadResponse<EmployeePackageManifest>;

export type WorkflowPackageReleaseUploadResponse = HubReleaseUploadResponse<WorkflowPackageManifest>;
