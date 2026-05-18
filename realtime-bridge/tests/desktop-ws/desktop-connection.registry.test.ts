import { describe, expect, it, vi } from "vitest";

import { DesktopConnectionRegistry } from "../../src/modules/desktop-ws/desktop-connection.registry";

class FakeRedisService {
  onlineDevices = new Map<string, { userId: string; connectionId: string }>();

  /** 测试替身记录设备在线状态，模拟 Redis 写入成功。 */
  async setDeviceOnline(deviceId: string, userId: string, connectionId: string): Promise<void> {
    this.onlineDevices.set(deviceId, { userId, connectionId });
  }

  /** 测试替身移除设备在线状态，模拟 Redis 删除成功。 */
  async removeDevice(deviceId: string): Promise<void> {
    this.onlineDevices.delete(deviceId);
  }
}

class FakePrismaService {
  desktopDevice = {
    upsert: vi.fn(async () => ({})),
  };
}

const createSocket = () => ({
  send: vi.fn(),
  close: vi.fn(),
});

describe("DesktopConnectionRegistry", () => {
  it("registers a device as online", async () => {
    const redis = new FakeRedisService();
    const registry = new DesktopConnectionRegistry(redis as any);
    const socket = createSocket();

    await registry.register({
      connectionId: "conn-1",
      userId: "user-1",
      deviceId: "device-1",
      socket: socket as any,
    });

    expect(registry.getConnection("device-1")?.connectionId).toBe("conn-1");
    expect(redis.onlineDevices.get("device-1")).toEqual({
      userId: "user-1",
      connectionId: "conn-1",
    });
  });

  it("upserts desktop device row before marking connection online", async () => {
    const redis = new FakeRedisService();
    const prisma = new FakePrismaService();
    const registry = new DesktopConnectionRegistry(redis as any, prisma as any);

    await registry.register({
      connectionId: "conn-1",
      userId: "user-1",
      deviceId: "device-1",
      socket: createSocket() as any,
    });

    expect(prisma.desktopDevice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "device-1" },
      create: expect.objectContaining({
        id: "device-1",
        myclawUserId: "user-1",
      }),
      update: expect.objectContaining({
        myclawUserId: "user-1",
      }),
    }));
  });

  it("disconnects a device and removes online status", async () => {
    const redis = new FakeRedisService();
    const registry = new DesktopConnectionRegistry(redis as any);

    await registry.register({
      connectionId: "conn-1",
      userId: "user-1",
      deviceId: "device-1",
      socket: createSocket() as any,
    });
    await registry.disconnect("conn-1");

    expect(registry.getConnection("device-1")).toBeUndefined();
    expect(redis.onlineDevices.has("device-1")).toBe(false);
  });

  it("keeps only one active device per user", async () => {
    const redis = new FakeRedisService();
    const registry = new DesktopConnectionRegistry(redis as any);
    const oldSocket = createSocket();

    await registry.register({
      connectionId: "conn-1",
      userId: "user-1",
      deviceId: "device-1",
      socket: oldSocket as any,
    });
    await registry.register({
      connectionId: "conn-2",
      userId: "user-1",
      deviceId: "device-2",
      socket: createSocket() as any,
    });

    expect(registry.getConnection("device-1")).toBeUndefined();
    expect(registry.getConnection("device-2")?.connectionId).toBe("conn-2");
    expect(oldSocket.close).toHaveBeenCalled();
    expect(redis.onlineDevices.has("device-1")).toBe(false);
  });

  it("replaces an old connection for the same device", async () => {
    const redis = new FakeRedisService();
    const registry = new DesktopConnectionRegistry(redis as any);
    const oldSocket = createSocket();

    await registry.register({
      connectionId: "conn-1",
      userId: "user-1",
      deviceId: "device-1",
      socket: oldSocket as any,
    });
    await registry.register({
      connectionId: "conn-2",
      userId: "user-1",
      deviceId: "device-1",
      socket: createSocket() as any,
    });

    expect(registry.getConnection("device-1")?.connectionId).toBe("conn-2");
    expect(oldSocket.close).toHaveBeenCalled();
    expect(redis.onlineDevices.get("device-1")?.connectionId).toBe("conn-2");
  });
});
