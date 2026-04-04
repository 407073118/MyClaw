import type {
  McpItemDetail,
  McpItemSummary,
  McpReleaseDetail,
  McpServerConfig
} from "@myclaw-cloud/shared";

/** 创建 MCP 条目时写入仓储的输入结构。 */
export type CreateMcpItemRecordInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
  latestVersion: string;
};

/** 创建 MCP 版本时写入仓储的输入结构。 */
export type CreateMcpReleaseRecordInput = {
  releaseId: string;
  itemId: string;
  version: string;
  releaseNotes: string;
  config: McpServerConfig;
  latestVersion: string;
};

/** MCP 仓储接口，封装条目、版本与详情查询能力。 */
export interface McpRepository {
  /** 获取所有 MCP 条目列表。 */
  list(): Promise<McpItemSummary[]>;
  /** 根据 ID 查找 MCP 条目详情。 */
  findById(id: string): Promise<McpItemDetail | null>;
  /** 创建 MCP 条目。 */
  createItem(input: CreateMcpItemRecordInput): Promise<McpItemDetail>;
  /** 创建 MCP 版本。 */
  createRelease(input: CreateMcpReleaseRecordInput): Promise<McpReleaseDetail>;
  /** 根据版本 ID 获取版本详情。 */
  findReleaseById(releaseId: string): Promise<McpReleaseDetail | null>;
}

export const MCP_REPOSITORY = Symbol("MCP_REPOSITORY");
