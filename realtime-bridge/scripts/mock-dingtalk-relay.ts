import { randomUUID } from "node:crypto";

import { signHmacPayload } from "../src/common/crypto/hmac-signature";

type RelayArgs = {
  baseUrl: string;
  senderStaffId: string;
  text: string;
  externalConversationId: string;
  conversationType: "direct" | "group";
  secret: string;
};

/** 解析命令行参数，为本地联调提供安全默认值。 */
function parseArgs(argv: string[]): RelayArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      values.set(item.slice(2), argv[index + 1] ?? "");
      index += 1;
    }
  }

  const args = {
    baseUrl: values.get("baseUrl") ?? process.env.REALTIME_BRIDGE_BASE_URL ?? "http://localhost:4300",
    senderStaffId: values.get("senderStaffId") ?? "staff-1",
    text: values.get("text") ?? "测试消息",
    externalConversationId: values.get("externalConversationId") ?? "cid-local",
    conversationType: (values.get("conversationType") ?? "direct") as "direct" | "group",
    secret: values.get("secret") ?? process.env.DINGTALK_RELAY_HMAC_SECRET ?? "dev-secret",
  };
  console.info("[mock-relay] 命令行参数解析完成", {
    baseUrl: args.baseUrl,
    senderStaffId: args.senderStaffId,
    externalConversationId: args.externalConversationId,
    conversationType: args.conversationType,
  });
  return args;
}

/** 构建钉钉中转模拟载荷，保持与入站 DTO 的最小契约一致。 */
function buildPayload(args: RelayArgs): Record<string, unknown> {
  const payload = {
    provider: "dingtalk",
    externalMessageId: `mock-${randomUUID()}`,
    senderStaffId: args.senderStaffId,
    externalConversationId: args.externalConversationId,
    conversationType: args.conversationType,
    content: { type: "text", text: args.text },
    traceId: `trace-${randomUUID()}`,
  };
  console.info("[mock-relay] 已构建钉钉中转模拟载荷", {
    externalMessageId: payload.externalMessageId,
    traceId: payload.traceId,
  });
  return payload;
}

/** 发送带 HMAC 签名的钉钉中转请求，便于本地端到端联调。 */
async function sendRelayMessage(args: RelayArgs): Promise<void> {
  const payload = buildPayload(args);
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const signature = signHmacPayload({ body, timestamp, nonce, secret: args.secret });
  const endpoint = `${args.baseUrl.replace(/\/$/, "")}/v1/ingress/dingtalk/message`;
  console.info("[mock-relay] 开始发送钉钉中转模拟请求", { endpoint });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MyClaw-Timestamp": timestamp,
      "X-MyClaw-Nonce": nonce,
      "X-MyClaw-Signature": signature,
    },
    body,
  });
  const responseBody = await response.text();
  console.info("[mock-relay] 钉钉中转模拟请求完成", {
    status: response.status,
    responseBody,
  });
  if (!response.ok) {
    throw new Error(`relay request failed: ${response.status}`);
  }
}

sendRelayMessage(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error("[mock-relay] 钉钉中转模拟请求失败", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
