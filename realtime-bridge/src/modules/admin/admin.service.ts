import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import { DesktopConnectionRegistry } from "../desktop-ws/desktop-connection.registry";

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DesktopConnectionRegistry) private readonly registry: DesktopConnectionRegistry,
  ) {}

  /** 查询指定消息的审计时间线，按创建时间正序返回。 */
  async getMessageTimeline(messageId: string): Promise<{ events: Array<{ eventType: string; message: string; createdAt: Date }> }> {
    console.info("[admin] 开始查询消息链路时间线", { messageId });
    const events = await (this.prisma as any).auditLog.findMany({
      where: { inboundMessageId: messageId },
      orderBy: { createdAt: "asc" },
    });
    console.info("[admin] 消息链路时间线查询成功", { messageId, count: events.length });
    return { events };
  }

  /** 查询用户当前在线桌面设备，供内部排障使用。 */
  async getUserOnlineDevice(userId: string): Promise<{ userId: string; desktopDeviceId?: string }> {
    console.info("[admin] 开始查询用户在线设备", { userId });
    const desktopDeviceId = this.registry.getActiveDeviceId(userId);
    console.info("[admin] 用户在线设备查询完成", { userId, desktopDeviceId });
    return { userId, desktopDeviceId };
  }

  /** 查询发送人员工号绑定，供内部排障使用。 */
  async getSenderBinding(senderStaffId: string): Promise<unknown> {
    console.info("[admin] 开始查询发送人绑定", { senderStaffId });
    const binding = await (this.prisma as any).channelAccount.findUnique({
      where: {
        provider_senderStaffId: {
          provider: "dingtalk",
          senderStaffId,
        },
      },
    });
    console.info("[admin] 发送人绑定查询完成", { senderStaffId, found: Boolean(binding) });
    return binding;
  }
}
