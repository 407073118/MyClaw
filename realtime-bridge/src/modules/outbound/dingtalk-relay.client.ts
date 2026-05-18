import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { signHmacPayload } from "../../common/crypto/hmac-signature";
import type { ChannelMessageContent } from "../../contracts/channel-message";

export interface RelayReplyInput {
  messageId: string;
  deliveryId: string;
  provider: "dingtalk";
  externalConversationId: string;
  conversationType?: "direct" | "group";
  sessionWebhook?: string;
  traceId?: string;
  content: ChannelMessageContent;
}

export type RelayReplyResult =
  | { ok: true; rawResponse: unknown }
  | { ok: false; error: string };

@Injectable()
export class DingTalkRelayClient {
  /** 调用钉钉中转服务回发桌面端回复，并使用 HMAC 保护请求。 */
  async sendReply(input: RelayReplyInput): Promise<RelayReplyResult> {
    const baseUrl = process.env.DINGTALK_RELAY_BASE_URL;
    const secret = process.env.DINGTALK_RELAY_HMAC_SECRET;
    if (!baseUrl || !secret) {
      console.warn("[outbound] 缺少钉钉中转服务配置，拒绝回发", {
        hasBaseUrl: Boolean(baseUrl),
        hasSecret: Boolean(secret),
      });
      return { ok: false, error: "relay configuration missing" };
    }

    const body = JSON.stringify({
      messageId: input.messageId,
      deliveryId: input.deliveryId,
      provider: input.provider,
      externalConversationId: input.externalConversationId,
      conversationType: input.conversationType,
      sessionWebhook: input.sessionWebhook,
      traceId: input.traceId,
      content: input.content,
    });
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = signHmacPayload({ body, timestamp, nonce, secret });

    try {
      console.info("[outbound] 开始回发桌面端回复到钉钉中转服务", { messageId: input.messageId });
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/dingtalk/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MyClaw-Signature": signature,
          "X-MyClaw-Timestamp": timestamp,
          "X-MyClaw-Nonce": nonce,
        },
        body,
      });
      const rawResponse = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.warn("[outbound] 钉钉中转服务回发失败", { status: response.status });
        return { ok: false, error: `relay responded ${response.status}` };
      }

      console.info("[outbound] 钉钉中转服务回发成功", { messageId: input.messageId });
      return { ok: true, rawResponse };
    } catch (error) {
      console.error("[outbound] 钉钉中转服务调用异常", {
        messageId: input.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: "relay request failed" };
    }
  }
}
