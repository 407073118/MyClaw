import { Module } from "@nestjs/common";

import { ArtifactModule } from "../artifact/artifact.module";
import { DatabaseModule } from "../database/database.module";
import { HubController } from "./controllers/hub.controller";
import { HUB_REPOSITORY } from "./ports/hub.repository";
import { HubService } from "./services/hub.service";
import { PrismaHubRepository } from "./repositories/prisma-hub.repository";

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
