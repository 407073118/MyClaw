import type {
  McpItemDetail,
  McpReleaseUploadResponse,
  McpManifest,
  McpItemSummary
} from "@myclaw-cloud/shared";

export type CreateMcpItemRecordInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
};

export type CreateMcpReleaseInput = {
  artifact: {
    fileName: string;
    fileSize: number;
    storagePath: string;
    downloadUrl: string;
    downloadExpiresIn: number;
  };
  itemId: string;
  latestVersion: string;
  manifest: McpManifest;
  releaseId: string;
  releaseNotes: string;
  version: string;
};

export interface McpRepository {
  list(): Promise<McpItemSummary[]>;
  findById(id: string): Promise<McpItemDetail | null>;
  createItem(input: CreateMcpItemRecordInput): Promise<McpItemDetail>;
  createRelease(input: CreateMcpReleaseInput): Promise<McpReleaseUploadResponse>;
}

export const MCP_REPOSITORY = Symbol("MCP_REPOSITORY");
