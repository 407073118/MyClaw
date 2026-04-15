import type {
  BackgroundTaskHandle,
  CapabilityEvent,
  ComputerAction,
  ComputerCall,
  CapabilityExecutionRoute,
  CanonicalToolSpec,
  CitationRecord,
  VendorFamily,
} from "@shared/contracts";
import { buildRequestHeaders, callModel } from "../../model-client";
import { executeRequestVariants } from "../../model-transport";
import { resolveBackgroundModePolicy } from "../background-mode-policy";
import { canonicalTurnContentToLegacyMessages } from "../canonical-turn-content";
import { normalizeVendorCitation } from "../citation-normalizer";
import { normalizeVendorTraceEvent } from "../trace-normalizer";
import { resolveNativeFileSearchConfig } from "../tool-middleware";
import type { ProtocolDriver, ProtocolExecutionOutput } from "./shared";
import { buildCanonicalRequestMessages, buildLegacyShimTransportMetadata } from "./shared";

type ResponsesToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

type ResponsesStreamState = {
  responseId: string | null;
  contentParts: string[];
  reasoningParts: string[];
  toolCalls: Map<string, ResponsesToolCallAccumulator>;
  capabilityEvents: CapabilityEvent[];
  citations: CitationRecord[];
  computerCalls: ComputerCall[];
  seenCitationIds: Set<string>;
  latestWebSearchTraceId: string | null;
  activeToolCallId: string | null;
  finishReason: string | null;
  usage: ProtocolExecutionOutput["usage"];
};

/** 读取 Responses API 时，先去掉用户可能误带的接口后缀。 */
function stripEndpointSuffixes(url: string): string {
  return url
    .replace(/\/(chat\/completions|responses|messages)$/i, "")
    .replace(/\/(compatible-mode\/v1|v1)$/i, "")
    .replace(/\/+$/, "");
}

/** 解析 OpenAI Responses API 地址，兼容 manual / provider-root 两种 baseUrl 语义。 */
function resolveResponsesApiUrl(profile: { baseUrl: string }): string {
  return `${stripEndpointSuffixes(profile.baseUrl)}/v1/responses`;
}

/** 将文本或多模态内容转成 Responses API 可接受的输入块。 */
function normalizeResponsesContent(content: unknown): unknown {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }

  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((part) => {
    if (!part || typeof part !== "object") {
      return part;
    }

    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return { type: "input_text", text: record.text };
    }

    return record;
  });
}

/** 将 canonical request messages 转成 Responses API 的 instructions + input 形状。 */
function buildResponsesInput(messages: Array<{ role: string; content: unknown }>): {
  instructions?: string;
  input: Array<Record<string, unknown>>;
} {
  const instructions: string[] = [];
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") {
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      if (content.trim()) {
        instructions.push(content);
      }
      continue;
    }

    input.push({
      role: message.role,
      content: normalizeResponsesContent(message.content),
    });
  }

  return {
    ...(instructions.length > 0 ? { instructions: instructions.join("\n\n") } : {}),
    input,
  };
}

/** 兼容不同 Responses SSE 包体，优先抽取 output item 本体。 */
function resolveResponsesOutputItem(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as Record<string, unknown>;
  if (payload.item && typeof payload.item === "object") {
    return payload.item as Record<string, unknown>;
  }
  if (payload.output_item && typeof payload.output_item === "object") {
    return payload.output_item as Record<string, unknown>;
  }
  return payload;
}

/** 判断当前能力路由是否要求注入原生 web_search built-in tool。 */
function shouldInjectNativeWebSearch(capabilityRoutes?: CapabilityExecutionRoute[]): boolean {
  return shouldInjectNativeResponsesTool("web_search", capabilityRoutes);
}

/** 判断当前能力路由是否要求注入原生 computer built-in tool。 */
function shouldInjectNativeComputer(capabilityRoutes?: CapabilityExecutionRoute[]): boolean {
  return shouldInjectNativeResponsesTool("computer", capabilityRoutes);
}

/** 判断当前能力路由是否需要注入原生 file_search built-in tool。 */
function shouldInjectNativeFileSearch(capabilityRoutes?: CapabilityExecutionRoute[]): boolean {
  return shouldInjectNativeResponsesTool("file_search", capabilityRoutes);
}

/** 收集当前 Responses 路由允许注入的原生 built-in tool，统一供不同厂商分支复用。 */
function collectNativeResponsesToolNames(capabilityRoutes?: CapabilityExecutionRoute[]): string[] {
  const orderedNativeToolNames = ["web_search", "web_extractor", "computer", "code_interpreter", "file_search"];
  const availableToolNames = new Set(
    capabilityRoutes
      ?.filter((route) => route.routeType === "vendor-native" && typeof route.nativeToolName === "string")
      .map((route) => route.nativeToolName as string)
      ?? [],
  );
  if (availableToolNames.has("web_extractor")) {
    availableToolNames.add("web_search");
  }

  return orderedNativeToolNames.filter((toolName) => availableToolNames.has(toolName));
}

function resolveRawResponsesTool(
  toolName: string,
  toolRegistry?: CanonicalToolSpec[] | null,
): Record<string, unknown> | null {
  if (!toolName || !toolRegistry || toolRegistry.length === 0) {
    return null;
  }

  const matchedTool = toolRegistry.find((tool) => tool.name === toolName || tool.id === toolName);
  const rawTool = matchedTool?.metadata?.rawResponsesTool;
  if (!rawTool || typeof rawTool !== "object" || Array.isArray(rawTool)) {
    return null;
  }

  return rawTool as Record<string, unknown>;
}

/** 判断当前能力路由是否要求注入指定的原生 built-in tool。 */
function shouldInjectNativeResponsesTool(
  nativeToolName: string,
  capabilityRoutes?: CapabilityExecutionRoute[],
): boolean {
  return collectNativeResponsesToolNames(capabilityRoutes).includes(nativeToolName);
}

/** 将通用推理档位映射为 Qwen Responses 的 thinking_budget。 */
function resolveQwenResponsesThinkingBudget(
  reasoningEffort?: "low" | "medium" | "high" | "xhigh",
): number | undefined {
  switch (reasoningEffort) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    case "xhigh":
      return 16384;
    default:
      return undefined;
  }
}

/** 将 openai-compatible 风格工具定义转换为 Responses API 所需的函数工具格式。 */
function normalizeResponsesTools(
  tools: unknown[],
  capabilityRoutes?: CapabilityExecutionRoute[],
  toolRegistry?: CanonicalToolSpec[] | null,
  nativeFileSearch?: {
    vectorStoreIds: string[];
    maxNumResults?: number;
  } | null,
): unknown[] {
  const nativeToolNames = collectNativeResponsesToolNames(capabilityRoutes);
  const normalizedTools = tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") {
      return [tool];
    }

    const record = tool as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object"
      ? record.function as Record<string, unknown>
      : null;

    if (!fn) {
      return [record];
    }

    if (typeof fn.name === "string" && nativeToolNames.includes(fn.name)) {
      return [];
    }

    const rawResponsesTool = typeof fn.name === "string"
      ? resolveRawResponsesTool(fn.name, toolRegistry)
      : null;
    if (rawResponsesTool) {
      return [rawResponsesTool];
    }

    return {
      type: "function",
      name: typeof fn.name === "string" ? fn.name : "",
      description: typeof fn.description === "string" ? fn.description : "",
      parameters: fn.parameters ?? {},
    };
  });

  const builtInTools: unknown[] = [];

  for (const nativeToolName of nativeToolNames) {
    if (nativeToolName === "file_search" && !nativeFileSearch) {
      continue;
    }

    const hasNativeTool = normalizedTools.some((tool) =>
      !!tool
      && typeof tool === "object"
      && (tool as Record<string, unknown>).type === nativeToolName,
    );
    if (hasNativeTool) {
      continue;
    }

    if (nativeToolName === "file_search") {
      const fileSearchConfig = nativeFileSearch;
      if (!fileSearchConfig) {
        continue;
      }
      builtInTools.push({
        type: "file_search",
        vector_store_ids: fileSearchConfig.vectorStoreIds,
        ...(typeof fileSearchConfig.maxNumResults === "number"
          ? { max_num_results: fileSearchConfig.maxNumResults }
          : {}),
      });
      continue;
    }

    builtInTools.push({ type: nativeToolName });
  }

  return [...builtInTools, ...normalizedTools];
}

/** 把 output_text.annotations 里的 url_citation 转成统一 citation 记录。 */
function collectCitationsFromMessageItem(item: Record<string, unknown>, state: ResponsesStreamState): void {
  const contentParts = Array.isArray(item.content) ? item.content : [];
  for (const contentPart of contentParts) {
    if (!contentPart || typeof contentPart !== "object") {
      continue;
    }

    const contentRecord = contentPart as Record<string, unknown>;
    const text = typeof contentRecord.text === "string" ? contentRecord.text : "";
    const annotations = Array.isArray(contentRecord.annotations) ? contentRecord.annotations : [];
    for (const annotation of annotations) {
      if (!annotation || typeof annotation !== "object") {
        continue;
      }

      const annotationRecord = annotation as Record<string, unknown>;
      let citation: CitationRecord | null = null;
      if (annotationRecord.type === "url_citation" && typeof annotationRecord.url === "string") {
        const startIndex = typeof annotationRecord.start_index === "number" ? annotationRecord.start_index : null;
        const endIndex = typeof annotationRecord.end_index === "number" ? annotationRecord.end_index : null;
        citation = normalizeVendorCitation({
          sourceType: "vendor-web-search",
          traceRef: state.latestWebSearchTraceId,
          annotation: {
            url: annotationRecord.url,
            title: typeof annotationRecord.title === "string" ? annotationRecord.title : null,
            text,
            start_index: startIndex,
            end_index: endIndex,
          },
        });
      } else if (annotationRecord.type === "file_citation") {
        citation = normalizeVendorCitation({
          sourceType: "file-search",
          annotation: {
            title: typeof annotationRecord.filename === "string" ? annotationRecord.filename : null,
            file_id: typeof annotationRecord.file_id === "string" ? annotationRecord.file_id : null,
            filename: typeof annotationRecord.filename === "string" ? annotationRecord.filename : null,
            text,
            index: typeof annotationRecord.index === "number" ? annotationRecord.index : null,
          },
        });
      }
      if (!citation) {
        continue;
      }
      const citationId = citation.id;
      if (state.seenCitationIds.has(citationId)) {
        continue;
      }
      state.seenCitationIds.add(citationId);
      state.citations.push(citation);
    }
  }
}

/** 从静态 message output item 中提取最终文本，供非流式 background retrieve 复用。 */
function collectMessageTextFromMessageItem(item: Record<string, unknown>, state: ResponsesStreamState): void {
  const contentParts = Array.isArray(item.content) ? item.content : [];
  for (const contentPart of contentParts) {
    if (!contentPart || typeof contentPart !== "object") {
      continue;
    }

    const contentRecord = contentPart as Record<string, unknown>;
    if (contentRecord.type === "output_text" && typeof contentRecord.text === "string" && contentRecord.text) {
      state.contentParts.push(contentRecord.text);
    }
  }
}

/** 把原生 web_search_call 记录成 capability trace，供后续 UI 和持久化使用。 */
function collectCapabilityEventFromWebSearchItem(
  item: Record<string, unknown>,
  state: ResponsesStreamState,
  vendor: VendorFamily | undefined,
): void {
  const traceId = typeof item.id === "string" ? item.id : "";
  if (!traceId) {
    return;
  }

  const action = item.action && typeof item.action === "object"
    ? item.action as Record<string, unknown>
    : {};
  const actionType = typeof action.type === "string"
    ? action.type
    : typeof item.action === "string"
      ? item.action
      : "search";
  state.latestWebSearchTraceId = traceId;

  state.capabilityEvents.push(normalizeVendorTraceEvent({
    source: "openai-responses",
    eventType: "web_search_call",
    vendor,
    item: {
      traceId,
      status: typeof item.status === "string" ? item.status : null,
      action: actionType,
      queries: Array.isArray(action.queries)
        ? action.queries.filter((query): query is string => typeof query === "string")
        : null,
      url: typeof action.url === "string" ? action.url : null,
      pattern: typeof action.pattern === "string" ? action.pattern : null,
    },
  }));
}

/** 把原生 file_search_call 记录成知识检索 trace，供后续 UI 与持久化使用。 */
function collectCapabilityEventFromFileSearchItem(
  item: Record<string, unknown>,
  state: ResponsesStreamState,
  vendor: VendorFamily | undefined,
): void {
  const traceId = typeof item.id === "string" ? item.id : "";
  if (!traceId) {
    return;
  }

  state.capabilityEvents.push(normalizeVendorTraceEvent({
    source: "openai-responses",
    eventType: "file_search_call",
    vendor,
    item: {
      traceId,
      status: typeof item.status === "string" ? item.status : null,
      queries: Array.isArray(item.queries)
        ? item.queries.filter((query): query is string => typeof query === "string")
        : null,
      results: Array.isArray(item.results) ? item.results : null,
    },
  }));
}

/** 将 native computer_call 记录成能力事件，并保留动作批次供后续 harness 继续执行。 */
function collectComputerCallFromItem(
  item: Record<string, unknown>,
  state: ResponsesStreamState,
  vendor: VendorFamily | undefined,
): void {
  const callId = typeof item.call_id === "string"
    ? item.call_id
    : typeof item.id === "string"
      ? item.id
      : "";
  const actions = Array.isArray(item.actions)
    ? item.actions.filter((action): action is Record<string, unknown> => !!action && typeof action === "object")
    : [];
  if (!callId) {
    return;
  }

  state.computerCalls.push({
    id: callId,
    callId,
    status: typeof item.status === "string" ? item.status : null,
    actions: actions.map((action) => action as unknown as ComputerAction),
  });
  state.capabilityEvents.push(normalizeVendorTraceEvent({
    source: "openai-responses",
    eventType: "computer_call",
    vendor,
    item: {
      callId,
      status: typeof item.status === "string" ? item.status : null,
      actionCount: actions.length,
    },
  }));
}

/** 统一处理 Responses output item，兼容 function / web search / computer / message 四类输出。 */
function collectResponsesOutputItem(
  item: Record<string, unknown>,
  state: ResponsesStreamState,
  vendor: VendorFamily | undefined,
): void {
  if (item.type === "web_search_call") {
    collectCapabilityEventFromWebSearchItem(item, state, vendor);
    return;
  }

  if (item.type === "computer_call") {
    collectComputerCallFromItem(item, state, vendor);
    return;
  }

  if (item.type === "file_search_call") {
    collectCapabilityEventFromFileSearchItem(item, state, vendor);
    return;
  }

  if (item.type === "message") {
    collectCitationsFromMessageItem(item, state);
  }
}

/** 统一解析 OpenAI Responses JSON，兼容首次 background 建单与后续 retrieve 结果。 */
export function parseOpenAiResponsesJsonPayload(
  payload: Record<string, unknown>,
  input: {
    providerFamily: BackgroundTaskHandle["providerFamily"];
    protocolTarget: BackgroundTaskHandle["protocolTarget"];
    backgroundMode: {
      enabled: boolean;
      reason: string;
      pollAfterMs: number;
    };
    vendor: VendorFamily | undefined;
  },
): ProtocolExecutionOutput {
  const state: ResponsesStreamState = {
    responseId: typeof payload.id === "string" ? payload.id : null,
    contentParts: [],
    reasoningParts: [],
    toolCalls: new Map(),
    capabilityEvents: [],
    citations: [],
    computerCalls: [],
    seenCitationIds: new Set(),
    latestWebSearchTraceId: null,
    activeToolCallId: null,
    finishReason: null,
    usage: undefined,
  };

  const outputItems = Array.isArray(payload.output) ? payload.output : [];
  for (const outputItem of outputItems) {
    const item = resolveResponsesOutputItem(outputItem);
    if (item) {
      if (item.type === "message") {
        collectMessageTextFromMessageItem(item, state);
      }
      collectResponsesOutputItem(item, state, input.vendor);
    }
  }

  const status = typeof payload.status === "string" ? payload.status : null;
  const startedAt = typeof payload.created_at === "number"
    ? new Date(payload.created_at * 1000).toISOString()
    : new Date().toISOString();
  const backgroundTask = state.responseId && (status === "queued" || status === "in_progress")
    ? {
        id: state.responseId,
        providerFamily: input.providerFamily,
        protocolTarget: input.protocolTarget,
        providerResponseId: state.responseId,
        status,
        pollAfterMs: input.backgroundMode.pollAfterMs,
        startedAt,
        updatedAt: new Date().toISOString(),
      } satisfies BackgroundTaskHandle
    : null;

  if (backgroundTask) {
    state.capabilityEvents.push(normalizeVendorTraceEvent({
      source: "openai-responses",
      eventType: "background_response_started",
      vendor: input.vendor,
      createdAt: backgroundTask.updatedAt,
      item: {
        responseId: backgroundTask.providerResponseId,
        status: backgroundTask.status,
        reason: input.backgroundMode.reason,
        pollAfterMs: backgroundTask.pollAfterMs ?? null,
      },
    }));
  }

  const finishReason = backgroundTask
    ? "background"
    : status === "failed"
      ? "error"
      : status === "cancelled" || status === "expired"
        ? status
        : state.computerCalls.length > 0
          ? "computer_calls"
        : "stop";

  return {
    content: state.contentParts.join(""),
    reasoning: state.reasoningParts.length > 0 ? state.reasoningParts.join("") : undefined,
    toolCalls: materializeToolCalls(state.toolCalls),
    finishReason,
    usage: undefined,
    responseId: state.responseId,
    requestVariantId: null,
    fallbackReason: null,
    retryCount: 0,
    fallbackEvents: [],
    citations: state.citations,
    capabilityEvents: state.capabilityEvents,
    computerCalls: state.computerCalls,
    backgroundTask,
  };
}

/** 生成 OpenAI Responses 请求体，供 gateway requestShape 与直连执行共同复用。 */
export function buildOpenAiResponsesRequestBody(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  tools: unknown[],
  reasoningEffort?: "low" | "medium" | "high" | "xhigh",
  options?: {
    providerFamily?: BackgroundTaskHandle["providerFamily"];
    disableResponseStorage?: boolean;
    previousResponseId?: string | null;
    capabilityRoutes?: CapabilityExecutionRoute[];
    toolRegistry?: CanonicalToolSpec[] | null;
    rawInputItems?: Array<Record<string, unknown>> | null;
    nativeFileSearch?: {
      vectorStoreIds: string[];
      maxNumResults?: number;
      includeSearchResults?: boolean;
    } | null;
    backgroundMode?: {
      enabled: boolean;
      reason: string;
      pollAfterMs: number;
    };
  },
): Record<string, unknown> {
  const { instructions, input } = options?.rawInputItems
    ? { instructions: undefined, input: options.rawInputItems }
    : buildResponsesInput(messages);
  const normalizedTools = normalizeResponsesTools(
    tools,
    options?.capabilityRoutes,
    options?.toolRegistry,
    options?.nativeFileSearch ?? null,
  );
  const qwenThinkingBudget = resolveQwenResponsesThinkingBudget(reasoningEffort);

  if (options?.providerFamily === "qwen-native") {
    return {
      model,
      input,
      tools: normalizedTools,
      stream: true,
      ...(normalizedTools.length > 0 ? { parallel_tool_calls: true } : {}),
      ...(qwenThinkingBudget !== undefined
        ? {
            enable_thinking: true,
            thinking_budget: qwenThinkingBudget,
          }
        : {}),
      ...(options?.previousResponseId ? { previous_response_id: options.previousResponseId } : {}),
      ...(options?.nativeFileSearch?.includeSearchResults ? { include: ["output[*].file_search_call.search_results"] } : {}),
      ...(instructions ? { instructions } : {}),
    };
  }

  const store = options?.backgroundMode?.enabled
    ? true
    : options?.disableResponseStorage
      ? false
      : undefined;
  return {
    model,
    input,
    tools: normalizedTools,
    stream: options?.backgroundMode?.enabled ? false : true,
    ...(options?.backgroundMode?.enabled ? { background: true } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(store !== undefined ? { store } : {}),
    ...(options?.previousResponseId ? { previous_response_id: options.previousResponseId } : {}),
    ...(options?.nativeFileSearch?.includeSearchResults ? { include: ["output[*].file_search_call.search_results"] } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

/** 解析后台 JSON 响应，抽取统一的长任务句柄与 capability 事件。 */
async function consumeResponsesJson(
  response: Response,
  input: {
    providerFamily: BackgroundTaskHandle["providerFamily"];
    protocolTarget: BackgroundTaskHandle["protocolTarget"];
    backgroundMode: {
      enabled: boolean;
      reason: string;
      pollAfterMs: number;
    };
    vendor: VendorFamily | undefined;
  },
): Promise<ProtocolExecutionOutput> {
  const payload = await response.json() as Record<string, unknown>;
  return parseOpenAiResponsesJsonPayload(payload, input);
}

/** 把 tool call 累积状态物化为共享协议输出。 */
function materializeToolCalls(toolCalls: Map<string, ResponsesToolCallAccumulator>): ProtocolExecutionOutput["toolCalls"] {
  return [...toolCalls.values()].map((toolCall) => {
    const argumentsJson = toolCall.argumentsJson.trim() || "{}";
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(argumentsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      input = {};
    }

    return {
      id: toolCall.id,
      name: toolCall.name,
      argumentsJson,
      input,
    };
  });
}

/** 处理单个 Responses SSE 事件，保持 content / reasoning / tool call 组装稳定。 */
function applyResponsesEvent(
  event: string,
  data: unknown,
  state: ResponsesStreamState,
  vendor: VendorFamily | undefined,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): void {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};

  if (event === "response.created" && typeof payload.id === "string" && payload.id.trim()) {
    state.responseId = payload.id.trim();
    return;
  }

  if (event === "response.output_text.delta" || event === "response.content_part.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (delta) {
      state.contentParts.push(delta);
      onDelta?.({ content: delta });
    }
    return;
  }

  if (event === "response.content_part.done") {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (text) {
      state.contentParts.push(text);
      onDelta?.({ content: text });
    }
    return;
  }

  if (event === "response.reasoning_summary_text.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (delta) {
      state.reasoningParts.push(delta);
      onDelta?.({ reasoning: delta });
    }
    return;
  }

  if (event === "response.reasoning_summary_part.done") {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (text) {
      state.reasoningParts.push(text);
      onDelta?.({ reasoning: text });
    }
    return;
  }

  if (event === "response.output_item.added" || event === "response.output_item.done") {
    const item = resolveResponsesOutputItem(data);
    if (!item) {
      return;
    }

    if (item.type === "function_call") {
      const callId = typeof item.call_id === "string"
        ? item.call_id
        : typeof item.id === "string"
          ? item.id
          : typeof item.item_id === "string"
            ? item.item_id
            : "";
      if (!callId) {
        return;
      }

      if (event === "response.output_item.added") {
        state.toolCalls.set(callId, {
          id: callId,
          name: typeof item.name === "string" ? item.name : "",
          argumentsJson: typeof item.arguments === "string" ? item.arguments : "",
        });
        state.activeToolCallId = callId;
        return;
      }

      const existing = state.toolCalls.get(callId);
      if (!existing) {
        return;
      }
      if (typeof item.arguments === "string" && item.arguments.trim()) {
        existing.argumentsJson = item.arguments;
      }
      state.activeToolCallId = null;
      return;
    }

    collectResponsesOutputItem(item, state, vendor);
    return;
  }

  if (event === "response.function_call_arguments.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    const callId = typeof payload.call_id === "string"
      ? payload.call_id
      : typeof payload.item_id === "string"
        ? payload.item_id
        : state.activeToolCallId;
    if (!callId || !delta) {
      return;
    }

    const existing = state.toolCalls.get(callId);
    if (!existing) {
      return;
    }

    existing.argumentsJson += delta;
    onToolCallDelta?.({
      toolCallId: existing.id,
      name: existing.name,
      argumentsDelta: delta,
    });
    return;
  }

  if (event === "response.completed") {
    const usage = payload.usage && typeof payload.usage === "object"
      ? payload.usage as Record<string, unknown>
      : payload.response && typeof payload.response === "object"
        && (payload.response as Record<string, unknown>).usage
          && typeof (payload.response as Record<string, unknown>).usage === "object"
        ? (payload.response as Record<string, unknown>).usage as Record<string, unknown>
        : null;

    state.finishReason = state.toolCalls.size > 0
      ? "tool_calls"
      : state.computerCalls.length > 0
        ? "computer_calls"
        : "stop";
    if (usage) {
      const promptTokens = Number(usage.input_tokens ?? 0);
      const completionTokens = Number(usage.output_tokens ?? 0);
      state.usage = {
        promptTokens,
        completionTokens,
        totalTokens: Number(usage.total_tokens ?? (promptTokens + completionTokens)),
        ...(usage.reasoning_tokens !== undefined
          ? { reasoningTokens: Number(usage.reasoning_tokens ?? 0) }
          : {}),
        ...(usage.input_tokens_details
          && typeof usage.input_tokens_details === "object"
          && (usage.input_tokens_details as Record<string, unknown>).cached_tokens !== undefined
          ? { cachedInputTokens: Number((usage.input_tokens_details as Record<string, unknown>).cached_tokens ?? 0) }
          : {}),
      };
    }

    const completedOutputItems = Array.isArray(payload.output)
      ? payload.output
      : payload.response && typeof payload.response === "object"
        && Array.isArray((payload.response as Record<string, unknown>).output)
        ? (payload.response as Record<string, unknown>).output as unknown[]
        : [];
    for (const outputItem of completedOutputItems) {
      const item = resolveResponsesOutputItem(outputItem);
      if (item) {
        collectResponsesOutputItem(item, state, vendor);
      }
    }
  }
}

/** 逐条读取 SSE 事件，兼容 `event:` / `data:` 的标准格式。 */
async function consumeResponsesStream(
  response: Response,
  vendor: VendorFamily | undefined,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): Promise<ProtocolExecutionOutput> {
  const state: ResponsesStreamState = {
    responseId: null,
    contentParts: [],
    reasoningParts: [],
    toolCalls: new Map(),
    capabilityEvents: [],
    citations: [],
    computerCalls: [],
    seenCitationIds: new Set(),
    latestWebSearchTraceId: null,
    activeToolCallId: null,
    finishReason: null,
    usage: undefined,
  };

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      content: "",
      toolCalls: [],
      finishReason: "stop",
      retryCount: 0,
      fallbackEvents: [],
      computerCalls: [],
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData: string[] = [];

  const flushEvent = (): void => {
    if (!currentEvent || currentData.length === 0) {
      currentEvent = "";
      currentData = [];
      return;
    }

    try {
      const payload = JSON.parse(currentData.join("\n"));
      applyResponsesEvent(currentEvent, payload, state, vendor, onDelta, onToolCallDelta);
    } catch {
      // 忽略无法解析的事件，避免单个脏包中断整个流。
    }

    currentEvent = "";
    currentData = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (!line.trim()) {
        flushEvent();
      } else if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        currentData.push(line.slice("data:".length).trim());
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      if (buffer.trim()) {
        if (buffer.startsWith("data:")) {
          currentData.push(buffer.slice("data:".length).trim());
        } else if (buffer.startsWith("event:")) {
          currentEvent = buffer.slice("event:".length).trim();
        }
      }
      flushEvent();
      break;
    }
  }

  return {
    content: state.contentParts.join(""),
    ...(state.reasoningParts.length > 0 ? { reasoning: state.reasoningParts.join("") } : {}),
    toolCalls: materializeToolCalls(state.toolCalls),
    finishReason: state.finishReason ?? "stop",
    usage: state.usage,
    responseId: state.responseId,
    requestVariantId: null,
    fallbackReason: null,
    retryCount: 0,
    fallbackEvents: [],
    citations: state.citations,
    capabilityEvents: state.capabilityEvents,
    computerCalls: state.computerCalls,
  };
}

/** OpenAI native 驱动：rollout 开启时直连 `/v1/responses`，关闭时回退到 legacy shim。 */
export const openAiResponsesDriver: ProtocolDriver = {
  protocolTarget: "openai-responses",
  buildRequestBody(input: Parameters<NonNullable<ProtocolDriver["buildRequestBody"]>>[0]) {
    const reasoningEffort = (input.plan.legacyExecutionPlan as { reasoningEffort?: "low" | "medium" | "high" | "xhigh" } | null)?.reasoningEffort
      ?? input.profile.defaultReasoningEffort;
    const backgroundMode = resolveBackgroundModePolicy({
      profile: input.profile,
      protocolTarget: input.plan.protocolTarget,
      capabilityRoutes: input.plan.capabilityRoutes,
      sessionId: input.sessionId ?? null,
      workflowRunId: input.workflowRunId ?? null,
    });
    return buildOpenAiResponsesRequestBody(
      input.profile.model,
      buildCanonicalRequestMessages(input.content as any) as Array<{ role: string; content: unknown }>,
      input.toolBundle.tools,
      reasoningEffort,
      {
        providerFamily: input.plan.providerFamily,
        disableResponseStorage: input.profile.responsesApiConfig?.disableResponseStorage,
        previousResponseId: input.profile.responsesApiConfig?.useServerState ? input.previousResponseId ?? null : null,
        capabilityRoutes: input.plan.capabilityRoutes,
        toolRegistry: input.toolBundle.registry,
        rawInputItems: input.responseInputItems ?? null,
        nativeFileSearch: resolveNativeFileSearchConfig(input.profile),
        backgroundMode,
      },
    );
  },

  async execute(input) {
    if (!input.rolloutGate.enabled) {
      const result = await callModel({
        profile: input.profile,
        messages: canonicalTurnContentToLegacyMessages(input.content),
        tools: input.toolBundle.tools as never,
        executionPlan: input.plan.legacyExecutionPlan as never,
        signal: input.signal,
        onDelta: input.onDelta,
        onToolCallDelta: input.onToolCallDelta,
      });
      const transportMetadata = buildLegacyShimTransportMetadata("openai-responses", result.transport);
      const rolloutFallbackEvents = [
        { fromVariant: "openai-responses", toVariant: "openai-chat-compatible", reason: "rollout_disabled" as const },
      ];

      return {
        content: result.content,
        reasoning: result.reasoning,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        usage: result.usage,
        responseId: null,
        requestVariantId: transportMetadata.requestVariantId,
        fallbackReason: result.transport?.fallbackReason
          ?? rolloutFallbackEvents[0].reason
          ?? transportMetadata.fallbackReason,
        retryCount: transportMetadata.retryCount,
        fallbackEvents: [...rolloutFallbackEvents, ...transportMetadata.fallbackEvents],
        computerCalls: [],
      };
    }

    const requestBody = buildOpenAiResponsesRequestBody(
      input.profile.model,
      buildCanonicalRequestMessages(input.content) as Array<{ role: string; content: unknown }>,
      input.toolBundle.tools,
      (input.plan.legacyExecutionPlan as { reasoningEffort?: "low" | "medium" | "high" | "xhigh" } | null)?.reasoningEffort
        ?? input.profile.defaultReasoningEffort,
      {
        providerFamily: input.plan.providerFamily,
        disableResponseStorage: input.profile.responsesApiConfig?.disableResponseStorage,
        previousResponseId: input.profile.responsesApiConfig?.useServerState ? input.previousResponseId ?? null : null,
        capabilityRoutes: input.plan.capabilityRoutes,
        toolRegistry: input.toolBundle.registry,
        rawInputItems: input.responseInputItems ?? null,
        nativeFileSearch: resolveNativeFileSearchConfig(input.profile),
        backgroundMode: resolveBackgroundModePolicy({
          profile: input.profile,
          protocolTarget: input.plan.protocolTarget,
          capabilityRoutes: input.plan.capabilityRoutes,
          sessionId: input.sessionId ?? null,
          workflowRunId: input.workflowRunId ?? null,
        }),
      },
    );
    const transportResult = await executeRequestVariants({
      url: resolveResponsesApiUrl(input.profile),
      headers: buildRequestHeaders(input.profile, "openai-responses"),
      requestVariants: [{ id: "openai-responses", body: requestBody }],
      signal: input.signal,
    });
    const contentType = transportResult.response.headers.get("content-type") ?? "";
    const backgroundMode = resolveBackgroundModePolicy({
      profile: input.profile,
      protocolTarget: input.plan.protocolTarget,
      capabilityRoutes: input.plan.capabilityRoutes,
      sessionId: input.sessionId ?? null,
      workflowRunId: input.workflowRunId ?? null,
    });
    const parsed = contentType.includes("application/json")
      ? await consumeResponsesJson(transportResult.response, {
          providerFamily: input.plan.providerFamily,
          protocolTarget: input.plan.protocolTarget,
          backgroundMode,
          vendor: input.profile.vendorFamily ?? "openai",
        })
      : await consumeResponsesStream(
          transportResult.response,
          input.profile.vendorFamily ?? "openai",
          input.onDelta,
          input.onToolCallDelta,
        );

    return {
      content: parsed.content,
      reasoning: parsed.reasoning,
      toolCalls: parsed.toolCalls,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
      responseId: parsed.responseId,
      requestVariantId: transportResult.variant.id,
      fallbackReason: transportResult.variant.fallbackReason ?? null,
      retryCount: transportResult.retryCount,
      fallbackEvents: transportResult.fallbackEvents,
      citations: parsed.citations ?? [],
      capabilityEvents: parsed.capabilityEvents ?? [],
      computerCalls: parsed.computerCalls ?? [],
      backgroundTask: parsed.backgroundTask ?? null,
    };
  },
};
