import { Inject, Injectable } from "@nestjs/common";

import type { ChannelConversationType, ChannelProvider } from "../../contracts/channel-message";
import { buildLocalSessionKey } from "../../contracts/status";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { DesktopConnectionRegistry } from "../desktop-ws/desktop-connection.registry";

export interface RouteInput {
  provider: ChannelProvider;
  senderStaffId: string;
  externalConversationId: string;
  conversationType: ChannelConversationType;
}

export type RouteResult =
  | {
      ok: true;
      myclawUserId: string;
      desktopDeviceId: string;
      localSessionKey: string;
      routeSource: "conversation-binding" | "sender-binding";
    }
  | { ok: false; reason: "unbound_sender" | "disabled_sender" | "device_offline" | "binding_disabled" };

@Injectable()
export class RoutingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DesktopConnectionRegistry) private readonly registry: DesktopConnectionRegistry,
  ) {}

  /** 按显式会话绑定优先、发送人绑定兜底的规则解析消息路由。 */
  async route(input: RouteInput): Promise<RouteResult> {
    console.info("[routing] 开始解析入站消息路由", {
      provider: input.provider,
      senderStaffId: input.senderStaffId,
      externalConversationId: input.externalConversationId,
      conversationType: input.conversationType,
    });

    if (input.conversationType === "group") {
      const bindingRoute = await this.routeByConversationBinding(input);
      if (bindingRoute) {
        return bindingRoute;
      }
    }

    return this.routeBySenderBinding(input);
  }

  /** 查询显式会话绑定，存在时优先使用群或会话绑定路由。 */
  private async routeByConversationBinding(input: RouteInput): Promise<RouteResult | undefined> {
    const binding = await (this.prisma as any).channelBinding.findUnique({
      where: {
        provider_externalConversationId: {
          provider: input.provider,
          externalConversationId: input.externalConversationId,
        },
      },
    });

    if (!binding) {
      console.info("[routing] 未找到显式会话绑定，准备回退发送人绑定", {
        externalConversationId: input.externalConversationId,
      });
      return undefined;
    }

    if (!binding.enabled) {
      console.warn("[routing] 显式会话绑定已禁用，拒绝路由", {
        externalConversationId: input.externalConversationId,
      });
      return { ok: false, reason: "binding_disabled" };
    }

    if (!this.registry.getConnection(binding.desktopDeviceId)) {
      console.warn("[routing] 显式会话绑定设备不在线，消息进入离线队列", {
        desktopDeviceId: binding.desktopDeviceId,
      });
      return { ok: false, reason: "device_offline" };
    }

    console.info("[routing] 显式会话绑定路由成功", {
      myclawUserId: binding.myclawUserId,
      desktopDeviceId: binding.desktopDeviceId,
    });
    return {
      ok: true,
      myclawUserId: binding.myclawUserId,
      desktopDeviceId: binding.desktopDeviceId,
      localSessionKey: buildLocalSessionKey({
        provider: input.provider,
        conversationType: input.conversationType,
        externalConversationId: input.externalConversationId,
        myclawUserId: binding.myclawUserId,
      }),
      routeSource: "conversation-binding",
    };
  }

  /** 查询发送人账号绑定，作为直接会话和未显式绑定群会话的默认路由。 */
  private async routeBySenderBinding(input: RouteInput): Promise<RouteResult> {
    const account = await (this.prisma as any).channelAccount.findUnique({
      where: {
        provider_senderStaffId: {
          provider: input.provider,
          senderStaffId: input.senderStaffId,
        },
      },
    });

    if (!account) {
      console.warn("[routing] 未找到发送人绑定，拒绝路由", { senderStaffId: input.senderStaffId });
      return { ok: false, reason: "unbound_sender" };
    }

    if (!account.enabled) {
      console.warn("[routing] 发送人绑定已禁用，拒绝路由", { senderStaffId: input.senderStaffId });
      return { ok: false, reason: "disabled_sender" };
    }

    const desktopDeviceId = this.registry.getActiveDeviceId(account.myclawUserId);
    if (!desktopDeviceId) {
      console.warn("[routing] 发送人绑定用户没有在线桌面设备，消息进入离线队列", {
        myclawUserId: account.myclawUserId,
      });
      return { ok: false, reason: "device_offline" };
    }

    console.info("[routing] 发送人绑定路由成功", {
      senderStaffId: input.senderStaffId,
      myclawUserId: account.myclawUserId,
      desktopDeviceId,
    });
    return {
      ok: true,
      myclawUserId: account.myclawUserId,
      desktopDeviceId,
      localSessionKey: buildLocalSessionKey({
        provider: input.provider,
        conversationType: input.conversationType,
        externalConversationId: input.externalConversationId,
        myclawUserId: account.myclawUserId,
      }),
      routeSource: "sender-binding",
    };
  }
}
