import type { CreateMcpItemInput, PublishMcpReleaseInput } from "@myclaw-cloud/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post
} from "@nestjs/common";

import { McpService } from "./mcp.service";

@Controller("api/mcp")
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  /** 获取所有 MCP 条目列表 */
  @Get("items")
  async list() {
    return {
      items: await this.mcpService.list()
    };
  }

  /** 获取 MCP 条目详情 */
  @Get("items/:id")
  async detail(@Param("id") id: string) {
    const item = await this.mcpService.findById(id);
    if (!item) {
      throw new NotFoundException("mcp_item_not_found");
    }
    return item;
  }

  /** 发布 MCP 新版本 */
  @Post("items/:id/releases")
  async publishRelease(
    @Param("id") id: string,
    @Body() body: PublishMcpReleaseInput
  ) {
    this.assertReleaseBody(body);
    return this.mcpService.publishRelease(id, {
      version: body.version,
      releaseNotes: body.releaseNotes,
      config: body.config
    });
  }

  /** 创建 MCP 条目（含初始版本） */
  @Post("items")
  async createMcp(@Body() body: CreateMcpItemInput) {
    this.assertCreateBody(body);
    return this.mcpService.createWithInitialRelease({
      id: body.id,
      name: body.name,
      summary: body.summary,
      description: body.description,
      version: body.version,
      releaseNotes: body.releaseNotes,
      config: body.config
    });
  }

  /** 获取指定版本的配置详情 */
  @Get("releases/:releaseId")
  async releaseDetail(@Param("releaseId") releaseId: string) {
    const release = await this.mcpService.findReleaseById(releaseId);
    if (!release) {
      throw new NotFoundException("mcp_release_not_found");
    }
    return release;
  }

  /** 校验发布版本请求体 */
  private assertReleaseBody(body: PublishMcpReleaseInput): void {
    if (!body.version?.trim()) {
      throw new BadRequestException("release_version_required");
    }
    if (!body.releaseNotes?.trim()) {
      throw new BadRequestException("release_notes_required");
    }
    if (!body.config) {
      throw new BadRequestException("mcp_config_required");
    }
  }

  /** 校验创建条目请求体 */
  private assertCreateBody(body: CreateMcpItemInput): void {
    if (!body.id?.trim()) {
      throw new BadRequestException("mcp_item_id_required");
    }
    if (!body.name?.trim()) {
      throw new BadRequestException("mcp_item_name_required");
    }
    if (!body.summary?.trim()) {
      throw new BadRequestException("mcp_item_summary_required");
    }
    if (!body.description?.trim()) {
      throw new BadRequestException("mcp_item_description_required");
    }
    this.assertReleaseBody(body);
  }
}
