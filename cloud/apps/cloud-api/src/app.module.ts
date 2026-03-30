import { Module } from "@nestjs/common";

import { ArtifactModule } from "./modules/artifact/artifact.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DatabaseModule } from "./modules/database/database.module";
import { HubModule } from "./modules/hub/hub.module";
import { InstallModule } from "./modules/install/install.module";
import { McpModule } from "./modules/mcp/mcp.module";
import { SkillsModule } from "./modules/skills/skills.module";

@Module({
  imports: [DatabaseModule, AuthModule, HubModule, ArtifactModule, InstallModule, McpModule, SkillsModule]
})
export class AppModule {}
