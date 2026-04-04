import { Module } from "@nestjs/common";

import { McpController } from "./controllers/mcp.controller";
import { MCP_REPOSITORY } from "./ports/mcp.repository";
import { McpService } from "./services/mcp.service";
import { PrismaMcpRepository } from "./repositories/prisma-mcp.repository";

@Module({
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
