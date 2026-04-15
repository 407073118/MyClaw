import type { ProtocolTarget, ProviderFamily, VendorFamily } from "@shared/contracts";

export type ProviderRolloutFlags = Partial<Record<ProviderFamily, boolean>>;
export type VendorProtocolRolloutFlags = Partial<Record<`${VendorFamily}:${ProtocolTarget}`, boolean>>;
export type VendorProtocolRolloutState = "disabled" | "beta" | "stable";

export type ProviderRolloutGate = {
  providerFamily: ProviderFamily;
  enabled: boolean;
  rolloutOrder: number;
  reason: string;
};

export type VendorProtocolRolloutGate = {
  vendorFamily: VendorFamily;
  protocolTarget: ProtocolTarget;
  state: VendorProtocolRolloutState;
  enabled: boolean;
  rolloutOrder: number;
  reason: string;
};

const DEFAULT_ROLLOUT_GATES: Record<ProviderFamily, ProviderRolloutGate> = {
  "generic-openai-compatible": {
    providerFamily: "generic-openai-compatible",
    enabled: true,
    rolloutOrder: 1,
    reason: "default-compatible-baseline",
  },
  "qwen-dashscope": {
    providerFamily: "qwen-dashscope",
    enabled: false,
    rolloutOrder: 2,
    reason: "disabled-until-explicit-rollout",
  },
  "qwen-native": {
    providerFamily: "qwen-native",
    enabled: false,
    rolloutOrder: 3,
    reason: "disabled-until-explicit-rollout",
  },
  "openai-native": {
    providerFamily: "openai-native",
    enabled: false,
    rolloutOrder: 4,
    reason: "disabled-until-explicit-rollout",
  },
  "anthropic-native": {
    providerFamily: "anthropic-native",
    enabled: false,
    rolloutOrder: 5,
    reason: "disabled-until-explicit-rollout",
  },
  "moonshot-native": {
    providerFamily: "moonshot-native",
    enabled: false,
    rolloutOrder: 6,
    reason: "disabled-until-explicit-rollout",
  },
  "br-minimax": {
    providerFamily: "br-minimax",
    enabled: false,
    rolloutOrder: 7,
    reason: "disabled-until-explicit-rollout",
  },
  "volcengine-ark": {
    providerFamily: "volcengine-ark",
    enabled: false,
    rolloutOrder: 8,
    reason: "disabled-until-explicit-rollout",
  },
  "deepseek": {
    providerFamily: "deepseek",
    enabled: false,
    rolloutOrder: 9,
    reason: "disabled-until-explicit-rollout",
  },
};

const DEFAULT_VENDOR_PROTOCOL_ROLLOUT_GATES: Partial<Record<`${VendorFamily}:${ProtocolTarget}`, VendorProtocolRolloutGate>> = {
  "openai:openai-responses": {
    vendorFamily: "openai",
    protocolTarget: "openai-responses",
    state: "beta",
    enabled: false,
    rolloutOrder: 1,
    reason: "disabled-until-explicit-rollout",
  },
  "openai:openai-chat-compatible": {
    vendorFamily: "openai",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 2,
    reason: "default-compatible-baseline",
  },
  "anthropic:anthropic-messages": {
    vendorFamily: "anthropic",
    protocolTarget: "anthropic-messages",
    state: "beta",
    enabled: false,
    rolloutOrder: 3,
    reason: "disabled-until-explicit-rollout",
  },
  "qwen:openai-responses": {
    vendorFamily: "qwen",
    protocolTarget: "openai-responses",
    state: "beta",
    enabled: true,
    rolloutOrder: 4,
    reason: "vendor-default-enabled",
  },
  "qwen:anthropic-messages": {
    vendorFamily: "qwen",
    protocolTarget: "anthropic-messages",
    state: "beta",
    enabled: false,
    rolloutOrder: 5,
    reason: "disabled-until-explicit-rollout",
  },
  "qwen:openai-chat-compatible": {
    vendorFamily: "qwen",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 6,
    reason: "default-compatible-baseline",
  },
  "kimi:anthropic-messages": {
    vendorFamily: "kimi",
    protocolTarget: "anthropic-messages",
    state: "stable",
    enabled: true,
    rolloutOrder: 7,
    reason: "registry-default-enabled",
  },
  "kimi:openai-chat-compatible": {
    vendorFamily: "kimi",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 8,
    reason: "default-compatible-baseline",
  },
  "volcengine-ark:openai-responses": {
    vendorFamily: "volcengine-ark",
    protocolTarget: "openai-responses",
    state: "beta",
    enabled: false,
    rolloutOrder: 9,
    reason: "disabled-until-explicit-rollout",
  },
  "volcengine-ark:anthropic-messages": {
    vendorFamily: "volcengine-ark",
    protocolTarget: "anthropic-messages",
    state: "beta",
    enabled: false,
    rolloutOrder: 10,
    reason: "disabled-until-explicit-rollout",
  },
  "volcengine-ark:openai-chat-compatible": {
    vendorFamily: "volcengine-ark",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 11,
    reason: "default-compatible-baseline",
  },
  "minimax:anthropic-messages": {
    vendorFamily: "minimax",
    protocolTarget: "anthropic-messages",
    state: "beta",
    enabled: false,
    rolloutOrder: 12,
    reason: "disabled-until-explicit-rollout",
  },
  "minimax:openai-chat-compatible": {
    vendorFamily: "minimax",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 13,
    reason: "default-compatible-baseline",
  },
  "minimax:openai-responses": {
    vendorFamily: "minimax",
    protocolTarget: "openai-responses",
    state: "beta",
    enabled: false,
    rolloutOrder: 14,
    reason: "disabled-until-explicit-rollout",
  },
  "generic-openai-compatible:openai-chat-compatible": {
    vendorFamily: "generic-openai-compatible",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 15,
    reason: "default-compatible-baseline",
  },
  "generic-local-gateway:openai-chat-compatible": {
    vendorFamily: "generic-local-gateway",
    protocolTarget: "openai-chat-compatible",
    state: "stable",
    enabled: true,
    rolloutOrder: 16,
    reason: "default-compatible-baseline",
  },
};

function readEnvFlag(family: ProviderFamily): boolean | null {
  const envKey = `MYCLAW_ROLLOUT_${family.toUpperCase().replace(/-/g, "_")}`;
  const rawValue = process.env[envKey]?.trim().toLowerCase();
  if (!rawValue) return null;
  return ["1", "true", "yes", "on"].includes(rawValue);
}

/** 读取 family rollout gate，允许通过显式 flags 或环境变量做隐藏覆盖。 */
export function resolveProviderFamilyRolloutGate(
  family: ProviderFamily,
  flags?: ProviderRolloutFlags,
): ProviderRolloutGate {
  const override = flags?.[family];
  if (override !== undefined) {
    return {
      ...DEFAULT_ROLLOUT_GATES[family],
      enabled: override,
      reason: "runtime-flag-override",
    };
  }

  const envOverride = readEnvFlag(family);
  if (envOverride !== null) {
    return {
      ...DEFAULT_ROLLOUT_GATES[family],
      enabled: envOverride,
      reason: "env-override",
    };
  }

  return DEFAULT_ROLLOUT_GATES[family];
}

/** 判断指定 family 是否允许使用 canonical/native 路径。 */
export function isProviderFamilyEnabled(
  family: ProviderFamily,
  flags?: ProviderRolloutFlags,
): boolean {
  return resolveProviderFamilyRolloutGate(family, flags).enabled;
}

/** 输出 rollout 顺序，供测试与调试验证。 */
export function listProviderFamilyRolloutGates(
  flags?: ProviderRolloutFlags,
): ProviderRolloutGate[] {
  return (Object.keys(DEFAULT_ROLLOUT_GATES) as ProviderFamily[])
    .map((family) => resolveProviderFamilyRolloutGate(family, flags))
    .sort((left, right) => left.rolloutOrder - right.rolloutOrder);
}

/** 读取 vendor+protocol 级 rollout gate，为后续按协议灰度提供统一入口。 */
export function resolveVendorProtocolRolloutGate(
  vendorFamily: VendorFamily,
  protocolTarget: ProtocolTarget,
  flags?: VendorProtocolRolloutFlags,
): VendorProtocolRolloutGate {
  const key = `${vendorFamily}:${protocolTarget}` as const;
  const gate = DEFAULT_VENDOR_PROTOCOL_ROLLOUT_GATES[key];

  const override = flags?.[key];
  if (override !== undefined) {
    const baseGate = gate ?? {
      vendorFamily,
      protocolTarget,
      state: override ? "beta" : "disabled",
      enabled: false,
      rolloutOrder: Number.MAX_SAFE_INTEGER,
      reason: "unregistered-vendor-protocol",
    };
    return {
      ...baseGate,
      enabled: override,
      reason: "runtime-flag-override",
    };
  }

  if (gate) {
    return gate;
  }

  return {
    vendorFamily,
    protocolTarget,
    state: "disabled",
    enabled: false,
    rolloutOrder: Number.MAX_SAFE_INTEGER,
    reason: "unregistered-vendor-protocol",
  };
}

/** 解析本轮执行真正应使用的 rollout gate，优先看 vendor+protocol，其次兼容旧的 provider family gate。 */
export function resolveEffectiveExecutionRolloutGate(input: {
  providerFamily: ProviderFamily;
  vendorFamily?: VendorFamily | null;
  protocolTarget: ProtocolTarget;
  providerFlags?: ProviderRolloutFlags;
  vendorProtocolFlags?: VendorProtocolRolloutFlags;
}): {
  enabled: boolean;
  rolloutOrder: number;
  reason: string;
} {
  const providerGate = resolveProviderFamilyRolloutGate(input.providerFamily, input.providerFlags);
  if (!input.vendorFamily) {
    return providerGate;
  }

  const key = `${input.vendorFamily}:${input.protocolTarget}` as const;
  const hasVendorOverride = input.vendorProtocolFlags
    && Object.prototype.hasOwnProperty.call(input.vendorProtocolFlags, key);
  const vendorGate = resolveVendorProtocolRolloutGate(
    input.vendorFamily,
    input.protocolTarget,
    input.vendorProtocolFlags,
  );

  if (hasVendorOverride) {
    return {
      enabled: vendorGate.enabled,
      rolloutOrder: vendorGate.rolloutOrder,
      reason: vendorGate.reason,
    };
  }

  if (vendorGate.enabled) {
    return {
      enabled: true,
      rolloutOrder: vendorGate.rolloutOrder,
      reason: vendorGate.reason,
    };
  }

  if (providerGate.enabled) {
    return {
      enabled: true,
      rolloutOrder: Math.min(providerGate.rolloutOrder, vendorGate.rolloutOrder),
      reason: "provider-family-compat-override",
    };
  }

  return {
    enabled: false,
    rolloutOrder: vendorGate.rolloutOrder,
    reason: vendorGate.reason,
  };
}
