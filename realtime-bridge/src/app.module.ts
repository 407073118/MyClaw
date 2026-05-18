import { Module } from "@nestjs/common";

import { DesktopWsModule } from "./modules/desktop-ws/desktop-ws.module";
import { ConversationModule } from "./modules/conversation/conversation.module";
import { HealthModule } from "./modules/health/health.module";
import { IngressModule } from "./modules/ingress/ingress.module";
import { RoutingModule } from "./modules/routing/routing.module";

@Module({
  imports: [HealthModule, IngressModule, DesktopWsModule, ConversationModule, RoutingModule],
})
export class AppModule {}
