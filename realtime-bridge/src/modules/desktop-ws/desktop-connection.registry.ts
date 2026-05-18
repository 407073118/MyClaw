import { Inject, Injectable } from "@nestjs/common";
import type { WebSocket } from "ws";

import { RedisService } from "../../infra/redis/redis.service";

export interface DesktopConnection {
  connectionId: string;
  userId: string;
  deviceId: string;
  socket: Pick<WebSocket, "send" | "close">;
}

export interface RegisterDesktopConnectionInput extends DesktopConnection {}

@Injectable()
export class DesktopConnectionRegistry {
  private readonly byDeviceId = new Map<string, DesktopConnection>();
  private readonly byConnectionId = new Map<string, DesktopConnection>();
  private readonly activeDeviceByUserId = new Map<string, string>();

  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  /** 注册桌面端连接，并保证同一用户只有一个在线设备。 */
  async register(input: RegisterDesktopConnectionInput): Promise<void> {
    console.info("[desktop-ws] 开始注册桌面端连接", {
      connectionId: input.connectionId,
      userId: input.userId,
      deviceId: input.deviceId,
    });

    const existingUserDeviceId = this.activeDeviceByUserId.get(input.userId);
    if (existingUserDeviceId && existingUserDeviceId !== input.deviceId) {
      console.warn("[desktop-ws] 同一用户已有在线设备，准备替换旧设备", {
        userId: input.userId,
        oldDeviceId: existingUserDeviceId,
        newDeviceId: input.deviceId,
      });
      await this.removeByDeviceId(existingUserDeviceId, true);
    }

    const existingDeviceConnection = this.byDeviceId.get(input.deviceId);
    if (existingDeviceConnection) {
      console.warn("[desktop-ws] 同一设备已有旧连接，准备替换旧连接", {
        deviceId: input.deviceId,
        oldConnectionId: existingDeviceConnection.connectionId,
        newConnectionId: input.connectionId,
      });
      await this.removeByDeviceId(input.deviceId, true);
    }

    this.byDeviceId.set(input.deviceId, input);
    this.byConnectionId.set(input.connectionId, input);
    this.activeDeviceByUserId.set(input.userId, input.deviceId);
    await this.redisService.setDeviceOnline(input.deviceId, input.userId, input.connectionId, 60);
    console.info("[desktop-ws] 桌面端连接注册成功", {
      connectionId: input.connectionId,
      userId: input.userId,
      deviceId: input.deviceId,
    });
  }

  /** 根据连接编号断开桌面端连接，并清理内存与 Redis 在线状态。 */
  async disconnect(connectionId: string): Promise<void> {
    console.info("[desktop-ws] 开始断开桌面端连接", { connectionId });
    const connection = this.byConnectionId.get(connectionId);
    if (!connection) {
      console.warn("[desktop-ws] 断开连接时未找到连接记录", { connectionId });
      return;
    }

    await this.removeByDeviceId(connection.deviceId, false);
    console.info("[desktop-ws] 桌面端连接断开成功", { connectionId });
  }

  /** 刷新桌面设备心跳租约，保持 Redis 在线状态。 */
  async refreshHeartbeat(deviceId: string): Promise<void> {
    console.info("[desktop-ws] 开始刷新桌面端心跳", { deviceId });
    await this.redisService.refreshDeviceOnline(deviceId, 60);
    console.info("[desktop-ws] 桌面端心跳刷新成功", { deviceId });
  }

  /** 查询指定设备的当前连接。 */
  getConnection(deviceId: string): DesktopConnection | undefined {
    const connection = this.byDeviceId.get(deviceId);
    console.info("[desktop-ws] 查询桌面端连接", {
      deviceId,
      found: Boolean(connection),
    });
    return connection;
  }

  /** 查询指定用户当前在线的主设备编号。 */
  getActiveDeviceId(userId: string): string | undefined {
    const deviceId = this.activeDeviceByUserId.get(userId);
    console.info("[desktop-ws] 查询用户在线设备", { userId, deviceId });
    return deviceId;
  }

  /** 向指定设备发送桥接消息，设备离线时返回 false。 */
  sendToDevice(deviceId: string, message: unknown): boolean {
    const connection = this.byDeviceId.get(deviceId);
    if (!connection) {
      console.warn("[desktop-ws] 设备离线，无法发送桥接消息", { deviceId });
      return false;
    }

    connection.socket.send(JSON.stringify(message));
    console.info("[desktop-ws] 桥接消息发送到桌面端成功", { deviceId });
    return true;
  }

  /** 按设备编号移除连接记录，并按需关闭旧 WebSocket。 */
  private async removeByDeviceId(deviceId: string, closeSocket: boolean): Promise<void> {
    const connection = this.byDeviceId.get(deviceId);
    if (!connection) {
      console.warn("[desktop-ws] 移除设备连接时未找到记录", { deviceId });
      return;
    }

    this.byDeviceId.delete(deviceId);
    this.byConnectionId.delete(connection.connectionId);
    if (this.activeDeviceByUserId.get(connection.userId) === deviceId) {
      this.activeDeviceByUserId.delete(connection.userId);
    }

    if (closeSocket) {
      connection.socket.close();
      console.warn("[desktop-ws] 已关闭被替换的桌面端旧连接", {
        deviceId,
        connectionId: connection.connectionId,
      });
    }

    await this.redisService.removeDevice(deviceId);
    console.info("[desktop-ws] 设备连接记录移除成功", { deviceId });
  }
}
