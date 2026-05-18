# Provider Cache Optimization Design

## 背景

本方案解决 MyClaw 桌面端模型运行时在多厂商路线上的缓存命中、计费可观测和路线选择问题。现状不是 DeepSeek 单点缺陷，而是模型请求层没有统一的缓存契约：system prompt 每轮被重建，动态内容出现在请求前缀很靠前的位置，usage 链路只保存总 token，部分厂商的原生缓存能力没有接入。

多 agent 只读调查得到的关键事实：

- DeepSeek 默认走 `openai-chat-compatible`，支持但不默认走 `anthropic-messages`。
- DeepSeek 官方 context cache 默认开启，不需要业务方传 `cache_control`；Anthropic 兼容路径会忽略 `cache_control`。
- 当前 `prompt-composer.ts` 每轮注入精确到秒的 `Date`，且位置在 system prompt 前部，这会打穿所有依赖精确前缀匹配的缓存。
- OpenAI Responses 解析了 `cached_tokens`，但 DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`、Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens` 都没有解析。
- 普通聊天消息落盘时会裁剪 usage，只保存 `promptTokens`、`completionTokens`、`totalTokens`，导致缓存命中信息即使存在也会丢失。

## 目标

1. 所有厂商路线都具备稳定请求前缀，不再被秒级时间、临时上下文、任务状态污染。
2. 所有厂商 cache usage 都能解析、落盘、展示、参与路线评分。
3. 能按厂商协议自动注入正确的缓存参数，而不是在各 adapter 中散落特判。
4. 默认路线不再只靠静态配置，而是由功能成功率、缓存命中率、延迟和成本共同决定。
5. 改造后可通过单元测试和集成测试证明前缀稳定、usage 正确、请求体符合厂商缓存协议。

## 非目标

- 不实现本地 KV cache，不保存供应商缓存内容。
- 不绕过厂商官方计费规则。
- 不在首个版本中做精确人民币账单结算；先实现 token 级缓存观测和估算字段。
- 不改变用户手动选择模型和协议路线的权力。

## 总体方案

新增一层 `Provider Cache Orchestrator`，作为 prompt composer、protocol driver、usage parser 和 route scorecard 之间的统一缓存编排层。它负责四件事：

1. 给 prompt section 标记缓存层级，并生成稳定前缀。
2. 计算 `stablePrefixHash`、`toolBundleHash`、`promptCacheKey`。
3. 按厂商和协议注入缓存参数。
4. 归一化各厂商 usage，产出统一 cache metrics。

目标调用链：

```text
sessions/workflows
  -> composePromptPlan()
  -> buildCanonicalTurnContent()
  -> createToolMiddleware()
  -> ProviderCacheOrchestrator.prepare()
  -> protocol driver builds provider request
  -> ProviderCacheOrchestrator.normalizeUsage()
  -> turn outcome / session DB / UI / scorecard
```

## Prompt 缓存分层

新增 `PromptCacheTier`：

```ts
export type PromptCacheTier = "stable-prefix" | "semi-stable" | "volatile-tail";
```

分层规则：

| 层级 | 内容 | 位置 | 缓存要求 |
|---|---|---|---|
| `stable-prefix` | Identity、核心 Guidelines、Tool Strategy、Tools 说明、Skills 说明、厂商 policy | 请求最前 | 同 profile、同工具集、同 skill 集下字节级稳定 |
| `semi-stable` | cwd、platform、git branch、用户 profile、长期 memory 摘要 | 稳定区之后 | 可以变化，但不能挡在稳定大段前面 |
| `volatile-tail` | 当前时间、最近文件、artifact、meeting、current tasks、检索 evidence、最近用户意图 | 历史消息前或最后一个用户上下文 | 每轮可变 |

关键调整：

- `Date` 不再放在 system prompt 前部；若业务需要日期，只放 `YYYY-MM-DD`，并进入 `volatile-tail`。
- 精确时间只在用户任务需要时作为动态上下文尾部注入。
- `Session Context`、`Work Files`、`Meeting Context`、`Current Tasks`、`Memory Evidence` 全部进入 `volatile-tail`。
- Tools 和 Skills 的可见文本必须排序稳定。
- 工具 description 中不再内联 `Working directory: ${cwd}`，cwd 进入动态 runtime context。

渲染后协议层应获得结构化输入：

```ts
export type PromptCachePlan = {
  stablePrefixText: string;
  semiStableText: string;
  volatileTailText: string;
  stablePrefixHash: string;
  toolBundleHash: string;
  promptCacheKey: string;
};
```

## Usage 统一契约

扩展 `TurnOutcomeUsage` 和 `MessageTokenUsage`：

```ts
export type ProviderCacheUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  effectiveBillableInputTokens?: number;
  cacheEfficiency?: number;
  rawProviderUsage?: Record<string, unknown>;
};
```

字段含义：

- `cachedInputTokens`：OpenAI/Qwen/MiniMax 等返回的已缓存输入 token。
- `cacheHitInputTokens`：DeepSeek 等明确返回 hit token 的字段。
- `cacheMissInputTokens`：DeepSeek 等明确返回 miss token 的字段。
- `cacheReadInputTokens`：Anthropic 读取缓存的 token。
- `cacheWriteInputTokens`：Anthropic 写入缓存的 token。
- `effectiveBillableInputTokens`：按 provider pricing profile 粗略估算的折算输入 token，第一阶段可为空。
- `cacheEfficiency`：`cache hit/read/cached tokens / promptTokens`。
- `rawProviderUsage`：保留原始 usage，便于未来补字段。

所有持久化路径必须保留完整 usage，不允许在 IPC 层裁剪。

## 厂商策略

### DeepSeek

默认路线继续 `openai-chat-compatible`。这是当前官方兼容性最稳的路径，也符合注册表默认。优化重点不是切协议，而是修前缀稳定和 usage 解析。

请求策略：

- `messages[0]` 开头使用稳定前缀。
- `stream_options.include_usage = true` 默认开启。
- 不注入 `cache_control`。
- V4 `thinking` / `reasoning_effort` 保留在 request body，不影响 messages 前缀。

usage 映射：

- `usage.prompt_cache_hit_tokens` -> `cacheHitInputTokens`
- `usage.prompt_cache_miss_tokens` -> `cacheMissInputTokens`
- `cacheEfficiency = hit / (hit + miss)`

### OpenAI

OpenAI 走 Responses 优先，并把 Responses gate 从“灰度候选”提升为缓存优先路线。

请求策略：

- 开启 `previous_response_id`，默认建议 profile 层启用 `responsesApiConfig.useServerState`。
- 生成稳定 `prompt_cache_key`：`myclaw:${profileId}:${stablePrefixHash}:${toolBundleHash}`。
- 对支持模型可设置 `prompt_cache_retention: "24h"`。
- 保留 `store` 和 background mode 现有逻辑。

usage 映射：

- `usage.input_tokens_details.cached_tokens` -> `cachedInputTokens`

### Anthropic

Anthropic Messages 路线必须真正实现 prompt caching，而不是只在 `cacheMode` 中标注。

请求策略：

- 将 system 从纯 string 改为 block array，最后一个稳定 system block 加 `cache_control: { type: "ephemeral" }`。
- tools 数组最后一个工具加 cache breakpoint。
- 动态 user context 和历史消息不加 cache breakpoint。
- 按模型能力注入必要 beta header，集中在 header builder 中实现。

usage 映射：

- `usage.cache_read_input_tokens` -> `cacheReadInputTokens`
- `usage.cache_creation_input_tokens` -> `cacheWriteInputTokens`

### Qwen

Qwen 保持 Responses 优先，并把服务端续接和 DashScope session cache 作为默认缓存策略。

请求策略：

- 默认 `openai-responses`。
- profile 默认启用 `responsesApiConfig.useServerState`。
- profile 默认 `responsesApiConfig.sessionCache = "enable"`。
- 继续支持 thinking budget、native search、file search。

usage 映射：

- OpenAI-style `input_tokens_details.cached_tokens` -> `cachedInputTokens`
- DashScope 扩展字段保留到 `rawProviderUsage`，后续按样本补映射。

### Kimi / Moonshot

Kimi 当前默认 `anthropic-messages`，但不能假设 Anthropic-compatible 就自动获得 Claude Code 的缓存体验。

请求策略：

- Anthropic route 接入与 Anthropic 相同的 `cache_control`。
- OpenAI-compatible route 开启 `stream_options.include_usage` 并解析 cached tokens。
- Formula/native tools 只有在功能收益高于缓存收益时才启用。

路线策略：

- 同一 profile 的 `anthropic-messages` 与 `openai-chat-compatible` 都进入 scorecard。
- 连续三轮 cacheEfficiency 低于阈值且无工具成功率优势时，自动建议或切换到更优路线。

### Volcengine Ark

Ark 当前默认 compatible 不利于缓存。需要把 Responses/Anthropic 能力纳入真实候选，而不是只写在 registry 中。

请求策略：

- 开启 Ark Responses gate，作为主候选。
- compatible route 加 `stream_options.include_usage`。
- 所有 Ark 返回的 cached token 字段都进入 usage normalizer。

路线策略：

- scorecard 同时看缓存命中率和工具成功率，避免为了缓存牺牲原生工具能力。

### MiniMax

MiniMax 需要同时支持 compatible 自动缓存和 Anthropic-style 显式 cache breakpoint。

请求策略：

- OpenAI-compatible route 默认加 `stream_options.include_usage`。
- Anthropic route 加 `cache_control`。
- BR MiniMax `<think>` / reasoning replay 仅影响历史消息，不进入 stable prefix。

路线策略：

- 公开 MiniMax 与 BR MiniMax 分开评分。
- 默认路线由 scorecard 选择，不再静态假设 compatible 一定最好。

## Route Scorecard

扩展现有 provider scorecard，增加 cache 和成本维度：

```ts
score =
  successRate * 0.40 +
  cacheHitRate * 0.30 +
  latencyScore * 0.15 +
  estimatedCostScore * 0.15;
```

规则：

- 用户显式选择路线时不自动覆盖，只提示更优路线。
- managed profile 默认路线可以由 scorecard 更新。
- cacheHitRate 样本少于三轮时不参与自动切换，只参与观测。
- 工具调用失败率高于阈值时，功能正确性优先于缓存。

## UI 与日志

ChatPage token badge 从单一 total tokens 改为缓存感知：

- 输入：`promptTokens`
- 输出：`completionTokens`
- 命中：`cachedInputTokens` / `cacheHitInputTokens` / `cacheReadInputTokens`
- 写入：`cacheWriteInputTokens`
- 未命中：`cacheMissInputTokens`
- 估算节省：`cacheEfficiency`

turn outcome JSON 和 telemetry JSONL 增加：

- `stablePrefixHash`
- `toolBundleHash`
- `promptCacheKey`
- `cacheEfficiency`
- `routeScoreSnapshot`
- `rawProviderUsage` 的安全摘要

日志必须使用中文，覆盖：

- cache plan 生成
- provider cache 参数注入
- usage 归一化
- scorecard 更新
- 自动路线建议或切换

## 错误处理

- provider 不接受 cache 参数时，记录 fallback event，并自动降级为无缓存参数请求。
- usage 字段缺失时不报错，记录 `cacheMetricsStatus: "missing-provider-usage"`。
- raw usage 过大时截断保存，避免 turn outcome 膨胀。
- stable prefix hash 为空时阻断缓存参数注入，防止错误路由。
- scorecard 样本不足时不自动切换。

## 迁移策略

第一阶段只追加字段，不破坏旧 session DB。旧消息没有 cache usage 时按 undefined 处理。

第二阶段新增 DB 列或 JSON usage 字段。推荐将 message usage 从三列 token 逐步迁移为 JSON，同时保留旧列用于列表快速汇总。

第三阶段启用 scorecard 自动路线建议。自动切换先只对 managed profile 生效，手动 profile 只提示。

## 验收标准

- 相同 profile、相同工具集、相同 skills 下，两轮请求的 `stablePrefixHash` 一致。
- 秒级时间变化不影响 `stablePrefixHash`。
- MCP tool 输入顺序变化不影响 `toolBundleHash`。
- DeepSeek 样本能解析 hit/miss。
- Anthropic 样本能解析 read/write。
- OpenAI、Qwen、MiniMax 样本能解析 cached tokens。
- DeepSeek 不出现 `cache_control`。
- Anthropic/MiniMax Anthropic route 出现正确 cache breakpoint。
- ChatPage 能显示缓存命中和未命中，不再只显示 total tokens。
- turn outcome 保留完整 usage。

## 参考资料

- DeepSeek Context Caching: https://api-docs.deepseek.com/guides/kv_cache
- DeepSeek Anthropic API: https://api-docs.deepseek.com/guides/anthropic_api
- OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching
- Anthropic Prompt Caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Qwen Responses API: https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses
- MiniMax Prompt Caching: https://platform.minimax.io/docs/api-reference/text-prompt-caching
