import { describe, expect, it } from "vitest";

import { RoutingService } from "../../src/modules/routing/routing.service";

type Account = {
  provider: "dingtalk";
  senderStaffId: string;
  myclawUserId: string;
  enabled: boolean;
};

type Binding = {
  provider: "dingtalk";
  externalConversationId: string;
  myclawUserId: string;
  desktopDeviceId: string;
  enabled: boolean;
};

class FakePrisma {
  accounts = new Map<string, Account>();
  bindings = new Map<string, Binding>();

  channelAccount = {
    findUnique: async ({ where }: any) => this.accounts.get(`${where.provider_senderStaffId.provider}:${where.provider_senderStaffId.senderStaffId}`) ?? null,
  };

  channelBinding = {
    findUnique: async ({ where }: any) => this.bindings.get(`${where.provider_externalConversationId.provider}:${where.provider_externalConversationId.externalConversationId}`) ?? null,
  };
}

class FakeRegistry {
  activeDevices = new Map<string, string>();

  /** 测试替身按用户返回在线设备编号。 */
  getActiveDeviceId(userId: string): string | undefined {
    return this.activeDevices.get(userId);
  }

  /** 测试替身按设备判断桌面端是否在线。 */
  getConnection(deviceId: string): { deviceId: string } | undefined {
    return Array.from(this.activeDevices.values()).includes(deviceId) ? { deviceId } : undefined;
  }
}

const createInput = (overrides: Partial<Parameters<RoutingService["route"]>[0]> = {}) => ({
  provider: "dingtalk" as const,
  senderStaffId: "staff-1",
  externalConversationId: "cid-1",
  conversationType: "direct" as const,
  ...overrides,
});

describe("RoutingService", () => {
  it("routes direct chat by sender account", async () => {
    const prisma = new FakePrisma();
    const registry = new FakeRegistry();
    prisma.accounts.set("dingtalk:staff-1", {
      provider: "dingtalk",
      senderStaffId: "staff-1",
      myclawUserId: "user-1",
      enabled: true,
    });
    registry.activeDevices.set("user-1", "device-1");

    const service = new RoutingService(prisma as any, registry as any);

    await expect(service.route(createInput())).resolves.toEqual({
      ok: true,
      myclawUserId: "user-1",
      desktopDeviceId: "device-1",
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      routeSource: "sender-binding",
    });
  });

  it("lets explicit group binding override sender binding", async () => {
    const prisma = new FakePrisma();
    const registry = new FakeRegistry();
    prisma.accounts.set("dingtalk:staff-1", {
      provider: "dingtalk",
      senderStaffId: "staff-1",
      myclawUserId: "sender-user",
      enabled: true,
    });
    prisma.bindings.set("dingtalk:gid-1", {
      provider: "dingtalk",
      externalConversationId: "gid-1",
      myclawUserId: "bound-user",
      desktopDeviceId: "bound-device",
      enabled: true,
    });
    registry.activeDevices.set("bound-user", "bound-device");

    const service = new RoutingService(prisma as any, registry as any);

    await expect(service.route(createInput({
      externalConversationId: "gid-1",
      conversationType: "group",
    }))).resolves.toEqual({
      ok: true,
      myclawUserId: "bound-user",
      desktopDeviceId: "bound-device",
      localSessionKey: "dingtalk:group:gid-1:user:bound-user",
      routeSource: "conversation-binding",
    });
  });

  it("routes group chat by sender when no explicit binding exists", async () => {
    const prisma = new FakePrisma();
    const registry = new FakeRegistry();
    prisma.accounts.set("dingtalk:staff-1", {
      provider: "dingtalk",
      senderStaffId: "staff-1",
      myclawUserId: "sender-user",
      enabled: true,
    });
    registry.activeDevices.set("sender-user", "sender-device");

    const service = new RoutingService(prisma as any, registry as any);

    await expect(service.route(createInput({
      externalConversationId: "gid-2",
      conversationType: "group",
    }))).resolves.toMatchObject({
      ok: true,
      myclawUserId: "sender-user",
      desktopDeviceId: "sender-device",
      routeSource: "sender-binding",
    });
  });

  it("returns unbound_sender when sender has no account", async () => {
    const service = new RoutingService(new FakePrisma() as any, new FakeRegistry() as any);

    await expect(service.route(createInput())).resolves.toEqual({
      ok: false,
      reason: "unbound_sender",
    });
  });

  it("returns disabled_sender when sender account is disabled", async () => {
    const prisma = new FakePrisma();
    prisma.accounts.set("dingtalk:staff-1", {
      provider: "dingtalk",
      senderStaffId: "staff-1",
      myclawUserId: "user-1",
      enabled: false,
    });
    const service = new RoutingService(prisma as any, new FakeRegistry() as any);

    await expect(service.route(createInput())).resolves.toEqual({
      ok: false,
      reason: "disabled_sender",
    });
  });

  it("returns binding_disabled when explicit group binding is disabled", async () => {
    const prisma = new FakePrisma();
    prisma.bindings.set("dingtalk:gid-1", {
      provider: "dingtalk",
      externalConversationId: "gid-1",
      myclawUserId: "bound-user",
      desktopDeviceId: "bound-device",
      enabled: false,
    });
    const service = new RoutingService(prisma as any, new FakeRegistry() as any);

    await expect(service.route(createInput({
      externalConversationId: "gid-1",
      conversationType: "group",
    }))).resolves.toEqual({
      ok: false,
      reason: "binding_disabled",
    });
  });
});
