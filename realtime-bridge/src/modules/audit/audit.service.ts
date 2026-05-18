import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

export interface AuditTimelineEvent {
  eventType: string;
  message: string;
  metadataJson?: unknown;
  createdAt: Date;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 记录入站消息已接收事件。 */
  async recordIngressReceived(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "received", "已接收入站消息", metadata);
  }

  /** 记录路由解析成功事件。 */
  async recordRouteResolved(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "routed", "已完成路由解析", metadata);
  }

  /** 记录桌面端 ACK 已确认事件。 */
  async recordDeliveryAcked(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "acked", "桌面端已确认投递", metadata);
  }

  /** 记录桌面端开始处理事件。 */
  async recordProcessingStarted(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "processing", "桌面端开始处理消息", metadata);
  }

  /** 记录桌面端回复已创建事件。 */
  async recordReplyCreated(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "reply_created", "桌面端已创建回复", metadata);
  }

  /** 记录出站消息已发送事件。 */
  async recordOutboundSent(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "outbound_sent", "回复已回发到钉钉中转服务", metadata);
  }

  /** 记录链路失败事件。 */
  async recordFailure(messageId: string, metadata?: unknown): Promise<void> {
    await this.record(messageId, "failed", "消息链路处理失败", metadata);
  }

  /** 写入审计日志表，集中处理中文结构化日志。 */
  private async record(messageId: string, eventType: string, message: string, metadata?: unknown): Promise<void> {
    console.info("[audit] 开始记录消息链路事件", { messageId, eventType });
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          inboundMessageId: messageId,
          eventType,
          message,
          metadataJson: metadata,
        },
      });
      console.info("[audit] 消息链路事件记录成功", { messageId, eventType });
    } catch (error) {
      console.error("[audit] 消息链路事件记录失败", {
        messageId,
        eventType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
