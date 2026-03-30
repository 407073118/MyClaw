import { Module } from "@nestjs/common";

import { ArtifactModule } from "../artifact/artifact.module";
import { DatabaseModule } from "../database/database.module";
import { HubController } from "./hub.controller";
import { HUB_REPOSITORY } from "./hub.repository";
import { HubService } from "./hub.service";
import { PrismaHubRepository } from "./prisma-hub.repository";

@Module({
  imports: [ArtifactModule, DatabaseModule],
  controllers: [HubController],
  providers: [
    HubService,
    PrismaHubRepository,
    {
      provide: HUB_REPOSITORY,
      useExisting: PrismaHubRepository
    }
  ],
  exports: [HubService]
})
export class HubModule {}
