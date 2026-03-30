import { Module } from "@nestjs/common";

import { ArtifactModule } from "../artifact/artifact.module";
import { PrismaSkillsRepository } from "./prisma-skills.repository";
import { SkillsController } from "./skills.controller";
import { SKILLS_REPOSITORY } from "./skills.repository";
import { SkillsService } from "./skills.service";

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
