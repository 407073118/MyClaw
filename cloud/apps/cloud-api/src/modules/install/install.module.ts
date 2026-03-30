import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InstallController } from "./install.controller";
import { INSTALL_LOG_REPOSITORY } from "./install-log.repository";
import { InstallService } from "./install.service";
import { PrismaInstallLogRepository } from "./prisma-install-log.repository";

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
