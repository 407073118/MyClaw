import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infra/prisma/prisma.module";
import { DesktopWsModule } from "../desktop-ws/desktop-ws.module";
import { DeliveryService } from "./delivery.service";
import { LocalSessionLockService } from "./local-session-lock.service";

@Module({
  imports: [PrismaModule, DesktopWsModule],
  providers: [DeliveryService, LocalSessionLockService],
  exports: [DeliveryService, LocalSessionLockService],
})
export class DeliveryModule {}
