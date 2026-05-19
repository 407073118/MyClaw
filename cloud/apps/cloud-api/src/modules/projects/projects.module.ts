import { Module } from "@nestjs/common";

import { ProjectsController } from "./controllers/projects.controller";
import { PROJECTS_REPOSITORY } from "./ports/projects.repository";
import { PrismaProjectsRepository } from "./repositories/prisma-projects.repository";
import { ProjectsService } from "./services/projects.service";

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PrismaProjectsRepository,
    {
      provide: PROJECTS_REPOSITORY,
      useExisting: PrismaProjectsRepository
    }
  ]
})
export class ProjectsModule {}
