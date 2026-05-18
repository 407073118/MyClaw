import { Module } from "@nestjs/common";

import { RedisModule } from "../../infra/redis/redis.module";
import { DesktopConnectionRegistry } from "./desktop-connection.registry";
import { DesktopWsGateway } from "./desktop-ws.gateway";

@Module({
  imports: [RedisModule],
  providers: [DesktopConnectionRegistry, DesktopWsGateway],
  exports: [DesktopConnectionRegistry],
})
export class DesktopWsModule {}
