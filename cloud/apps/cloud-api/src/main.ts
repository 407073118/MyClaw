import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { loadRuntimeEnv } from "./runtime/load-runtime-env";

async function bootstrap() {
  // 中文注释：先加载运行时环境变量，确保 Prisma 初始化时能读取到 DATABASE_URL。
  loadRuntimeEnv();
  const app = await NestFactory.create(AppModule);
  console.info("[cloud-api] Nest 应用开始监听端口");
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 43210);
}

void bootstrap();
