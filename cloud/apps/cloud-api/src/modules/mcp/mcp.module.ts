import { Module } from "@nestjs/common";

import { ArtifactModule } from "../artifact/artifact.module";
import { McpController } from "./mcp.controller";
import { MCP_REPOSITORY } from "./mcp.repository";
import { McpService } from "./mcp.service";
import { PrismaMcpRepository } from "./prisma-mcp.repository";

@Module({
  imports: [ArtifactModule],
  controllers: [McpController],
  providers: [
    McpService,
    PrismaMcpRepository,
    {
      provide: MCP_REPOSITORY,
      useExisting: PrismaMcpRepository
    }
  ]
})
export class McpModule {}
