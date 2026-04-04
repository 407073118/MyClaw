import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { ArtifactController } from "./controllers/artifact.controller";
import { ARTIFACT_STORAGE_PORT } from "./ports/artifact-storage.port";
import { ArtifactService } from "./services/artifact.service";
import { FastdfsArtifactStorage } from "./providers/fastdfs-artifact-storage";

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
