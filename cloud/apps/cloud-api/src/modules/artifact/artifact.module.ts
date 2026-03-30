import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { ArtifactController } from "./artifact.controller";
import { ARTIFACT_STORAGE_PORT } from "./artifact-storage.port";
import { ArtifactService } from "./artifact.service";
import { FastdfsArtifactStorage } from "./fastdfs-artifact-storage";

@Module({
  imports: [DatabaseModule],
  controllers: [ArtifactController],
  providers: [
    ArtifactService,
    FastdfsArtifactStorage,
    {
      provide: ARTIFACT_STORAGE_PORT,
      useExisting: FastdfsArtifactStorage
    }
  ],
  exports: [ArtifactService]
})
export class ArtifactModule {}
