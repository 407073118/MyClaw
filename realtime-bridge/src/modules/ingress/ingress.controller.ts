import { BadRequestException, Body, Controller, Headers, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

import { InMemoryNonceStore, verifyHmacSignature } from "../../common/crypto/hmac-signature";
import { dingtalkRelayMessageSchema } from "./dto/dingtalk-relay-message.dto";
import { IngressService } from "./ingress.service";

@Controller("v1/ingress/dingtalk")
export class IngressController {
  private readonly nonceStore = new InMemoryNonceStore();

  constructor(@Inject(IngressService) private readonly ingressService: IngressService) {}

  /** 接收钉钉中转消息，先执行 HMAC 安全校验，再校验结构并写入入站表。 */
  @Post("message")
  async receiveDingTalkMessage(
    @Body() body: unknown,
    @Req() request: Request,
    @Headers("x-myclaw-signature") signature?: string,
    @Headers("x-myclaw-timestamp") timestamp?: string,
    @Headers("x-myclaw-nonce") nonce?: string,
  ): Promise<{ ok: true; messageId: string }> {
    const rawBody = this.readRawBody(request, body);
    const secret = process.env.DINGTALK_RELAY_HMAC_SECRET ?? "";
    if (!secret) {
      console.warn("[ingress] 拒绝未配置 HMAC 密钥的钉钉中转消息");
      throw new UnauthorizedException("relay signature secret is not configured");
    }
    const hmacResult = verifyHmacSignature({
      body: rawBody,
      timestamp: timestamp ?? "",
      nonce: nonce ?? "",
      signature,
      secret,
      nonceStore: this.nonceStore,
    });

    if (!hmacResult.ok) {
      console.warn("[ingress] 安全校验拒绝钉钉中转消息", { reason: hmacResult.reason });
      throw new UnauthorizedException("invalid relay signature");
    }

    const parsed = dingtalkRelayMessageSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[ingress] 拒绝结构非法的钉钉中转消息", {
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      throw new BadRequestException("invalid relay payload");
    }

    const result = await this.ingressService.receiveDingTalkMessage(parsed.data);
    console.info("[ingress] 钉钉中转消息接收成功", { messageId: result.messageId });
    return { ok: true, messageId: result.messageId };
  }

  /** 读取原始请求体；测试环境无 rawBody 时使用 JSON 序列化作为降级输入。 */
  private readRawBody(request: Request, body: unknown): string {
    const rawBody = (request as Request & { rawBody?: Buffer | string }).rawBody;
    if (Buffer.isBuffer(rawBody)) {
      console.info("[ingress] 读取 Buffer 原始请求体成功");
      return rawBody.toString("utf8");
    }

    if (typeof rawBody === "string") {
      console.info("[ingress] 读取字符串原始请求体成功");
      return rawBody;
    }

    console.warn("[ingress] 原始请求体缺失，降级使用 JSON 序列化结果");
    return JSON.stringify(body ?? {});
  }
}
