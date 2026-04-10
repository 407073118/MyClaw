# OpenAI 原生支持设计方案

> **目标:** 让用户在 MyClaw Desktop 配置 OpenAI GPT 模型（gpt-5.4, o3, gpt-4o 等）时，系统自动走 OpenAI Responses API 原生通路，获得与 Codex 同等水平的模型调用体验——更好的回答质量、原生 reasoning 控制、大上下文窗口支持、流式推理可视化。
>
> **核心原则:**
> 1. **用户少配，系统多智能** — 选了 OpenAI + 模型，其他自动
> 2. **代码独立，跟着 OpenAI 迭代** — `openai/` 目录自治，不影响已有厂商
> 3. **一切为了让 GPT 在 MyClaw 里跑出最好效果** — prompt、context、streaming 全部针对优化

---

## 1. 背景与问题

### 当前现状

Desktop 对所有 OpenAI 兼容厂商走同一条路径：

```
ModelProfile → model-client.ts → POST /v1/chat/completions → SSE delta 解析
```

这对 Qwen、Moonshot、DeepSeek 等厂商是正确的（它们只实现了 Chat Completions），但对 OpenAI 自身的模型来说，是在用"兼容模式"而非"原生模式"。

### 与 Codex 的差距

| 能力 | Codex | MyClaw 当前 |
|------|-------|-------------|
| API 协议 | Responses API (`/v1/responses`) | Chat Completions (`/v1/chat/completions`) |
| Reasoning 控制 | `low / medium / high / xhigh` | `low / medium / high`，且仅在 ExecutionPlan 层 |
| 上下文窗口 | 手动配置 1M | 无 UI 入口 |
| 压缩阈值 | 绝对 token 数 | 仅比例 (0.8) |
| 响应存储 | `store: false` 可选 | 不支持 |
| 流式事件 | 结构化事件（reasoning / content / tool_call 分离） | `choices[0].delta` 混合格式 |
| 服务端会话 | `previous_response_id` | 不支持 |

### Responses API 核心差异

OpenAI Responses API 不是换个 endpoint，是不同的范式：

- **请求结构**: `input` + `instructions`，不是 `messages` 数组
- **流式格式**: 结构化事件（`response.content_part.delta`、`response.reasoning_summary_text.delta`、`response.function_call_arguments.delta`），不是 `data: {"choices":[...]}` 的 SSE
- **Reasoning 一等公民**: `{ reasoning: { effort: "xhigh" } }` 原生字段
- **隐私控制**: `{ store: false }` 直接在请求里
- **服务端状态**: `previous_response_id` 链式引用（v2）

---

## 2. 架构设计

### 2.1 独立代码路径

新建 `desktop/src/main/services/openai/` 目录，完全自包含：

```
desktop/src/main/services/openai/
  index.ts                  ← 对外入口：callOpenAIModel() + getEffectiveWireApi()
  types.ts                  ← OpenAI Responses API 全量类型定义
  client.ts                 ← 请求发送 + 流式消费 + 结果组装
  request-builder.ts        ← 构建 /v1/responses 请求体
  stream-parser.ts          ← 解析 Responses API 结构化事件流
  model-config-service.ts   ← 模型能力查询（读内置 JSON）
  openai-models.json        ← 内置模型能力数据（数据文件，非代码）
  prompt-optimizer.ts       ← GPT 专属 prompt 调整（Wave 5）
```

**不 import** `model-client.ts`、`model-sse-parser.ts`、`provider-adapters/`。唯一复用的是：
- `model-transport.ts` 的 `executeRequestVariants()`（通用 HTTP 重试/超时）
- 返回类型 `ModelCallResult`（与 session runtime 的契约）

### 2.2 API 协议作为独立维度

**协议选择不绑定厂商。** 用户可以选任意厂商 + 任意协议组合：

```
厂商 (谁提供服务)    ≠    协议 (用什么格式通信)

例如：
  Custom 厂商 + Responses API     → 自建 OpenAI 代理网关
  Custom 厂商 + Anthropic Messages → 自建 Anthropic 代理
  OpenAI 厂商 + Chat Completions  → 降级兼容模式
```

支持三种 API 协议：

| wireApi 值 | 对应接口 | 使用场景 |
|---|---|---|
| `"chat-completions"` | `/v1/chat/completions` | 默认，所有 OpenAI 兼容厂商 |
| `"responses"` | `/v1/responses` | OpenAI 原生，最佳 GPT 体验 |
| `"anthropic-messages"` | `/v1/messages` | Anthropic 原生（现有路径） |

### 2.3 集成点

Session runtime 的分发逻辑：

```typescript
// sessions.ts 中，按 wireApi 路由（始终通过 getEffectiveWireApi 读取，兼容老 profile）
function dispatchModelCall(profile: ModelProfile, options: ModelCallOptions) {
  switch (getEffectiveWireApi(profile)) {
    case "responses":
      return callOpenAIModel(options);           // openai/ 模块
    case "anthropic-messages":
    case "chat-completions":
    default:
      return callModel(options);                  // 现有路径（内部按 provider 区分）
  }
}
```

所有路径返回相同的 `ModelCallResult`，`onDelta` / `onToolCallDelta` 回调签名也一致。Session runtime 后续的工具执行、审批、循环检测等逻辑完全不受影响。

### 2.4 厂商预设自动联动

用户切换厂商预设时，API 协议自动跟随（但用户可以手动改）：

```typescript
const PRESET_DEFAULT_WIRE_API: Record<string, WireApi> = {
  "openai":    "responses",
  "anthropic": "anthropic-messages",
  "minimax":   "chat-completions",
  "moonshot":  "chat-completions",
  "qwen":      "chat-completions",
  "custom":    "chat-completions",       // Custom 默认最安全的，用户自己选
  "br-minimax":"chat-completions",
};
```

联动规则：
- 切换厂商预设 → `wireApi` 自动设为该厂商的默认值
- 用户手动改了 `wireApi` → 保持用户的选择，不再被预设覆盖
- Custom 模式下 → 三个协议都可选，用户根据自己的网关能力决定

### 2.5 wireApi 与现有 provider 字段的关系

现有 `ModelProfile` 已有 `provider: "openai-compatible" | "anthropic" | "local-gateway"`，新增 `wireApi` 后两者有重叠。明确关系：

- **`wireApi` 是路由主信号**：决定走哪条代码路径
- **`provider` 保留但降级为 fallback**：当 `wireApi` 未设置时，从 `provider` 推导

```typescript
/** 获取实际生效的 wireApi，兼容无 wireApi 字段的老 profile。 */
function getEffectiveWireApi(profile: ModelProfile): WireApi {
  // 1. 显式设置优先
  if (profile.wireApi) return profile.wireApi;
  // 2. 从 provider 推导（向后兼容）
  if (profile.provider === "anthropic") return "anthropic-messages";
  return "chat-completions";
}
```

**矛盾组合处理**：`wireApi` 优先。例如 `provider: "openai-compatible"` + `wireApi: "anthropic-messages"` 时，走 Anthropic 路径。厂商预设切换时会自动同步两个字段，手动编辑导致的矛盾由用户自行负责。

**路由逻辑统一使用 `getEffectiveWireApi()`**，不再直接读 `profile.wireApi`：

```typescript
function dispatchModelCall(profile: ModelProfile, options: ModelCallOptions) {
  switch (getEffectiveWireApi(profile)) {
    case "responses":
      return callOpenAIModel(options);           // openai/ 模块
    case "anthropic-messages":
    case "chat-completions":
    default:
      return callModel(options);                  // 现有路径（内部按 provider 区分）
  }
}
```

**Workflow 引擎也需要同样的路由**：`desktop/src/main/ipc/workflows.ts` 中的 LLM 节点调用也通过 `dispatchModelCall` 分发，不能只改 session runtime。

---

## 3. 数据模型变更

### 3.1 WireApi 类型

```typescript
// desktop/shared/contracts/model.ts

/** API 通信协议，决定走哪条代码路径。与厂商选择独立。 */
export type WireApi = "chat-completions" | "responses" | "anthropic-messages";
```

### 3.2 ModelProfile 扩展

```typescript
// desktop/shared/contracts/model.ts

type ModelProfile = {
  // ... 现有字段全部保留，不改 ...

  // 新增：API 协议选择（顶层字段，所有厂商通用）
  wireApi?: WireApi;  // 默认 "chat-completions"

  // 新增：通用高级配置（所有厂商可用）
  defaultReasoningEffort?: "low" | "medium" | "high" | "xhigh";
  contextWindowOverride?: number;
  compactTriggerTokens?: number;

  // 新增：Responses API 专属配置（wireApi === "responses" 时生效）
  responsesApiConfig?: {
    disableResponseStorage?: boolean;              // store: false
    useServerState?: boolean;                      // previous_response_id（v2）
  };
};
```

### 3.3 SessionReasoningEffort 扩展

```typescript
// desktop/shared/contracts/session-runtime.ts

export type SessionReasoningEffort = "low" | "medium" | "high" | "xhigh";
```

### 3.4 TokenUsage 扩展

```typescript
// desktop/src/main/services/model-client.ts（或独立 types）

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // 新增：Responses API 细粒度字段
  reasoningTokens?: number;
  cachedInputTokens?: number;
};
```

### 3.5 向后兼容

所有新字段均为 `optional`。现有 profile JSON 文件无需迁移，`state-persistence.ts` 的序列化/反序列化自然兼容。

### 3.6 能力解析优先级

`model-capability-resolver.ts` 扩展后的优先级栈：

```
1. 用户手动覆盖 (contextWindowOverride, capabilityOverrides)  ← 最高
2. API 发现 (discoveredCapabilities)
3. 内置 OpenAI 模型配置 (openai-models.json)                  ← 新增层
4. 静态注册表 (model-capability-registry.ts)
5. Legacy contextWindow 字段
6. 安全默认值 (32768)                                          ← 最低
```

---

## 4. 内置模型能力数据

### 4.1 数据文件格式

```jsonc
// desktop/src/main/services/openai/openai-models.json
{
  "version": "2026-04-10",
  "models": {
    "gpt-5.4": {
      "contextWindow": 1000000,
      "maxOutput": 32768,
      "supportsReasoning": true,
      "supportsXhigh": true,
      "supportsVision": true,
      "supportsTools": true,
      "supportsResponsesApi": true,
      "recommendedEffort": "high"
    },
    "gpt-4o": {
      "contextWindow": 128000,
      "maxOutput": 16384,
      "supportsReasoning": false,
      "supportsXhigh": false,
      "supportsVision": true,
      "supportsTools": true,
      "supportsResponsesApi": true,
      "recommendedEffort": null
    },
    "o3": {
      "contextWindow": 200000,
      "maxOutput": 100000,
      "supportsReasoning": true,
      "supportsXhigh": true,
      "supportsVision": true,
      "supportsTools": true,
      "supportsResponsesApi": true,
      "recommendedEffort": "high"
    },
    "o4-mini": {
      "contextWindow": 200000,
      "maxOutput": 100000,
      "supportsReasoning": true,
      "supportsXhigh": true,
      "supportsVision": false,
      "supportsTools": true,
      "supportsResponsesApi": true,
      "recommendedEffort": "medium"
    }
  },
  "families": [
    {
      "pattern": "^gpt-5",
      "config": {
        "contextWindow": 1000000,
        "supportsReasoning": true,
        "supportsXhigh": true,
        "supportsResponsesApi": true
      }
    },
    {
      "pattern": "^gpt-4",
      "config": {
        "contextWindow": 128000,
        "supportsReasoning": false,
        "supportsResponsesApi": true
      }
    },
    {
      "pattern": "^o\\d",
      "comment": "匹配 o3, o4-mini 等，不会误匹配 ollama-xxx",
      "config": {
        "contextWindow": 200000,
        "supportsReasoning": true,
        "supportsXhigh": true,
        "supportsResponsesApi": true
      }
    }
  ],
  "defaults": {
    "contextWindow": 128000,
    "maxOutput": 16384,
    "supportsReasoning": false,
    "supportsXhigh": false,
    "supportsVision": true,
    "supportsTools": true,
    "supportsResponsesApi": true,
    "recommendedEffort": null
  }
}
```

**字段说明**：
- `supportsResponsesApi` 表示该模型**支持** Responses API，是能力描述，不是路由指令。路由由 profile 的 `wireApi` 字段决定。
- `families` 改为正则数组，避免简单前缀匹配误命中（`"o"` 不会匹配 `"ollama-xxx"`）。

### 4.2 查询逻辑

```typescript
function resolveOpenAIModelConfig(modelId: string): OpenAIModelConfig {
  const data = loadBundledConfig(); // 读 JSON 文件，启动时缓存

  // 1. 精确匹配
  if (data.models[modelId]) return { ...data.defaults, ...data.models[modelId] };

  // 2. 族正则匹配（gpt-5.4 → ^gpt-5, o3-mini → ^o\d）
  for (const family of data.families) {
    if (new RegExp(family.pattern).test(modelId)) {
      return { ...data.defaults, ...family.config };
    }
  }

  // 3. 兜底：OpenAI 通用默认值
  return data.defaults;
}
```

### 4.3 迭代维护

- OpenAI 出新模型 → 更新 `openai-models.json`，不改代码
- 未来：加远程拉取，Cloud 端维护最新版本，Desktop 启动时更新本地缓存

---

## 5. Responses API 请求构造

### 5.1 消息格式转换

MyClaw 内部消息 → Responses API `input` 数组：

```typescript
function buildResponsesInput(messages: ChatMessage[]): ResponsesApiInput {
  let instructions: string | undefined;
  const input: ResponsesApiInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // system message 提取为 instructions（Responses API 推荐用法）
      instructions = (instructions ? instructions + "\n\n" : "") + textOfContent(msg.content);
      continue;
    }

    if (msg.role === "tool") {
      // 工具结果转为 function_call_output
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id!,
        output: textOfContent(msg.content),
      });
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      // 带工具调用的 assistant 消息：先推内容，再推每个 function_call
      if (textOfContent(msg.content)) {
        input.push({ role: "assistant", content: textOfContent(msg.content) });
      }
      for (const tc of msg.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }

    // 普通 user / assistant 消息
    input.push({ role: msg.role, content: msg.content });
  }

  return { instructions, input };
}
```

### 5.2 完整请求体

```typescript
function buildResponsesApiRequestBody(
  profile: ModelProfile,
  messages: ChatMessage[],
  tools: RequestTool[] | undefined,
  modelConfig: OpenAIModelConfig,
): Record<string, unknown> {
  const { instructions, input } = buildResponsesInput(messages);

  const body: Record<string, unknown> = {
    model: profile.model,
    input,
    stream: true,
  };

  if (instructions) body.instructions = instructions;

  // reasoning effort
  const effort = profile.defaultReasoningEffort;
  if (effort && modelConfig.supportsReasoning) {
    body.reasoning = { effort };
  }

  // tools — strict mode 需要 schema 满足条件（所有属性 required、无 additionalProperties），
  // 不满足时降级为 strict: false 避免 400 错误
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
      strict: isStrictCompatibleSchema(t.function.parameters),
    }));
  }

  // max output tokens
  if (modelConfig.maxOutput) {
    body.max_output_tokens = modelConfig.maxOutput;
  }

  // privacy
  if (profile.responsesApiConfig?.disableResponseStorage) {
    body.store = false;
  }

  // 用户自定义参数 — 保护关键字段不被覆盖
  if (profile.requestBody) {
    const PROTECTED_KEYS = ["model", "input", "instructions", "stream", "tools"];
    const safeOverrides = Object.fromEntries(
      Object.entries(profile.requestBody).filter(([k]) => !PROTECTED_KEYS.includes(k))
    );
    Object.assign(body, safeOverrides);
  }

  return body;
}

/** 检查 JSON Schema 是否兼容 OpenAI strict mode（所有属性 required、无 additionalProperties）。 */
function isStrictCompatibleSchema(schema: Record<string, unknown>): boolean {
  if (!schema || typeof schema !== "object") return false;
  const props = schema.properties as Record<string, unknown> | undefined;
  const required = schema.required as string[] | undefined;
  if (!props) return true; // 无参数的 schema 是兼容的
  const propKeys = Object.keys(props);
  // 所有属性都必须在 required 中
  return !!required && propKeys.every((k) => required.includes(k));
}
```

### 5.3 URL 与 Headers

```typescript
/** 清理用户可能误带的已知接口后缀，与 model-client.ts 的 stripKnownEndpointSuffixes 同理。 */
function stripEndpointSuffixes(url: string): string {
  const suffixes = ["/chat/completions", "/v1/messages", "/v1/responses", "/responses", "/compatible-mode/v1", "/v1"];
  let result = url;
  for (const suffix of suffixes) {
    if (result.toLowerCase().endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result.replace(/\/+$/, "") || url;
}

function resolveResponsesApiUrl(profile: ModelProfile): string {
  const base = profile.baseUrl.replace(/\/+$/, "");

  if (profile.baseUrlMode === "provider-root") {
    // provider-root：先清理误带后缀，再补全正确路径
    return `${stripEndpointSuffixes(base)}/v1/responses`;
  }

  // manual 模式：同样先清理，避免 .../v1/chat/completions/responses 的拼接错误
  return `${stripEndpointSuffixes(base)}/v1/responses`;
}

function buildResponsesApiHeaders(profile: ModelProfile): Record<string, string> {
  return {
    "content-type": "application/json",
    "authorization": `Bearer ${profile.apiKey}`,
    ...(profile.headers ?? {}),
  };
}
```

---

## 6. Responses API 流式解析

### 6.1 事件类型

Responses API 的 SSE 格式与 Chat Completions 完全不同：

```
event: response.created
data: {"id":"resp_abc","object":"response","status":"in_progress",...}

event: response.output_item.added
data: {"type":"message","role":"assistant","content":[],...}

event: response.content_part.added
data: {"type":"output_text","text":""}

event: response.content_part.delta
data: {"type":"output_text","delta":"Hello "}

event: response.content_part.done
data: {"type":"output_text","text":"Hello world"}

event: response.reasoning_summary_part.added
data: {"type":"reasoning_summary_text","text":""}

event: response.reasoning_summary_text.delta
data: {"delta":"Let me think about this..."}

event: response.reasoning_summary_part.done
data: {"type":"reasoning_summary_text","text":"Let me think about this..."}

event: response.output_item.added
data: {"type":"function_call","name":"search","call_id":"call_xyz","arguments":""}

event: response.function_call_arguments.delta
data: {"delta":"{\"query\":\"weather\"}"}

event: response.output_item.done
data: {"type":"function_call","name":"search","call_id":"call_xyz","arguments":"{\"query\":\"weather\"}"}

event: response.completed
data: {"id":"resp_abc","status":"completed","usage":{"input_tokens":100,"output_tokens":50,"reasoning_tokens":20},...}
```

### 6.2 解析器设计

```typescript
type ResponsesStreamState = {
  contentParts: string[];
  reasoningParts: string[];
  toolCalls: Map<string, { id: string; name: string; argumentsJson: string }>;
  /** 按接收顺序记录 tool call 的 item_id，用于路由 arguments.delta 事件。 */
  activeToolCallItemId: string | null;
  finishReason: string | null;
  usage: TokenUsage | null;
  responseId: string | null;
};

async function consumeResponsesStream(
  response: Response,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): Promise<ResponsesStreamResult> {
  const state: ResponsesStreamState = {
    contentParts: [],
    reasoningParts: [],
    toolCalls: new Map(),
    activeToolCallItemId: null,
    finishReason: null,
    usage: null,
    responseId: null,
  };

  // 逐行读取 SSE
  for await (const { event, data } of readSseLines(response)) {
    switch (event) {
      case "response.created":
        state.responseId = data.id;
        break;

      case "response.content_part.delta":
        state.contentParts.push(data.delta);
        onDelta?.({ content: data.delta });
        break;

      case "response.reasoning_summary_text.delta":
        state.reasoningParts.push(data.delta);
        onDelta?.({ reasoning: data.delta });
        break;

      case "response.output_item.added":
        if (data.type === "function_call") {
          // data 包含 item_id（或 id）和 call_id，用 call_id 作为 map key
          const callId = data.call_id ?? data.id;
          state.toolCalls.set(callId, {
            id: callId,
            name: data.name,
            argumentsJson: "",
          });
          // 标记为当前活跃的 tool call，后续 arguments.delta 路由到此
          state.activeToolCallItemId = callId;
        }
        break;

      case "response.function_call_arguments.delta":
        // Responses API 的 arguments.delta 事件包含 item_id 和 output_index，
        // 可以通过 item_id 精确路由。如果缺失则 fallback 到最近活跃的 tool call。
        const targetId = data.call_id ?? data.item_id ?? state.activeToolCallItemId;
        const tc = targetId ? state.toolCalls.get(targetId) : null;
        if (tc) {
          tc.argumentsJson += data.delta;
          onToolCallDelta?.({
            toolCallId: tc.id,
            name: tc.name,
            argumentsDelta: data.delta,
          });
        }
        break;

      case "response.output_item.done":
        // function_call 完成时，可用 done 事件的完整 arguments 做校验
        if (data.type === "function_call" && data.call_id) {
          const doneTc = state.toolCalls.get(data.call_id);
          if (doneTc && data.arguments) {
            // 用完整参数覆盖流式累积值（防止丢 chunk 导致 JSON 不完整）
            doneTc.argumentsJson = data.arguments;
          }
          state.activeToolCallItemId = null;
        }
        break;

      case "response.completed":
        // ** 关键：判断 finishReason **
        // 如果 output 中包含 function_call，finishReason 必须是 "tool_calls"
        // 否则 session runtime 不会进入工具执行循环
        if (state.toolCalls.size > 0) {
          state.finishReason = "tool_calls";
        } else {
          state.finishReason = data.status === "completed" ? "stop" : data.status;
        }
        if (data.usage) {
          state.usage = {
            promptTokens: data.usage.input_tokens ?? 0,
            completionTokens: data.usage.output_tokens ?? 0,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
            reasoningTokens: data.usage.reasoning_tokens,
            cachedInputTokens: data.usage.input_tokens_details?.cached_tokens,
          };
        }
        break;

      default:
        // 未知事件类型 — skip + 日志，不 crash
        // console.debug(`[openai-stream] unknown event: ${event}`);
        break;
    }
  }

  return {
    content: state.contentParts.join(""),
    reasoning: state.reasoningParts.join("") || undefined,
    toolCalls: materializeToolCalls(state.toolCalls),
    finishReason: state.finishReason,
    usage: state.usage ?? undefined,
    responseId: state.responseId,
  };
}
```

### 6.3 SSE 行读取器

```typescript
// 与现有 consumeSseStream 的行读取逻辑类似，但需要解析 event: 和 data: 两行
async function* readSseLines(response: Response): AsyncGenerator<{ event: string; data: any }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // 最后一个可能是不完整的行

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const raw = line.slice(6);
        if (raw === "[DONE]") return;
        try {
          yield { event: currentEvent, data: JSON.parse(raw) };
        } catch {
          // 非 JSON data 行，跳过
        }
      }
      // 空行重置 event（SSE 规范）
      if (line === "") currentEvent = "";
    }
  }
}
```

---

## 7. UI 设计

### 7.1 模型详情页扩展

在现有 `ModelDetailPage.tsx` 中，基本信息区新增 **API 协议**选择器，下方新增**「模型调优」**折叠区块：

```
┌─────────────────────────────────────────────────────────┐
│ ● 基本信息                                               │
│   配置名称:   [My GPT-5.4      ]                         │
│   服务商预设: [OpenAI ▼]                                  │
│   API 协议:   [Responses API ▼]                          │
│               • Chat Completions (OpenAI 兼容)           │
│               • Responses API (OpenAI 原生)              │
│               • Anthropic Messages                       │
│   模型 ID:    [gpt-5.4         ] [测试联通] [获取模型列表]│
│   接口地址:   [http://cdn.arche-tech.ai]                  │
│   API Key:    [sk-...          ] 👁                      │
├─────────────────────────────────────────────────────────┤
│ ● 模型调优                                               │
│                                                          │
│   推理深度 (Reasoning Effort)                             │
│   [high ▼]   ← wireApi=responses 显示 low/medium/high/xhigh
│              ← 其他协议显示 low/medium/high               │
│              ← 不支持 reasoning 的模型不显示此项           │
│                                                          │
│   上下文窗口                                              │
│   [          ] tokens    placeholder: "1000000 (自动)"    │
│   └ 留空则使用模型默认值                                   │
│                                                          │
│   自动压缩阈值                                            │
│   [          ] tokens    placeholder: "900000 (自动)"     │
│   └ 留空则使用 上下文窗口 × 0.9                           │
│                                                          │
│   ┄┄┄ 仅 wireApi = "responses" 可见 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   │
│                                                          │
│   禁用响应存储                                            │
│   [○ 关闭]   ← 开启后 API 端不保存对话记录                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 7.2 厂商预设 → API 协议联动

```typescript
// 切换厂商预设时，自动设置 API 协议默认值
function onPresetChange(presetId: string) {
  applyPreset(presetId);

  const defaultWireApi = PRESET_DEFAULT_WIRE_API[presetId] ?? "chat-completions";
  setProfile((prev) => ({ ...prev, wireApi: defaultWireApi }));
}

// API 协议选项始终可见、可手动选择
// Custom 模式下三个协议都能选——用户知道自己的网关支持什么
```

### 7.3 条件显示逻辑

```typescript
const effectiveWireApi = getEffectiveWireApi(profile);
const isResponsesApi = effectiveWireApi === "responses";
const modelConfig = isResponsesApi ? queryOpenAIModelConfig(profile.model) : null;

// Reasoning effort: 仅当模型支持时显示
// - Responses API: 查 modelConfig.supportsReasoning
// - Anthropic: 部分模型支持（通过 discoveredCapabilities 判断）
// - Chat Completions: 部分模型支持（同上）
const showReasoningEffort = modelConfig?.supportsReasoning
  ?? profile.discoveredCapabilities?.supportsReasoning
  ?? false;
// xhigh 选项: 仅 Responses API 且模型支持时出现
const showXhigh = isResponsesApi && (modelConfig?.supportsXhigh ?? false);
// Responses API 专属选项
const showResponsesOptions = isResponsesApi;
```

### 7.4 自动回填

用户选择模型后，从内置配置自动回填 placeholder（仅当 wireApi === "responses" 时查 OpenAI 模型库）：
- 上下文窗口 → modelConfig.contextWindow
- 压缩阈值 → contextWindow × 0.9
- 推理深度 → modelConfig.recommendedEffort

用户不填 = 用默认值。用户填了 = 覆盖。

---

## 8. Context 策略适配

### 8.1 绝对压缩阈值

当 `profile.compactTriggerTokens` 有值时，`token-budget-manager.ts` 使用它替代比例计算。

**注意**：`compactTriggerTokens` 定义在 `ModelProfile` 上（用户配置），在 `buildBudgetSnapshot()` 时需要从 profile 传入：

```typescript
// token-budget-manager.ts
export function buildBudgetSnapshot(
  capability: ModelCapability,
  policy?: ContextBudgetPolicy,
  profileOverrides?: { compactTriggerTokens?: number },
): BudgetSnapshot {
  // ...existing logic...
  const compactTriggerTokens = profileOverrides?.compactTriggerTokens
    ?? Math.floor(snapshot.safeInputBudget * p.compactTriggerRatio);
  return { ...snapshot, compactTriggerTokens };
}
```

### 8.2 大窗口自动适配

当有效上下文窗口 >= 500K 时，自动调整压缩策略：

```typescript
function adaptPolicyForLargeContext(
  policy: Required<ContextBudgetPolicy>,
  effectiveWindow: number,
): Required<ContextBudgetPolicy> {
  if (effectiveWindow < 500_000) return policy;

  return {
    ...policy,
    minRecentTurnsToKeep: Math.max(policy.minRecentTurnsToKeep, 30),
    recentToolOutputTurnsToKeep: Math.max(policy.recentToolOutputTurnsToKeep, 25),
    outputReserveTokens: Math.max(policy.outputReserveTokens, 16384),
    suggestNewChatAfterCompactions: Math.max(policy.suggestNewChatAfterCompactions, 5),
  };
}
```

---

## 9. 实施计划

### 依赖图

```
Wave 1（基础）
  节点 0: 类型定义 ──────────────────────────────────────────────────┐
                                                                      │
Wave 2（四路并行）                                                     │
  ├── 节点 A: 内置模型能力配置 (openai-models.json + 查询服务)         │
  ├── 节点 B: Responses API 流式解析器 (stream-parser.ts)              │
  ├── 节点 C: Responses API 请求构造器 (request-builder.ts)            │
  └── 节点 D: ModelProfile 数据模型扩展 (contracts + persistence)      │
                                                                      │
Wave 3（两路并行）                                                     │
  ├── 节点 E: OpenAI Responses Client (client.ts，组装 B+C)           │
  └── 节点 F: 模型详情页 UI 扩展 (ModelDetailPage.tsx)                 │
                                                                      │
Wave 4                                                                │
  节点 G: Session Runtime 集成 (sessions.ts 路由分发)                  │
                                                                      │
Wave 5（三路并行）                                                     │
  ├── 节点 H: GPT Prompt 优化层 (prompt-optimizer.ts)                  │
  ├── 节点 I: 大窗口 Context 策略 (compactor + budget 适配)            │
  └── 节点 J: Token 用量展示 (renderer 侧)                            │
                                                                      │
Wave 6（v2）                                                          │
  节点 K: 高级特性 (自动降级 / previous_response_id / 远程配置)        │
```

### 节点详细定义

#### 节点 0: 类型定义
- **位置**: `desktop/src/main/services/openai/types.ts` + `desktop/shared/contracts/model.ts` + `desktop/shared/contracts/session-runtime.ts`
- **内容**:
  - OpenAI Responses API 请求/响应/事件全量 TypeScript 类型
  - `WireApi` 类型定义：`"chat-completions" | "responses" | "anthropic-messages"`
  - `getEffectiveWireApi()` 推导函数（兼容无 wireApi 的老 profile，从 provider 字段 fallback）
  - `ModelProfile` 新增 `wireApi`、`defaultReasoningEffort`、`contextWindowOverride`、`compactTriggerTokens`、`responsesApiConfig` 字段
  - `SessionReasoningEffort` 加入 `"xhigh"`
  - `TokenUsage` 加入 `reasoningTokens`、`cachedInputTokens`
- **产出**: 后续所有节点的公共类型语言
- **预估**: 小

#### 节点 A: 内置模型能力配置
- **位置**: `desktop/src/main/services/openai/openai-models.json` + `desktop/src/main/services/openai/model-config-service.ts`
- **内容**:
  - JSON 数据文件，包含已知 GPT 模型的能力信息
  - 查询函数：精确匹配 → 族前缀匹配 → 通用默认值
  - 暴露 IPC 供 renderer 查询（UI 自动回填用）
- **产出**: `resolveOpenAIModelConfig(modelId)` 函数
- **预估**: 小
- **可并行**: 是（与 B/C/D 无依赖）

#### 节点 B: Responses API 流式解析器
- **位置**: `desktop/src/main/services/openai/stream-parser.ts`
- **内容**:
  - 解析 `event:` + `data:` 双行 SSE 格式
  - 处理所有事件类型：`response.created`、`content_part.delta`、`reasoning_summary_text.delta`、`function_call_arguments.delta`、`output_item.added/done`、`response.completed`
  - 回调签名与现有 `consumeSseStream` 一致：`onDelta`、`onToolCallDelta`
  - 返回 `{ content, reasoning, toolCalls[], finishReason, usage, responseId }`
  - 单元测试：构造各种事件序列验证解析正确性
- **产出**: `consumeResponsesStream()` 函数
- **预估**: **大**（事件类型多、边界条件多）
- **可并行**: 是（与 A/C/D 无依赖）

#### 节点 C: Responses API 请求构造器
- **位置**: `desktop/src/main/services/openai/request-builder.ts`
- **内容**:
  - `ChatMessage[]` → Responses API `input[]` + `instructions` 转换
  - Tool schema 格式转换（顶层 name、strict mode）
  - Reasoning effort、store、max_output_tokens 等参数组装
  - URL 构建（baseUrl → `/v1/responses`）
  - Headers 构建（Bearer token）
  - 用户 `requestBody` merge
  - 单元测试：各种消息组合的转换正确性
- **产出**: `buildResponsesApiRequest()` 函数
- **预估**: 中
- **可并行**: 是（与 A/B/D 无依赖）

#### 节点 D: ModelProfile 数据模型扩展
- **位置**: `desktop/shared/contracts/model.ts` + `session-runtime.ts` + `token-budget-manager.ts`
- **内容**:
  - `WireApi` 类型、`ModelProfile` 加字段（向后兼容，全部 optional）
  - `SessionReasoningEffort` 加 `"xhigh"`
  - `getEffectiveWireApi()` 函数（从 wireApi 或 provider 推导）
  - `buildBudgetSnapshot()` 支持 `compactTriggerTokens` 绝对值（从 profile 传入）
  - 确保 `state-persistence.ts` 序列化/反序列化兼容
  - **不改** `resolveModelCapability()`——那依赖节点 A，移到节点 G 做
- **产出**: 数据模型就绪，持久化兼容新字段
- **预估**: 小
- **可并行**: 是（与 A/B/C 无依赖）

#### 节点 E: OpenAI Responses Client
- **位置**: `desktop/src/main/services/openai/client.ts` + `index.ts`
- **依赖**: 节点 B + 节点 C + 节点 A
- **内容**:
  - `callOpenAIModel(options: ModelCallOptions): Promise<ModelCallResult>`
  - 内部流程：查模型配置 → 构建请求 → 发 fetch（复用 `model-transport.ts`）→ 解析流式响应 → 返回 `ModelCallResult`
  - 错误映射：超时/鉴权/限流 → 清晰中文信息
  - 集成测试（mock fetch）
- **产出**: 完整的 OpenAI 原生调用能力
- **预估**: 中

#### 节点 F: 模型详情页 UI 扩展
- **位置**: `desktop/src/renderer/pages/ModelDetailPage.tsx` + preload 桥接
- **依赖**: 节点 D + 节点 A（IPC 查询）
- **内容**:
  - 基本信息区新增 **API 协议**下拉（Chat Completions / Responses API / Anthropic Messages）
  - 厂商预设切换时自动联动 wireApi 默认值，用户可手动覆盖
  - 新增「模型调优」折叠区
  - Reasoning Effort 下拉（wireApi=responses 且模型支持时显示 xhigh）
  - 上下文窗口输入（自动回填已知值）
  - 压缩阈值输入
  - Responses API 专属：禁用响应存储开关（wireApi=responses 时显示）
  - 选模型后自动回填 placeholder
  - Preload 新增 `queryOpenAIModelConfig()` IPC 桥接
- **产出**: 用户可配置的调优面板（含 API 协议选择器）
- **预估**: 中

#### 节点 G: Session Runtime 集成
- **位置**: `desktop/src/main/ipc/sessions.ts` + `desktop/src/main/services/reasoning-runtime.ts` + `desktop/src/main/ipc/workflows.ts` + `desktop/src/main/ipc/models.ts` + `desktop/src/main/services/model-capability-resolver.ts`
- **依赖**: 节点 E + 节点 A + 节点 D
- **内容**:
  - `handleSessionSendMessage` 中通过 `getEffectiveWireApi()` 路由：`"responses"` → `callOpenAIModel()`，其他 → `callModel()`
  - **Workflow 引擎也加路由**：`workflows.ts` 中的 LLM 节点同样按 wireApi 分发
  - `buildExecutionPlan()` 扩展：读 `defaultReasoningEffort`，支持 `xhigh`
  - `resolveModelCapability()` 加一层：当 wireApi=responses 时读 OpenAI 内置配置作为 capability 来源（此处依赖节点 A）
  - 上下文预算：使用 `contextWindowOverride` 和 `compactTriggerTokens`
  - **`model:test-by-config` 适配**：按 wireApi 分发探测请求，`"responses"` 时向 `/v1/responses` 发最小请求
  - onDelta / onToolCallDelta 回调不变
  - 集成测试：mock Responses API 响应，验证从 IPC 到 renderer 事件推送
- **产出**: 端到端 OpenAI 原生调用通路（session + workflow + 测试联通）
- **预估**: 中偏大

#### 节点 H: GPT Prompt 优化层
- **位置**: `desktop/src/main/services/openai/prompt-optimizer.ts`
- **依赖**: 节点 G
- **内容**:
  - `optimizeSystemPromptForGPT(systemPrompt, modelConfig)` 函数
  - Responses API 的 `instructions` 字段格式优化
  - 工具描述措辞优化
  - 长对话 context recap 策略
- **产出**: GPT 专属 prompt 增强
- **预估**: 小（可选增强）

#### 节点 I: 大窗口 Context 策略
- **位置**: `desktop/src/main/services/context-compactor.ts` + `token-budget-manager.ts`
- **依赖**: 节点 D
- **内容**:
  - `compactTriggerTokens` 绝对值支持
  - >= 500K 窗口自动放大保留轮次和工具输出
  - 调整 Observation Masking 阈值
- **产出**: 大窗口模型的智能压缩策略
- **预估**: 小

#### 节点 J: Token 用量展示
- **位置**: Renderer 侧组件
- **依赖**: 节点 G
- **内容**:
  - Responses API 返回的 `reasoning_tokens`、`cached_input_tokens` 展示
  - 聊天消息底部或会话信息面板
  - 扩展 `TokenUsage` 传递到 renderer
- **产出**: 用量透明化
- **预估**: 小

#### 节点 K: 高级特性（v2，第一版不做）
- **内容**:
  1. 自动降级：Responses API 失败 → fallback Chat Completions
  2. `previous_response_id`：服务端会话状态
  3. 远程配置：从 Cloud 拉取 `openai-models.json` 更新
- **预估**: 大

### 并行策略

```
时间线 →

Wave 1:  [节点 0: 类型定义                          ]
          ↓
Wave 2:  [节点 A: 模型配置] [节点 B: 流式解析] [节点 C: 请求构造] [节点 D: 数据模型]
          ↓                  ↓                ↓                  ↓
Wave 3:                     [节点 E: Client (B+C+A)]           [节点 F: UI (D+A)]
                             ↓                                  ↓
Wave 4:                     [节点 G: Runtime 集成 (E+F+A+D)                      ]
                             ↓
Wave 5:  [节点 H: Prompt]   [节点 I: Context]   [节点 J: Token 展示]
                             ↓
Wave 6:  [节点 K: 高级特性 (v2)                                                  ]
```

**最大并行度**: Wave 2 的 4 路并行。如果用 4 个 agent 同时跑，整体开发周期可压缩约 40%。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 代理网关不支持 Responses API | OpenAI 原生路径不可用 | 节点 K 的自动降级机制；用户可在 UI 切回 Chat Completions |
| OpenAI 更新 Responses API 格式 | 流式解析器失效 | 独立模块隔离影响面；只改 `openai/` 目录 |
| 内置 JSON 过期 | 新模型走默认值 | 族正则匹配兜底；后续加远程更新 |
| Responses API 流式事件有未覆盖的类型 | 解析不完整 | 未知事件 skip + 日志，不 crash |
| xhigh reasoning 耗时过长 | 用户以为卡死 | 流式推理摘要实时展示 + 超时保护 |
| 测试联通按钮对 Responses API 无效 | 用户无法验证配置 | `model:test-by-config` 需要按 wireApi 分发：`"responses"` 时向 `/v1/responses` 发探测请求 |
| wireApi 和 provider 字段矛盾组合 | 路由行为不符预期 | 统一使用 `getEffectiveWireApi()` 路由；厂商预设切换时自动同步两个字段 |

---

## 11. 验收标准

### 基本功能（Wave 1-4 完成后）

- [ ] 模型详情页可选 API 协议（Chat Completions / Responses API / Anthropic Messages）
- [ ] 切换厂商预设时 API 协议自动联动，用户可手动覆盖
- [ ] Custom 厂商可以手动选择 Responses API（自建 OpenAI 代理场景）
- [ ] 选 Responses API + gpt-5.4，自动走 OpenAI 原生通路
- [ ] Reasoning effort 可选 low / medium / high / xhigh（Responses API 时）
- [ ] 流式输出正常（文本 + 推理摘要分别推送）
- [ ] 工具调用正常（tool call 解析、执行、结果回传）
- [ ] 上下文窗口 / 压缩阈值可手动覆盖
- [ ] 禁用响应存储开关生效
- [ ] wireApi 未设置或为 chat-completions 时，走原有路径，无回归

### 优化增强（Wave 5 完成后）

- [ ] GPT-5.4 的 1M 上下文窗口正确利用（不过早压缩）
- [ ] Token 用量细粒度展示（推理 token / 缓存 token）
- [ ] GPT 专属 prompt 优化生效
