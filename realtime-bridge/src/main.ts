import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

/** 启动 realtime-bridge HTTP 服务，后续 WebSocket 会挂载到同一 HTTP Server。 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const port = Number(process.env.PORT ?? 4300);
  await app.listen(port);
  console.info("[bootstrap] realtime-bridge 已启动", { port });
}

void bootstrap().catch((error) => {
  console.error("[bootstrap] realtime-bridge 启动失败", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
