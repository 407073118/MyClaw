import { describe, expect, it } from "vitest";

import {
  InMemoryNonceStore,
  signHmacPayload,
  verifyHmacSignature,
} from "../../src/common/crypto/hmac-signature";

describe("HMAC signature verifier", () => {
  it("accepts a valid signature", () => {
    const body = JSON.stringify({ text: "hello" });
    const timestamp = "1700000000000";
    const nonce = "nonce-1";
    const secret = "relay-secret";
    const signature = signHmacPayload({ body, timestamp, nonce, secret });

    expect(verifyHmacSignature({
      body,
      timestamp,
      nonce,
      signature,
      secret,
      nowMs: 1700000000000,
      nonceStore: new InMemoryNonceStore(),
    })).toEqual({ ok: true });
  });

  it("rejects stale timestamps", () => {
    const body = JSON.stringify({ text: "hello" });
    const timestamp = "1700000000000";
    const nonce = "nonce-2";
    const secret = "relay-secret";
    const signature = signHmacPayload({ body, timestamp, nonce, secret });

    expect(verifyHmacSignature({
      body,
      timestamp,
      nonce,
      signature,
      secret,
      nowMs: 1700000600001,
      nonceStore: new InMemoryNonceStore(),
    })).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects reused nonces", () => {
    const body = JSON.stringify({ text: "hello" });
    const timestamp = "1700000000000";
    const nonce = "nonce-3";
    const secret = "relay-secret";
    const nonceStore = new InMemoryNonceStore();
    const signature = signHmacPayload({ body, timestamp, nonce, secret });

    expect(verifyHmacSignature({
      body,
      timestamp,
      nonce,
      signature,
      secret,
      nowMs: 1700000000000,
      nonceStore,
    })).toEqual({ ok: true });

    expect(verifyHmacSignature({
      body,
      timestamp,
      nonce,
      signature,
      secret,
      nowMs: 1700000000001,
      nonceStore,
    })).toEqual({ ok: false, reason: "reused_nonce" });
  });

  it("rejects body tampering", () => {
    const timestamp = "1700000000000";
    const nonce = "nonce-4";
    const secret = "relay-secret";
    const signature = signHmacPayload({
      body: JSON.stringify({ text: "original" }),
      timestamp,
      nonce,
      secret,
    });

    expect(verifyHmacSignature({
      body: JSON.stringify({ text: "tampered" }),
      timestamp,
      nonce,
      signature,
      secret,
      nowMs: 1700000000000,
      nonceStore: new InMemoryNonceStore(),
    })).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
