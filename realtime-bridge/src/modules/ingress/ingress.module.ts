import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infra/prisma/prisma.module";
import { ConversationModule } from "../conversation/conversation.module";
import { DeliveryModule } from "../delivery/delivery.module";
import { RoutingModule } from "../routing/routing.module";
import { IngressController } from "./ingress.controller";
import { IngressService } from "./ingress.service";

@Module({
  imports: [PrismaModule, ConversationModule, RoutingModule, DeliveryModule],
  controllers: [IngressController],
  providers: [IngressService],
  exports: [IngressService],
})
export class IngressModule {}
