import { Module } from "@nestjs/common";

import { ArtifactModule } from "../artifact/artifact.module";
import { PrismaSkillsRepository } from "./repositories/prisma-skills.repository";
import { SkillsController } from "./controllers/skills.controller";
import { SKILLS_REPOSITORY } from "./ports/skills.repository";
import { SkillsService } from "./services/skills.service";

@Module({
  imports: [ArtifactModule],
  controllers: [SkillsController],
  providers: [
    SkillsService,
    PrismaSkillsRepository,
    {
      provide: SKILLS_REPOSITORY,
      useExisting: PrismaSkillsRepository
    }
  ]
})
export class SkillsModule {}
