import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infra/prisma/prisma.module";
import { DingTalkRelayClient } from "./dingtalk-relay.client";
import { OutboundService } from "./outbound.service";

@Module({
  imports: [PrismaModule],
  providers: [DingTalkRelayClient, OutboundService],
  exports: [DingTalkRelayClient, OutboundService],
})
export class OutboundModule {}
