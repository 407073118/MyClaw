import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export interface OnlineDesktopDevice {
  deviceId: string;
  userId: string;
  connectionId: string;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
  });

  /** 写入桌面设备在线状态，并设置自动过期时间。 */
  async setDeviceOnline(deviceId: string, userId: string, connectionId: string, ttlSeconds = 60): Promise<void> {
    console.info("[redis] 开始写入桌面设备在线状态", { deviceId, userId, connectionId, ttlSeconds });
    try {
      await this.redis.connect().catch((error: Error) => {
        if (!String(error.message).includes("already connecting")) {
          throw error;
        }
      });
      await this.redis.set(this.buildDeviceKey(deviceId), JSON.stringify({ deviceId, userId, connectionId }), "EX", ttlSeconds);
      console.info("[redis] 桌面设备在线状态写入成功", { deviceId, userId, connectionId });
    } catch (error) {
      console.error("[redis] 桌面设备在线状态写入失败", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 刷新桌面设备在线状态过期时间，用于心跳续租。 */
  async refreshDeviceOnline(deviceId: string, ttlSeconds = 60): Promise<void> {
    console.info("[redis] 开始刷新桌面设备在线状态", { deviceId, ttlSeconds });
    try {
      await this.redis.expire(this.buildDeviceKey(deviceId), ttlSeconds);
      console.info("[redis] 桌面设备在线状态刷新成功", { deviceId });
    } catch (error) {
      console.error("[redis] 桌面设备在线状态刷新失败", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 查询桌面设备在线状态，返回当前连接标识。 */
  async getOnlineDevice(deviceId: string): Promise<OnlineDesktopDevice | undefined> {
    console.info("[redis] 开始查询桌面设备在线状态", { deviceId });
    try {
      const value = await this.redis.get(this.buildDeviceKey(deviceId));
      if (!value) {
        console.warn("[redis] 桌面设备不在线", { deviceId });
        return undefined;
      }

      const onlineDevice = JSON.parse(value) as OnlineDesktopDevice;
      console.info("[redis] 桌面设备在线状态查询成功", { deviceId });
      return onlineDevice;
    } catch (error) {
      console.error("[redis] 桌面设备在线状态查询失败", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 移除桌面设备在线状态，用于连接断开和安全替换。 */
  async removeDevice(deviceId: string): Promise<void> {
    console.info("[redis] 开始移除桌面设备在线状态", { deviceId });
    try {
      await this.redis.del(this.buildDeviceKey(deviceId));
      console.info("[redis] 桌面设备在线状态移除成功", { deviceId });
    } catch (error) {
      console.error("[redis] 桌面设备在线状态移除失败", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 关闭 Redis 连接，避免服务退出时遗留网络连接。 */
  async onModuleDestroy(): Promise<void> {
    console.info("[redis] 开始关闭 Redis 连接");
    this.redis.disconnect();
    console.info("[redis] Redis 连接已关闭");
  }

  /** 构建桌面设备在线状态 Redis 键。 */
  private buildDeviceKey(deviceId: string): string {
    const key = `realtime-bridge:desktop-device:${deviceId}`;
    console.info("[redis] 构建桌面设备在线状态键成功", { deviceId, key });
    return key;
  }
}
