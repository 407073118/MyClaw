import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infra/prisma/prisma.module";
import { DesktopWsModule } from "../desktop-ws/desktop-ws.module";
import { RoutingService } from "./routing.service";

@Module({
  imports: [PrismaModule, DesktopWsModule],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
