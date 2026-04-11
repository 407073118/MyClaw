import { describe, expect, it } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import { coerceManagedProfileWrite } from "../src/main/services/managed-model-profile";

describe("coerceManagedProfileWrite", () => {
  it("locks br-minimax create payload to managed defaults", () => {
    const coerced = coerceManagedProfileWrite(null, {
      name: "User Custom Name",
      provider: "openai-compatible",
      providerFlavor: "br-minimax",
      baseUrl: "https://evil.example.com",
      apiKey: "br-key",
      model: "other-model",
      requestBody: {
        temperature: 0.1,
      },
      protocolTarget: "openai-chat-compatible",
    });

    expect(coerced).toMatchObject({
      ...createBrMiniMaxProfile({ apiKey: "br-key" }),
      protocolTarget: "openai-chat-compatible",
      vendorFamily: "minimax",
      deploymentProfile: "br-private",
    });
  });

  it("only allows apiKey to change when updating br-minimax", () => {
    const existing = createBrMiniMaxProfile({
      id: "br-profile",
      apiKey: "old-key",
    });

    const coerced = coerceManagedProfileWrite(existing, {
      name: "Changed",
      baseUrl: "https://evil.example.com",
      apiKey: "new-key",
      model: "changed-model",
    });

    expect(coerced).toMatchObject({
      apiKey: "new-key",
      name: existing.name,
      provider: existing.provider,
      providerFlavor: existing.providerFlavor,
      vendorFamily: "minimax",
      deploymentProfile: "br-private",
      baseUrl: existing.baseUrl,
      baseUrlMode: existing.baseUrlMode,
      model: existing.model,
      requestBody: existing.requestBody,
    });
  });

  it("preserves protocolTarget when updating a managed br-minimax profile", () => {
    const existing = {
      ...createBrMiniMaxProfile({
        id: "br-profile",
        apiKey: "old-key",
      }),
      protocolTarget: "openai-chat-compatible" as const,
    };

    const coerced = coerceManagedProfileWrite(existing, {
      apiKey: "new-key",
      protocolTarget: "openai-responses",
    });

    expect(coerced).toMatchObject({
      apiKey: "new-key",
      protocolTarget: "openai-responses",
    });
  });
});
