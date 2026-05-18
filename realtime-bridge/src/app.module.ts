import { Module } from "@nestjs/common";

import { DesktopWsModule } from "./modules/desktop-ws/desktop-ws.module";
import { HealthModule } from "./modules/health/health.module";
import { IngressModule } from "./modules/ingress/ingress.module";

@Module({
  imports: [HealthModule, IngressModule, DesktopWsModule],
})
export class AppModule {}
