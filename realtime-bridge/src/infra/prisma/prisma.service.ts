import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** 连接 MySQL 数据库，确保服务启动前 Prisma 客户端可用。 */
  async onModuleInit(): Promise<void> {
    console.info("[prisma] 开始连接 MySQL 数据库");
    try {
      await this.$connect();
      console.info("[prisma] MySQL 数据库连接成功");
    } catch (error) {
      console.error("[prisma] MySQL 数据库连接失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 关闭 MySQL 数据库连接，避免进程退出时遗留连接。 */
  async onModuleDestroy(): Promise<void> {
    console.info("[prisma] 开始关闭 MySQL 数据库连接");
    try {
      await this.$disconnect();
      console.info("[prisma] MySQL 数据库连接已关闭");
    } catch (error) {
      console.error("[prisma] MySQL 数据库连接关闭失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
