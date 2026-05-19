import type {
  CanonicalToolSpec,
  ModelCapability,
  ProtocolTarget,
  ProviderFamily,
  VendorFamily,
} from "@shared/contracts";

export type ToolDefinitionShape = "openaiResponsesFunction" | "openaiChatFunction" | "anthropicInputSchema";
export type ProviderStrictMode = "required" | "supported" | "disabled" | "betaOnly";
export type ProviderSchemaCompatibility = "strict-json-schema" | "common-json-schema" | "relaxed-json-schema";
export type ProviderParallelToolCalls = "supported" | "disabled" | "non-native-only";
export type ProviderToolSearchMode = "enabled" | "disabled";
export type ProviderResultReplayFormat = "openai-function-call-output" | "openai-chat-tool-message" | "anthropic-tool-result-block";

export type ProviderToolPolicy = {
  protocolTarget: ProtocolTarget;
  toolDefinitionShape: ToolDefinitionShape;
  strictMode: ProviderStrictMode;
  schemaCompatibility: ProviderSchemaCompatibility;
  toolChoiceModes: Array<"auto" | "none" | "required" | "forced" | "allowed_tools">;
  parallelToolCalls: ProviderParallelToolCalls;
  nativeTools: string[];
  toolSearch: ProviderToolSearchMode;
  streamParser: "openai-responses" | "openai-chat-compatible" | "anthropic-messages";
  resultReplayFormat: ProviderResultReplayFormat;
  unsupportedFields: string[];
  fallbackBehavior: "strict-to-relaxed" | "native-to-managed-local" | "disable-tools";
};

export type ResolveProviderToolPolicyInput = {
  providerFamily: ProviderFamily;
  protocolTarget: ProtocolTarget;
  vendorFamily?: VendorFamily;
  capability?: Pick<
    ModelCapability,
    | "source"
    | "supportsTools"
    | "supportsStreamingToolCalls"
    | "supportsParallelToolCalls"
    | "supportsStrictToolSchema"
    | "supportsToolChoiceForced"
    | "supportsToolSearch"
    | "supportsNativeWebSearch"
    | "supportsNativeWebExtractor"
    | "supportsNativeComputer"
    | "supportsNativeCodeInterpreter"
    | "supportsNativeFileSearch"
    | "supportsAnthropicToolResultBlocks"
    | "requiresReasoningReplay"
  > | null;
  deploymentProfile?: string | null;
};

const RELAXED_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "enum",
  "items",
  "minItems",
  "maxItems",
]);

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** 为 OpenAI strict 工具递归补齐对象 schema 约束，避免 Responses 请求被 schema 拒绝。 */
export function ensureStrictToolSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const schema = cloneRecord(inputSchema);
  if (!schema.type) {
    schema.type = "object";
  }

  if (schema.type === "object") {
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, unknown>
      : {};
    const normalizedProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      normalizedProperties[key] = value && typeof value === "object" && !Array.isArray(value)
        ? ensureStrictToolSchema(value as Record<string, unknown>)
        : value;
    }
    schema.properties = normalizedProperties;
    schema.required = Object.keys(normalizedProperties);
    schema.additionalProperties = false;
  }

  if (schema.type === "array" && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    schema.items = ensureStrictToolSchema(schema.items as Record<string, unknown>);
  }

  return schema;
}

/** 生成 provider 通用对象 schema，保留常见 JSON Schema 字段。 */
export function ensureCommonToolSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const schema = cloneRecord(inputSchema);
  if (!schema.type) {
    schema.type = "object";
  }
  if (schema.type === "object") {
    schema.properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties
      : {};
    schema.required = Array.isArray(schema.required) ? schema.required : [];
  }
  return schema;
}

/** 为本地或泛兼容模型降级 schema，避免发送不稳定高级约束导致 provider 拒绝请求。 */
export function ensureRelaxedToolSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const schema = ensureCommonToolSchema(inputSchema);
  const relaxed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!RELAXED_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      relaxed.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([propertyKey, propertyValue]) => [
          propertyKey,
          propertyValue && typeof propertyValue === "object" && !Array.isArray(propertyValue)
            ? ensureRelaxedToolSchema(propertyValue as Record<string, unknown>)
            : propertyValue,
        ]),
      );
      continue;
    }
    if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
      relaxed.items = ensureRelaxedToolSchema(value as Record<string, unknown>);
      continue;
    }
    relaxed[key] = value;
  }
  return relaxed;
}

function resolveNativeTools(input: ResolveProviderToolPolicyInput): string[] {
  if (input.protocolTarget !== "openai-responses") return [];
  const capability = input.capability;
  const nativeTools: string[] = [];
  if (capability?.supportsNativeWebSearch) nativeTools.push("web_search");
  if (capability?.supportsNativeWebExtractor) nativeTools.push("web_extractor");
  if (capability?.supportsNativeComputer) nativeTools.push("computer");
  if (capability?.supportsNativeCodeInterpreter) nativeTools.push("code_interpreter");
  if (capability?.supportsNativeFileSearch) nativeTools.push("file_search");
  return nativeTools;
}

/** 按模型供应商、协议和探测能力解析本轮工具编译策略。 */
export function resolveProviderToolPolicy(input: ResolveProviderToolPolicyInput): ProviderToolPolicy {
  if (input.capability?.supportsTools === false || input.capability?.supportsStreamingToolCalls === false) {
    return {
      protocolTarget: input.protocolTarget,
      toolDefinitionShape: "openaiChatFunction",
      strictMode: "disabled",
      schemaCompatibility: "relaxed-json-schema",
      toolChoiceModes: ["none"],
      parallelToolCalls: "disabled",
      nativeTools: [],
      toolSearch: "disabled",
      streamParser: "openai-chat-compatible",
      resultReplayFormat: "openai-chat-tool-message",
      unsupportedFields: ["tools"],
      fallbackBehavior: "disable-tools",
    };
  }

  if (input.protocolTarget === "anthropic-messages") {
    if (input.capability?.supportsAnthropicToolResultBlocks === false) {
      return {
        protocolTarget: input.protocolTarget,
        toolDefinitionShape: "anthropicInputSchema",
        strictMode: "disabled",
        schemaCompatibility: "common-json-schema",
        toolChoiceModes: ["none"],
        parallelToolCalls: "disabled",
        nativeTools: [],
        toolSearch: "disabled",
        streamParser: "anthropic-messages",
        resultReplayFormat: "anthropic-tool-result-block",
        unsupportedFields: ["tools"],
        fallbackBehavior: "disable-tools",
      };
    }
    return {
      protocolTarget: input.protocolTarget,
      toolDefinitionShape: "anthropicInputSchema",
      strictMode: "disabled",
      schemaCompatibility: "common-json-schema",
      toolChoiceModes: ["auto", "none"],
      parallelToolCalls: input.capability?.supportsParallelToolCalls === false ? "disabled" : "supported",
      nativeTools: [],
      toolSearch: "disabled",
      streamParser: "anthropic-messages",
      resultReplayFormat: "anthropic-tool-result-block",
      unsupportedFields: ["strict", "parallel_tool_calls"],
      fallbackBehavior: "strict-to-relaxed",
    };
  }

  if (input.protocolTarget === "openai-responses") {
    const nativeTools = resolveNativeTools(input);
    const strictSupported = input.capability?.supportsStrictToolSchema !== false;
    const forcedChoiceSupported = input.capability?.supportsToolChoiceForced !== false;
    return {
      protocolTarget: input.protocolTarget,
      toolDefinitionShape: "openaiResponsesFunction",
      strictMode: strictSupported ? "required" : "disabled",
      schemaCompatibility: strictSupported ? "strict-json-schema" : "common-json-schema",
      toolChoiceModes: forcedChoiceSupported
        ? ["auto", "none", "required", "forced", "allowed_tools"]
        : ["auto", "none"],
      parallelToolCalls: input.capability?.supportsParallelToolCalls === false
        ? "disabled"
        : nativeTools.length > 0
          ? "non-native-only"
          : "supported",
      nativeTools,
      toolSearch: input.capability?.supportsToolSearch ? "enabled" : "disabled",
      streamParser: "openai-responses",
      resultReplayFormat: "openai-function-call-output",
      unsupportedFields: [],
      fallbackBehavior: "native-to-managed-local",
    };
  }

  const genericOrLocal = input.vendorFamily === "generic-local-gateway" || input.providerFamily === "generic-openai-compatible";
  const forcedChoiceSupported = input.capability?.supportsToolChoiceForced !== false;
  const strictSupported = input.capability?.supportsStrictToolSchema === true;
  return {
    protocolTarget: input.protocolTarget,
    toolDefinitionShape: "openaiChatFunction",
    strictMode: genericOrLocal
      ? "disabled"
      : input.vendorFamily === "deepseek"
        ? "betaOnly"
        : strictSupported
          ? "supported"
          : "disabled",
    schemaCompatibility: genericOrLocal ? "relaxed-json-schema" : "common-json-schema",
    toolChoiceModes: genericOrLocal || !forcedChoiceSupported ? ["auto", "none"] : ["auto", "none", "required", "forced"],
    parallelToolCalls: genericOrLocal || input.capability?.supportsParallelToolCalls === false ? "disabled" : "supported",
    nativeTools: [],
    toolSearch: "disabled",
    streamParser: "openai-chat-compatible",
    resultReplayFormat: "openai-chat-tool-message",
    unsupportedFields: genericOrLocal ? ["strict", "parallel_tool_calls", "native_tools", "tool_search"] : ["native_tools", "tool_search"],
    fallbackBehavior: "strict-to-relaxed",
  };
}

function schemaForPolicy(spec: CanonicalToolSpec, policy: ProviderToolPolicy): Record<string, unknown> {
  if (policy.schemaCompatibility === "strict-json-schema") return ensureStrictToolSchema(spec.parameters);
  if (policy.schemaCompatibility === "relaxed-json-schema") return ensureRelaxedToolSchema(spec.parameters);
  return ensureCommonToolSchema(spec.parameters);
}

/** 将 canonical tool spec 编译成当前 provider 协议真正需要的 wire tools。 */
export function compileToolsForProviderPolicy(specs: CanonicalToolSpec[], policy: ProviderToolPolicy): unknown[] {
  if (policy.unsupportedFields.includes("tools") || policy.fallbackBehavior === "disable-tools") {
    return [];
  }
  return specs.map((spec) => {
    const parameters = schemaForPolicy(spec, policy);
    if (policy.toolDefinitionShape === "anthropicInputSchema") {
      return {
        name: spec.name,
        description: spec.description,
        input_schema: parameters,
      };
    }
    if (policy.toolDefinitionShape === "openaiResponsesFunction") {
      return {
        type: "function",
        name: spec.name,
        description: spec.description,
        parameters,
        ...(policy.strictMode === "required" ? { strict: true } : {}),
      };
    }
    return {
      type: "function",
      function: {
        name: spec.name,
        description: spec.description,
        parameters,
        ...(policy.strictMode === "supported" ? { strict: true } : {}),
      },
    };
  });
}
