import { Module } from "@nestjs/common";

import { HealthModule } from "./modules/health/health.module";
import { IngressModule } from "./modules/ingress/ingress.module";

@Module({
  imports: [HealthModule, IngressModule],
})
export class AppModule {}
