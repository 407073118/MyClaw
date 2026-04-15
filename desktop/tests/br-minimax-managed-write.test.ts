import { describe, expect, it } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import { coerceManagedProfileWrite, normalizeFirstClassVendorRoute } from "../src/main/services/managed-model-profile";

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

  it("fills the default qwen route when no explicit route has been saved", () => {
    const coerced = coerceManagedProfileWrite(null, {
      name: "Qwen",
      provider: "openai-compatible",
      providerFlavor: "qwen",
      providerFamily: "qwen-dashscope",
      baseUrl: "https://dashscope.aliyuncs.com",
      apiKey: "qwen-key",
      model: "qwen-max",
    });

    expect(coerced).toMatchObject({
      providerFlavor: "qwen",
      providerFamily: "qwen-native",
      protocolTarget: "openai-responses",
      savedProtocolPreferences: ["openai-responses"],
      protocolSelectionSource: "registry-default",
    });
  });

  it("fills the default kimi route when no explicit route has been saved", () => {
    const coerced = coerceManagedProfileWrite(null, {
      name: "Kimi",
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      providerFamily: "moonshot-native",
      baseUrl: "https://api.moonshot.cn",
      apiKey: "kimi-key",
      model: "kimi-k2-0905-preview",
    });

    expect(coerced).toMatchObject({
      providerFlavor: "moonshot",
      providerFamily: "moonshot-native",
      protocolTarget: "anthropic-messages",
      savedProtocolPreferences: ["anthropic-messages"],
      protocolSelectionSource: "registry-default",
    });
  });

  it("preserves explicitly saved qwen routes instead of resetting them to registry defaults", () => {
    const normalized = normalizeFirstClassVendorRoute({
      name: "Qwen",
      provider: "openai-compatible",
      providerFlavor: "qwen",
      providerFamily: "qwen-dashscope",
      vendorFamily: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com",
      apiKey: "qwen-key",
      model: "qwen-max",
      protocolTarget: "openai-chat-compatible",
      savedProtocolPreferences: ["openai-chat-compatible", "openai-responses"],
      protocolSelectionSource: "saved",
    });

    expect(normalized).toMatchObject({
      providerFamily: "qwen-native",
      vendorFamily: "qwen",
      protocolTarget: "openai-chat-compatible",
      savedProtocolPreferences: ["openai-chat-compatible", "openai-responses"],
      protocolSelectionSource: "saved",
    });
  });

  it("migrates legacy qwen-compatible defaults onto first-class defaults when no explicit selection source was saved", () => {
    const normalized = normalizeFirstClassVendorRoute({
      name: "Qwen",
      provider: "openai-compatible",
      providerFlavor: "qwen",
      providerFamily: "qwen-dashscope",
      vendorFamily: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com",
      apiKey: "qwen-key",
      model: "qwen-max",
      protocolTarget: "openai-chat-compatible",
      savedProtocolPreferences: ["openai-chat-compatible", "openai-responses"],
    });

    expect(normalized).toMatchObject({
      providerFamily: "qwen-native",
      vendorFamily: "qwen",
      protocolTarget: "openai-responses",
      savedProtocolPreferences: ["openai-responses"],
      protocolSelectionSource: "registry-default",
    });
  });

  it("migrates legacy kimi-compatible defaults onto first-class defaults when no explicit selection source was saved", () => {
    const normalized = normalizeFirstClassVendorRoute({
      name: "Kimi",
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      providerFamily: "moonshot-native",
      vendorFamily: "kimi",
      baseUrl: "https://api.moonshot.cn",
      apiKey: "kimi-key",
      model: "kimi-k2-0905-preview",
      protocolTarget: "openai-chat-compatible",
      savedProtocolPreferences: ["openai-chat-compatible", "anthropic-messages"],
    });

    expect(normalized).toMatchObject({
      providerFamily: "moonshot-native",
      vendorFamily: "kimi",
      protocolTarget: "anthropic-messages",
      savedProtocolPreferences: ["anthropic-messages"],
      protocolSelectionSource: "registry-default",
    });
  });

  it("corrects stale moonshot identity for volcengine profiles without overwriting probed routes", () => {
    const normalized = normalizeFirstClassVendorRoute({
      name: "Ark Kimi",
      provider: "openai-compatible",
      providerFlavor: "volcengine-ark",
      providerFamily: "moonshot-native",
      vendorFamily: "kimi",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "ark-key",
      model: "kimi-k2.5",
      protocolTarget: "openai-responses",
      savedProtocolPreferences: ["openai-responses", "openai-chat-compatible"],
      protocolSelectionSource: "probe",
    });

    expect(normalized).toMatchObject({
      providerFamily: "volcengine-ark",
      vendorFamily: "volcengine-ark",
      protocolTarget: "openai-responses",
      savedProtocolPreferences: ["openai-responses", "openai-chat-compatible"],
      protocolSelectionSource: "probe",
    });
  });
});
