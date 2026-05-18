import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infra/prisma/prisma.module";
import { ConversationService } from "./conversation.service";

@Module({
  imports: [PrismaModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
