import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type HmacRejectReason =
  | "missing_header"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "reused_nonce"
  | "invalid_signature";

export interface HmacNonceStore {
  rememberNonce(nonce: string, expiresAtMs: number, nowMs?: number): boolean;
}

export interface HmacPayloadInput {
  body: string;
  timestamp: string;
  nonce: string;
  secret: string;
}

export interface VerifyHmacSignatureInput extends HmacPayloadInput {
  signature?: string;
  nowMs?: number;
  maxSkewMs?: number;
  nonceStore: HmacNonceStore;
}

export type HmacVerificationResult =
  | { ok: true }
  | { ok: false; reason: HmacRejectReason };

export class InMemoryNonceStore implements HmacNonceStore {
  private readonly nonceExpiresAt = new Map<string, number>();

  /** 记录已使用的 nonce，并在发现重复 nonce 时拒绝重放请求。 */
  rememberNonce(nonce: string, expiresAtMs: number, nowMs = Date.now()): boolean {
    for (const [storedNonce, storedExpiresAt] of this.nonceExpiresAt.entries()) {
      if (storedExpiresAt <= nowMs) {
        this.nonceExpiresAt.delete(storedNonce);
      }
    }

    if (this.nonceExpiresAt.has(nonce)) {
      console.warn("[hmac] 拒绝重复 nonce", { nonce });
      return false;
    }

    this.nonceExpiresAt.set(nonce, expiresAtMs);
    console.info("[hmac] 记录入站 nonce 成功", { nonce, expiresAtMs });
    return true;
  }
}

/** 计算原始请求体的 SHA-256 摘要，作为签名基串的一部分。 */
export function hashRequestBody(body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  console.info("[hmac] 请求体摘要计算成功", { bodyHash });
  return bodyHash;
}

/** 构建 HMAC 签名基串，保持中转服务与桥接服务的签名输入一致。 */
export function buildHmacBaseString(input: Pick<HmacPayloadInput, "body" | "timestamp" | "nonce">): string {
  const baseString = `${input.timestamp}.${input.nonce}.${hashRequestBody(input.body)}`;
  console.info("[hmac] HMAC 签名基串构建成功", {
    timestamp: input.timestamp,
    nonce: input.nonce,
  });
  return baseString;
}

/** 生成 HMAC 签名，供入站验签测试和出站调用复用。 */
export function signHmacPayload(input: HmacPayloadInput): string {
  const signature = createHmac("sha256", input.secret)
    .update(buildHmacBaseString(input))
    .digest("hex");
  console.info("[hmac] HMAC 签名生成成功", {
    timestamp: input.timestamp,
    nonce: input.nonce,
  });
  return signature;
}

/** 校验 HMAC 签名、时间戳和 nonce，防止篡改、过期请求与重放攻击。 */
export function verifyHmacSignature(input: VerifyHmacSignatureInput): HmacVerificationResult {
  if (!input.signature || !input.timestamp || !input.nonce) {
    console.warn("[hmac] 拒绝缺少安全头的入站请求");
    return { ok: false, reason: "missing_header" };
  }

  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    console.warn("[hmac] 拒绝时间戳格式错误的入站请求", { timestamp: input.timestamp });
    return { ok: false, reason: "invalid_timestamp" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const maxSkewMs = input.maxSkewMs ?? 5 * 60 * 1000;
  if (Math.abs(nowMs - timestampMs) > maxSkewMs) {
    console.warn("[hmac] 拒绝过期入站请求", { timestampMs, nowMs, maxSkewMs });
    return { ok: false, reason: "stale_timestamp" };
  }

  const expectedSignature = signHmacPayload(input);
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(input.signature, "hex");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    console.warn("[hmac] 拒绝签名不匹配的入站请求", { nonce: input.nonce });
    return { ok: false, reason: "invalid_signature" };
  }

  if (!input.nonceStore.rememberNonce(input.nonce, timestampMs + maxSkewMs, nowMs)) {
    console.warn("[hmac] 拒绝 nonce 重放的入站请求", { nonce: input.nonce });
    return { ok: false, reason: "reused_nonce" };
  }

  console.info("[hmac] 入站 HMAC 校验成功", { nonce: input.nonce });
  return { ok: true };
}
