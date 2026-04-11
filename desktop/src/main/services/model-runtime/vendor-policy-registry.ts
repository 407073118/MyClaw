import type {
  ExperienceProfileId,
  ProtocolTarget,
  ProviderFamily,
  VendorFamily,
} from "@shared/contracts";

export type VendorPolicy = {
  vendorFamily: VendorFamily;
  supportedProtocols: ProtocolTarget[];
  legacyProviderFamilies?: ProviderFamily[];
  recommendedProtocolsByUseCase: {
    default: ProtocolTarget[];
    coding: ProtocolTarget[];
    review: ProtocolTarget[];
  };
  defaultExperienceProfileId?: ExperienceProfileId;
  familyOverlayLines: string[];
  promptPolicyIdByProtocol?: Partial<Record<ProtocolTarget, string>>;
  toolPolicyIdByProtocol?: Partial<Record<ProtocolTarget, string>>;
  reasoningProfileIdByProtocol?: Partial<Record<ProtocolTarget, string>>;
  toolCompileModesByProviderFamily?: Partial<Record<ProviderFamily, string>>;
  deploymentProfiles?: string[];
};

type BuiltinToolSchemaGroup =
  | "fs"
  | "exec"
  | "git"
  | "http"
  | "web"
  | "ppt"
  | "task"
  | "browser";

const PROMPT_POLICY_LINES: Record<string, string[]> = {
  "openai.responses.default": [
    "Prefer compact, schema-aligned instructions for Responses-native execution.",
  ],
  "anthropic.messages.default": [
    "Prefer explicit task framing and clear tool delegation summaries.",
  ],
  "qwen.responses.default": [
    "Prefer explicit tool intent before execution.",
  ],
  "qwen.messages.default": [
    "Use short, structured instructions and preserve message continuity explicitly.",
  ],
  "qwen.compat.default": [
    "Keep prompts compact and compatible-safe for DashScope-style transports.",
  ],
  "kimi.messages.default": [
    "Favor Claude Code style continuity and concise tool-oriented planning.",
  ],
  "kimi.compat.default": [
    "Preserve reasoning breadcrumbs using compatible replay semantics.",
  ],
  "ark.responses.default": [
    "Prefer coding-agent phrasing with explicit next actions and strong output structure.",
  ],
  "ark.messages.default": [
    "Use Claude-style task framing when the messages route is selected.",
  ],
  "ark.compat.default": [
    "Keep Ark prompts explicit and transport-safe.",
  ],
  "minimax.messages.default": [
    "Keep reasoning breadcrumbs ordered and replay-friendly across turns.",
  ],
  "minimax.compat.default": [
    "Use fallback-friendly wording and preserve compatible thinking hints.",
  ],
  "generic.compat.default": [
    "Keep prompts transport-safe and avoid provider-specific assumptions.",
  ],
};

const TOOL_POLICY_BLOCKED_BUILTINS: Record<string, string[]> = {
  "openai.tools.full": [],
  "anthropic.tools.full": [],
  "qwen.tools.conservative": ["browser_evaluate", "exec_command", "git_commit", "ppt_generate"],
  "kimi.tools.conservative": ["browser_evaluate", "git_commit", "ppt_generate"],
  "ark.tools.coding": ["browser_evaluate", "ppt_generate"],
  "minimax.tools.compat": ["browser_evaluate", "exec_command", "git_commit", "ppt_generate"],
  "generic.tools.default": [],
};

const TOOL_POLICY_ALLOWED_BUILTIN_GROUPS: Record<string, BuiltinToolSchemaGroup[]> = {
  "openai.tools.full": ["fs", "exec", "git", "http", "web", "ppt", "task", "browser"],
  "anthropic.tools.full": ["fs", "exec", "git", "http", "web", "ppt", "task", "browser"],
  "qwen.tools.conservative": ["fs", "git", "http", "web", "task", "browser"],
  "kimi.tools.conservative": ["fs", "exec", "git", "http", "web", "task", "browser"],
  "ark.tools.coding": ["fs", "exec", "git", "http", "web", "task", "browser"],
  "minimax.tools.compat": ["fs", "git", "http", "web", "task", "browser"],
  "generic.tools.default": ["fs", "exec", "git", "http", "web", "ppt", "task", "browser"],
};

const TOOL_POLICY_SUMMARY_LINES: Record<string, string[]> = {
  "openai.tools.full": [
    "Expose the full builtin tool surface when approvals allow it.",
  ],
  "anthropic.tools.full": [
    "Keep the full tool surface available with detailed descriptions.",
  ],
  "qwen.tools.conservative": [
    "Hide high-risk shell and browser script tools unless explicitly needed.",
  ],
  "kimi.tools.conservative": [
    "Prefer read/write and browser navigation tools over destructive git operations.",
  ],
  "ark.tools.coding": [
    "Favor coding and file tools over presentation or browser script tools.",
  ],
  "minimax.tools.compat": [
    "Keep the tool surface fallback-friendly for compatibility mode.",
  ],
  "generic.tools.default": [
    "Use the default builtin tool surface.",
  ],
};

const REASONING_PROFILE_LINES: Record<string, string[]> = {
  "openai.reasoning.native": [
    "Map reasoning effort directly into the native Responses reasoning object.",
  ],
  "openai.reasoning.compat": [
    "Use compatibility-safe reasoning effort patches when supported by the provider.",
  ],
  "anthropic.reasoning.native": [
    "Use Anthropic thinking budgets for deeper reasoning turns.",
  ],
  "qwen.reasoning.responses": [
    "Prefer medium/high effort for multi-step code and analysis turns.",
  ],
  "qwen.reasoning.messages": [
    "Favor structured, message-based reasoning when the Anthropic route is selected.",
  ],
  "qwen.reasoning.compat": [
    "Use compatibility-safe reasoning patches and replay breadcrumbs.",
  ],
  "kimi.reasoning.messages": [
    "Prefer Claude Code style reasoning continuity on the Anthropic route.",
  ],
  "kimi.reasoning.compat": [
    "Preserve reasoning_content compatibility without forcing native assumptions.",
  ],
  "ark.reasoning.responses": [
    "Prefer native Responses reasoning when Ark supports it.",
  ],
  "ark.reasoning.messages": [
    "Use Claude-style thinking budgets when the Anthropic route is selected.",
  ],
  "ark.reasoning.compat": [
    "Keep reasoning settings conservative on compatible transports.",
  ],
  "minimax.reasoning.messages": [
    "Prefer ordered reasoning replay for message-native MiniMax routes.",
  ],
  "minimax.reasoning.br-private": [
    "Map effort to MiniMax thinking_budget and preserve BR replay semantics.",
  ],
  "minimax.reasoning.compat": [
    "Use compatibility-safe reasoning patches when native replay is unavailable.",
  ],
  "generic.reasoning.compat": [
    "Use the default compatibility reasoning strategy.",
  ],
};

const VENDOR_POLICY_REGISTRY: Record<VendorFamily, VendorPolicy> = {
  openai: {
    vendorFamily: "openai",
    supportedProtocols: ["openai-responses", "openai-chat-compatible"],
    legacyProviderFamilies: ["openai-native"],
    recommendedProtocolsByUseCase: {
      default: ["openai-responses", "openai-chat-compatible"],
      coding: ["openai-responses", "openai-chat-compatible"],
      review: ["openai-responses", "openai-chat-compatible"],
    },
    defaultExperienceProfileId: "gpt-best",
    familyOverlayLines: [
      "Prefer Responses-native continuity hints when available.",
      "Keep tool contracts strict and schema-first.",
    ],
    promptPolicyIdByProtocol: {
      "openai-responses": "openai.responses.default",
      "openai-chat-compatible": "generic.compat.default",
    },
    toolPolicyIdByProtocol: {
      "openai-responses": "openai.tools.full",
      "openai-chat-compatible": "openai.tools.full",
    },
    reasoningProfileIdByProtocol: {
      "openai-responses": "openai.reasoning.native",
      "openai-chat-compatible": "openai.reasoning.compat",
    },
    toolCompileModesByProviderFamily: {
      "openai-native": "openai-strict",
    },
  },
  anthropic: {
    vendorFamily: "anthropic",
    supportedProtocols: ["anthropic-messages"],
    legacyProviderFamilies: ["anthropic-native"],
    recommendedProtocolsByUseCase: {
      default: ["anthropic-messages"],
      coding: ["anthropic-messages"],
      review: ["anthropic-messages"],
    },
    defaultExperienceProfileId: "claude-best",
    familyOverlayLines: [
      "Separate stable system guidance from task-specific asks.",
      "Prefer descriptive tool summaries and replay-friendly context.",
    ],
    promptPolicyIdByProtocol: {
      "anthropic-messages": "anthropic.messages.default",
    },
    toolPolicyIdByProtocol: {
      "anthropic-messages": "anthropic.tools.full",
    },
    reasoningProfileIdByProtocol: {
      "anthropic-messages": "anthropic.reasoning.native",
    },
    toolCompileModesByProviderFamily: {
      "anthropic-native": "anthropic-detailed-description",
    },
  },
  qwen: {
    vendorFamily: "qwen",
    supportedProtocols: ["openai-chat-compatible", "openai-responses", "anthropic-messages"],
    legacyProviderFamilies: ["qwen-dashscope"],
    recommendedProtocolsByUseCase: {
      default: ["openai-responses", "anthropic-messages", "openai-chat-compatible"],
      coding: ["anthropic-messages", "openai-responses", "openai-chat-compatible"],
      review: ["openai-responses", "anthropic-messages", "openai-chat-compatible"],
    },
    defaultExperienceProfileId: "qwen-best",
    familyOverlayLines: [
      "Assume compatible transport and conservative tool compilation.",
      "Do not rely on server-side continuity across turns.",
    ],
    promptPolicyIdByProtocol: {
      "openai-responses": "qwen.responses.default",
      "anthropic-messages": "qwen.messages.default",
      "openai-chat-compatible": "qwen.compat.default",
    },
    toolPolicyIdByProtocol: {
      "openai-responses": "qwen.tools.conservative",
      "anthropic-messages": "qwen.tools.conservative",
      "openai-chat-compatible": "qwen.tools.conservative",
    },
    reasoningProfileIdByProtocol: {
      "openai-responses": "qwen.reasoning.responses",
      "anthropic-messages": "qwen.reasoning.messages",
      "openai-chat-compatible": "qwen.reasoning.compat",
    },
    toolCompileModesByProviderFamily: {
      "qwen-dashscope": "openai-compatible-conservative",
    },
  },
  kimi: {
    vendorFamily: "kimi",
    supportedProtocols: ["anthropic-messages", "openai-chat-compatible"],
    recommendedProtocolsByUseCase: {
      default: ["anthropic-messages", "openai-chat-compatible"],
      coding: ["anthropic-messages", "openai-chat-compatible"],
      review: ["anthropic-messages", "openai-chat-compatible"],
    },
    defaultExperienceProfileId: "balanced",
    familyOverlayLines: [
      "Prefer Claude Code friendly continuity when available.",
      "Keep compatible replay hints explicit for long coding sessions.",
    ],
    promptPolicyIdByProtocol: {
      "anthropic-messages": "kimi.messages.default",
      "openai-chat-compatible": "kimi.compat.default",
    },
    toolPolicyIdByProtocol: {
      "anthropic-messages": "kimi.tools.conservative",
      "openai-chat-compatible": "kimi.tools.conservative",
    },
    reasoningProfileIdByProtocol: {
      "anthropic-messages": "kimi.reasoning.messages",
      "openai-chat-compatible": "kimi.reasoning.compat",
    },
  },
  "volcengine-ark": {
    vendorFamily: "volcengine-ark",
    supportedProtocols: ["openai-responses", "anthropic-messages", "openai-chat-compatible"],
    legacyProviderFamilies: ["volcengine-ark"],
    recommendedProtocolsByUseCase: {
      default: ["openai-responses", "anthropic-messages", "openai-chat-compatible"],
      coding: ["openai-responses", "anthropic-messages", "openai-chat-compatible"],
      review: ["openai-responses", "anthropic-messages", "openai-chat-compatible"],
    },
    defaultExperienceProfileId: "balanced",
    familyOverlayLines: [
      "Treat Ark as its own family for taxonomy and rollout, but use compatible-safe wording.",
      "Avoid hidden continuity assumptions.",
    ],
    promptPolicyIdByProtocol: {
      "openai-responses": "ark.responses.default",
      "anthropic-messages": "ark.messages.default",
      "openai-chat-compatible": "ark.compat.default",
    },
    toolPolicyIdByProtocol: {
      "openai-responses": "ark.tools.coding",
      "anthropic-messages": "ark.tools.coding",
      "openai-chat-compatible": "ark.tools.coding",
    },
    reasoningProfileIdByProtocol: {
      "openai-responses": "ark.reasoning.responses",
      "anthropic-messages": "ark.reasoning.messages",
      "openai-chat-compatible": "ark.reasoning.compat",
    },
    toolCompileModesByProviderFamily: {
      "volcengine-ark": "openai-compatible-ark",
    },
  },
  minimax: {
    vendorFamily: "minimax",
    supportedProtocols: ["anthropic-messages", "openai-chat-compatible", "openai-responses"],
    legacyProviderFamilies: ["br-minimax"],
    recommendedProtocolsByUseCase: {
      default: ["anthropic-messages", "openai-chat-compatible", "openai-responses"],
      coding: ["anthropic-messages", "openai-chat-compatible", "openai-responses"],
      review: ["anthropic-messages", "openai-chat-compatible", "openai-responses"],
    },
    defaultExperienceProfileId: "balanced",
    familyOverlayLines: [
      "Preserve reasoning replay hints for future turns.",
      "Keep fallback-friendly instructions explicit and ordered.",
    ],
    promptPolicyIdByProtocol: {
      "anthropic-messages": "minimax.messages.default",
      "openai-chat-compatible": "minimax.compat.default",
      "openai-responses": "minimax.compat.default",
    },
    toolPolicyIdByProtocol: {
      "anthropic-messages": "minimax.tools.compat",
      "openai-chat-compatible": "minimax.tools.compat",
      "openai-responses": "minimax.tools.compat",
    },
    reasoningProfileIdByProtocol: {
      "anthropic-messages": "minimax.reasoning.messages",
      "openai-chat-compatible": "minimax.reasoning.br-private",
      "openai-responses": "minimax.reasoning.compat",
    },
    toolCompileModesByProviderFamily: {
      "br-minimax": "openai-compatible-reasoning",
    },
    deploymentProfiles: ["br-private"],
  },
  "generic-openai-compatible": {
    vendorFamily: "generic-openai-compatible",
    supportedProtocols: ["openai-chat-compatible"],
    legacyProviderFamilies: ["generic-openai-compatible"],
    recommendedProtocolsByUseCase: {
      default: ["openai-chat-compatible"],
      coding: ["openai-chat-compatible"],
      review: ["openai-chat-compatible"],
    },
    defaultExperienceProfileId: "balanced",
    familyOverlayLines: [
      "Default to the safest compatible prompt shape.",
      "Avoid provider-specific wire assumptions.",
    ],
    promptPolicyIdByProtocol: {
      "openai-chat-compatible": "generic.compat.default",
    },
    toolPolicyIdByProtocol: {
      "openai-chat-compatible": "generic.tools.default",
    },
    reasoningProfileIdByProtocol: {
      "openai-chat-compatible": "generic.reasoning.compat",
    },
    toolCompileModesByProviderFamily: {
      "generic-openai-compatible": "openai-compatible-relaxed",
    },
  },
  "generic-local-gateway": {
    vendorFamily: "generic-local-gateway",
    supportedProtocols: ["openai-chat-compatible"],
    recommendedProtocolsByUseCase: {
      default: ["openai-chat-compatible"],
      coding: ["openai-chat-compatible"],
      review: ["openai-chat-compatible"],
    },
    defaultExperienceProfileId: "balanced",
    familyOverlayLines: [
      "Default to the safest compatible prompt shape.",
      "Avoid provider-specific wire assumptions.",
    ],
    promptPolicyIdByProtocol: {
      "openai-chat-compatible": "generic.compat.default",
    },
    toolPolicyIdByProtocol: {
      "openai-chat-compatible": "generic.tools.default",
    },
    reasoningProfileIdByProtocol: {
      "openai-chat-compatible": "generic.reasoning.compat",
    },
  },
};

/** 返回指定厂商的运行时策略定义，作为后续协议与策略收口的统一入口。 */
export function getVendorPolicy(vendorFamily: VendorFamily): VendorPolicy {
  return VENDOR_POLICY_REGISTRY[vendorFamily];
}

/** 列出全部厂商策略，供测试和后续设置页/探测逻辑枚举。 */
export function listVendorPolicies(): VendorPolicy[] {
  return Object.values(VENDOR_POLICY_REGISTRY);
}

/** 按 legacy provider family 反查对应厂商策略，便于平滑把旧 family 分支迁到 registry。 */
export function getVendorPolicyByProviderFamily(providerFamily: ProviderFamily): VendorPolicy | null {
  return listVendorPolicies().find((policy) => policy.legacyProviderFamilies?.includes(providerFamily)) ?? null;
}

/** 读取 provider family 对应的 prompt overlay 行，为 prompt composer 提供 registry 驱动的数据源。 */
export function resolvePromptOverlayLines(providerFamily: ProviderFamily): string[] {
  return getVendorPolicyByProviderFamily(providerFamily)?.familyOverlayLines ?? [
    "Default to the safest compatible prompt shape.",
    "Avoid provider-specific wire assumptions.",
  ];
}

/** 读取 provider family 对应的默认体验档位，避免体验档位继续散落在 resolver 的 if/else 中。 */
export function resolveDefaultExperienceProfileId(providerFamily: ProviderFamily): ExperienceProfileId | null {
  return getVendorPolicyByProviderFamily(providerFamily)?.defaultExperienceProfileId ?? null;
}

/** 读取 provider family 对应的工具编译模式，供 turn plan 和 tool middleware 统一消费。 */
export function resolveRegistryToolCompileMode(providerFamily: ProviderFamily): string | null {
  return getVendorPolicyByProviderFamily(providerFamily)?.toolCompileModesByProviderFamily?.[providerFamily] ?? null;
}

/** 读取 promptPolicyId 对应的额外提示词片段，让不同厂商/协议拥有独立补充提示。 */
export function resolvePromptProfileLines(promptPolicyId: string): string[] {
  return PROMPT_POLICY_LINES[promptPolicyId] ?? [];
}

/** 读取 toolPolicyId 对应需要屏蔽的 builtin tools，作为厂商级工具暴露策略。 */
export function resolveBlockedBuiltinToolNames(toolPolicyId: string): string[] {
  return TOOL_POLICY_BLOCKED_BUILTINS[toolPolicyId] ?? [];
}

/** 读取 toolPolicyId 对应的摘要说明，供提示词向模型解释当前工具暴露策略。 */
export function resolveToolPolicySummaryLines(toolPolicyId: string): string[] {
  return TOOL_POLICY_SUMMARY_LINES[toolPolicyId] ?? [];
}

/** 读取 toolPolicyId 对应允许暴露给模型的 builtin tool 分组。 */
export function resolveAllowedBuiltinToolGroups(toolPolicyId: string): BuiltinToolSchemaGroup[] {
  return TOOL_POLICY_ALLOWED_BUILTIN_GROUPS[toolPolicyId] ?? TOOL_POLICY_ALLOWED_BUILTIN_GROUPS["generic.tools.default"];
}

/** 根据 provider family 与协议解析 prompt policy id。 */
export function resolvePromptPolicyId(
  providerFamily: ProviderFamily,
  protocolTarget: ProtocolTarget,
): string {
  return getVendorPolicyByProviderFamily(providerFamily)?.promptPolicyIdByProtocol?.[protocolTarget]
    ?? "generic.compat.default";
}

/** 根据 provider family 与协议解析 tool policy id。 */
export function resolveToolPolicyId(
  providerFamily: ProviderFamily,
  protocolTarget: ProtocolTarget,
): string {
  return getVendorPolicyByProviderFamily(providerFamily)?.toolPolicyIdByProtocol?.[protocolTarget]
    ?? "generic.tools.default";
}

/** 根据 provider family 与协议解析 reasoning profile id。 */
export function resolveReasoningProfileId(
  providerFamily: ProviderFamily,
  protocolTarget: ProtocolTarget,
): string {
  return getVendorPolicyByProviderFamily(providerFamily)?.reasoningProfileIdByProtocol?.[protocolTarget]
    ?? "generic.reasoning.compat";
}

/** 读取 reasoningProfileId 对应的摘要说明，供提示词解释当前推理策略。 */
export function resolveReasoningProfileLines(reasoningProfileId: string): string[] {
  return REASONING_PROFILE_LINES[reasoningProfileId] ?? [];
}

export { VENDOR_POLICY_REGISTRY };
