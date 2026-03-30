import type {
  CreateMcpItemResponse,
  McpItemDetail,
  McpItemSummary,
  McpReleaseDetail,
  McpServerConfig,
  PublishMcpReleaseResponse
} from "@myclaw-cloud/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { MCP_REPOSITORY, type McpRepository } from "./mcp.repository";

type PublishReleaseInput = {
  version: string;
  releaseNotes: string;
  config: McpServerConfig;
};

type CreateWithInitialReleaseInput = {
  id: string;
  name: string;
  summary: string;
  description: string;
  version: string;
  releaseNotes: string;
  config: McpServerConfig;
};

@Injectable()
export class McpService {
  constructor(
    @Inject(MCP_REPOSITORY)
    private readonly mcpRepository: McpRepository
  ) {}

  /** 获取所有 MCP 条目列表 */
  list(): Promise<McpItemSummary[]> {
    return this.mcpRepository.list();
  }

  /** 根据 ID 查找 MCP 条目详情 */
  findById(id: string): Promise<McpItemDetail | null> {
    return this.mcpRepository.findById(id);
  }

  /** 获取指定版本的配置详情 */
  findReleaseById(releaseId: string): Promise<McpReleaseDetail | null> {
    return this.mcpRepository.findReleaseById(releaseId);
  }

  /** 发布 MCP 新版本 */
  async publishRelease(itemId: string, input: PublishReleaseInput): Promise<PublishMcpReleaseResponse> {
    const item = await this.mcpRepository.findById(itemId);
    if (!item) {
      throw new NotFoundException("mcp_item_not_found");
    }

    this.validateConfig(input.config);

    const version = input.version.trim();
    const releaseNotes = input.releaseNotes.trim();
    const releaseId = this.buildReleaseId(itemId, version);

    const release = await this.mcpRepository.createRelease({
      releaseId,
      itemId,
      version,
      releaseNotes,
      config: input.config,
      latestVersion: version
    });

    return { itemId, release };
  }

  /** 创建 MCP 条目并发布初始版本 */
  async createWithInitialRelease(input: CreateWithInitialReleaseInput): Promise<CreateMcpItemResponse> {
    const itemId = input.id.trim();
    const existing = await this.mcpRepository.findById(itemId);
    if (existing) {
      throw new BadRequestException("mcp_item_already_exists");
    }

    this.validateConfig(input.config);

    const version = input.version.trim();
    const item = await this.mcpRepository.createItem({
      id: itemId,
      name: input.name.trim(),
      summary: input.summary.trim(),
      description: input.description.trim(),
      latestVersion: version
    });

    const releaseId = this.buildReleaseId(itemId, version);
    const release = await this.mcpRepository.createRelease({
      releaseId,
      itemId,
      version,
      releaseNotes: input.releaseNotes.trim(),
      config: input.config,
      latestVersion: version
    });

    return { item, release };
  }

  /** 校验 MCP 服务器配置的有效性 */
  private validateConfig(config: McpServerConfig): void {
    if (!config || !config.transport) {
      throw new BadRequestException("mcp_config_transport_required");
    }

    if (config.transport === "stdio") {
      if (!config.command?.trim()) {
        throw new BadRequestException("mcp_stdio_command_required");
      }
    } else if (config.transport === "sse" || config.transport === "streamable-http") {
      if (!config.url?.trim()) {
        throw new BadRequestException("mcp_remote_url_required");
      }
    } else {
      throw new BadRequestException("mcp_config_invalid_transport");
    }
  }

  /** 构建版本 ID */
  private buildReleaseId(itemId: string, version: string): string {
    return `release-${itemId}-${version}`;
  }
}
