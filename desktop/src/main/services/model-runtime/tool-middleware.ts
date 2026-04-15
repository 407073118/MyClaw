import type {
  CanonicalToolCall,
  CanonicalToolResult,
  CanonicalToolSpec,
  ModelProfile,
  ProviderFamily,
} from "@shared/contracts";

import { resolveToolCompileMode } from "./turn-execution-plan-resolver";

export type CompiledToolBundle = {
  target: ProviderFamily;
  compileMode: string;
  tools: unknown[];
  registry: CanonicalToolSpec[];
};

export type NativeFileSearchConfig = {
  vectorStoreIds: string[];
  maxNumResults?: number;
  includeSearchResults?: boolean;
};

export type ToolMiddlewareDelegates = {
  requestApproval?: (calls: CanonicalToolCall[]) => Promise<Array<{ toolCallId: string; approved: boolean; reason?: string | null }>>;
  executeToolCalls?: (calls: CanonicalToolCall[]) => Promise<CanonicalToolResult[]>;
};

export class ToolMiddleware {
  constructor(private readonly delegates: ToolMiddlewareDelegates = {}) {}

  /** 按 provider family 编译工具定义，输出协议需要的 wire shape。 */
  compile(specs: CanonicalToolSpec[], target: ProviderFamily): CompiledToolBundle {
    const compileMode = resolveToolCompileMode(target);
    const tools = target === "anthropic-native"
      ? specs.map((spec) => ({
          name: spec.name,
          description: spec.description,
          input_schema: ensureSchema(spec.parameters),
        }))
      : specs.map((spec) => ({
          type: "function",
          function: {
            name: spec.name,
            description: spec.description,
            parameters: compileMode === "openai-strict"
              ? ensureStrictSchema(spec.parameters)
              : ensureSchema(spec.parameters),
          },
        }));

    return {
      target,
      compileMode,
      tools,
      registry: specs,
    };
  }

  /** 请求工具审批；默认全部批准，方便 legacy shim 平滑接入。 */
  async requestApproval(calls: CanonicalToolCall[]): Promise<Array<{ toolCallId: string; approved: boolean; reason?: string | null }>> {
    if (this.delegates.requestApproval) {
      return this.delegates.requestApproval(calls);
    }
    return calls.map((call) => ({ toolCallId: call.id, approved: true, reason: null }));
  }

  /** 执行 canonical 工具调用；默认返回未配置占位结果。 */
  async execute(calls: CanonicalToolCall[]): Promise<CanonicalToolResult[]> {
    if (this.delegates.executeToolCalls) {
      return this.delegates.executeToolCalls(calls);
    }
    return calls.map((call) => ({
      toolCallId: call.id,
      name: call.name,
      success: false,
      output: "",
      error: "tool middleware executor not configured",
    }));
  }

  /** 归一化工具结果，保证持久化与观测字段稳定。 */
  normalizeResults(results: CanonicalToolResult[]): CanonicalToolResult[] {
    return results.map((result) => ({
      ...result,
      output: result.output ?? "",
      error: result.error ?? null,
      metadata: result.metadata ?? {},
    }));
  }
}

/** 对对象 schema 补齐基础结构。 */
export function ensureSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    required: [],
    ...inputSchema,
  };
}

/** 为 strict 编译模式补齐 additionalProperties=false。 */
export function ensureStrictSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const schema = ensureSchema(inputSchema);
  if (schema.type === "object" && schema.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }
  return schema;
}

/** 创建默认工具中间层。 */
/** 解析 profile 中声明的原生 file search 配置，并兼容 requestBody 里的高级覆写。 */
export function resolveNativeFileSearchConfig(
  profile: Pick<ModelProfile, "responsesApiConfig" | "requestBody">,
): NativeFileSearchConfig | null {
  const explicitConfig = profile.responsesApiConfig?.fileSearch;
  if (explicitConfig && explicitConfig.vectorStoreIds.length > 0) {
    return {
      vectorStoreIds: explicitConfig.vectorStoreIds,
      maxNumResults: explicitConfig.maxNumResults,
      includeSearchResults: explicitConfig.includeSearchResults,
    };
  }

  const requestBody = profile.requestBody;
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return null;
  }

  const candidate = (
    (requestBody.nativeFileSearch && typeof requestBody.nativeFileSearch === "object" && !Array.isArray(requestBody.nativeFileSearch))
      ? requestBody.nativeFileSearch
      : (requestBody.fileSearch && typeof requestBody.fileSearch === "object" && !Array.isArray(requestBody.fileSearch))
        ? requestBody.fileSearch
        : (requestBody.file_search && typeof requestBody.file_search === "object" && !Array.isArray(requestBody.file_search))
          ? requestBody.file_search
          : null
  ) as Record<string, unknown> | null;

  if (!candidate) {
    return null;
  }

  const vectorStoreIds = Array.isArray(candidate.vectorStoreIds)
    ? candidate.vectorStoreIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : Array.isArray(candidate.vector_store_ids)
      ? candidate.vector_store_ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  if (vectorStoreIds.length === 0) {
    return null;
  }

  return {
    vectorStoreIds,
    maxNumResults: typeof candidate.maxNumResults === "number"
      ? candidate.maxNumResults
      : typeof candidate.max_num_results === "number"
        ? candidate.max_num_results
        : undefined,
    includeSearchResults: typeof candidate.includeSearchResults === "boolean"
      ? candidate.includeSearchResults
      : typeof candidate.include_search_results === "boolean"
        ? candidate.include_search_results
        : undefined,
  };
}

export function createToolMiddleware(delegates?: ToolMiddlewareDelegates): ToolMiddleware {
  return new ToolMiddleware(delegates);
}
