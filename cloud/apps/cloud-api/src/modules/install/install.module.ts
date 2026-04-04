import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InstallController } from "./controllers/install.controller";
import { INSTALL_LOG_REPOSITORY } from "./ports/install-log.repository";
import { InstallService } from "./services/install.service";
import { PrismaInstallLogRepository } from "./repositories/prisma-install-log.repository";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [InstallController],
  providers: [
    InstallService,
    PrismaInstallLogRepository,
    {
      provide: INSTALL_LOG_REPOSITORY,
      useExisting: PrismaInstallLogRepository
    }
  ],
  exports: [InstallService]
})
export class InstallModule {}
