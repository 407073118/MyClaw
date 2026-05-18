# Provider Cache Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 MyClaw 桌面端模型运行时改造成缓存优先、跨厂商可观测、可按真实表现优化路线的调用层。

**Architecture:** 新增 `Provider Cache Orchestrator` 统一管理稳定前缀、缓存参数注入、usage 归一化和路线评分。Prompt 组装层输出稳定区、半稳定区和动态尾部；协议驱动只负责把缓存计划映射到各厂商 wire shape。

**Tech Stack:** TypeScript、Electron main process、React renderer、Vitest、sql.js session DB、现有 `model-runtime` protocol driver 架构。

---

## 全局约束

- 遵守根 `AGENTS.md`：所有方法必须写中文注释，新增日志使用中文，编辑中文文件后必须复读检查。
- 每个任务先写失败测试，再实现，再运行目标测试。
- 不修改无关 UI 和时间中心现有改动。
- 不提交用户已有未提交改动。
- 每个任务完成后单独提交，提交信息使用中文或项目既有风格。

## Task 1: 扩展缓存 usage 契约

**Files:**

- Modify: `desktop/shared/contracts/session-runtime.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/src/main/services/model-client.ts`
- Test: `desktop/tests/model-runtime/contracts/provider-cache-usage-contract.test.ts`

**Step 1: 写失败测试**

新增测试，断言消息 usage 和 turn outcome usage 可以携带缓存字段：

```ts
import type { ChatMessage } from "../../../shared/contracts/session";
import type { TurnOutcomeUsage } from "../../../shared/contracts/session-runtime";

describe("provider cache usage contract", () => {
  it("allows cache-aware usage fields on turn outcomes and messages", () => {
    const usage: TurnOutcomeUsage = {
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cachedInputTokens: 600,
      cacheHitInputTokens: 600,
      cacheMissInputTokens: 400,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheEfficiency: 0.6,
      rawProviderUsage: { prompt_cache_hit_tokens: 600 },
    };
    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "ok",
      createdAt: "2026-05-16T00:00:00.000Z",
      usage,
    };
    expect(message.usage?.cacheHitInputTokens).toBe(600);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/contracts/provider-cache-usage-contract.test.ts
```

Expected: FAIL，类型字段不存在或编译失败。

**Step 3: 实现契约**

- 在 `TurnOutcomeUsage` 增加缓存字段和 `rawProviderUsage`。
- 在 `MessageTokenUsage` 中同步字段，或让它引用共享 usage 类型。
- 在 `TokenUsage` 中同步字段，避免 `model-client` 返回值丢失字段。
- 为新增类型和关键方法加中文注释。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/contracts/provider-cache-usage-contract.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/shared/contracts/session-runtime.ts desktop/shared/contracts/session.ts desktop/src/main/services/model-client.ts desktop/tests/model-runtime/contracts/provider-cache-usage-contract.test.ts
git commit -m "feat(desktop): 扩展模型缓存用量契约"
```

## Task 2: 新增 Provider Cache Orchestrator

**Files:**

- Create: `desktop/src/main/services/model-runtime/provider-cache-orchestrator.ts`
- Modify: `desktop/src/main/services/model-runtime/index.ts`
- Test: `desktop/tests/model-runtime/unit/provider-cache-orchestrator.test.ts`

**Step 1: 写失败测试**

覆盖 hash、prompt cache key、usage 归一化：

```ts
import {
  buildPromptCacheKey,
  hashCacheStableValue,
  normalizeProviderCacheUsage,
} from "../../../src/main/services/model-runtime/provider-cache-orchestrator";

describe("provider-cache-orchestrator", () => {
  it("builds stable prompt cache keys from stable prefix and tools", () => {
    const stablePrefixHash = hashCacheStableValue("stable prompt");
    const toolBundleHash = hashCacheStableValue([{ name: "fs_read" }]);
    expect(buildPromptCacheKey({
      profileId: "profile-openai",
      stablePrefixHash,
      toolBundleHash,
    })).toBe(`myclaw:profile-openai:${stablePrefixHash}:${toolBundleHash}`);
  });

  it("normalizes DeepSeek hit and miss tokens", () => {
    const usage = normalizeProviderCacheUsage("deepseek", {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_cache_hit_tokens: 700,
      prompt_cache_miss_tokens: 300,
    });
    expect(usage.cacheHitInputTokens).toBe(700);
    expect(usage.cacheMissInputTokens).toBe(300);
    expect(usage.cacheEfficiency).toBeCloseTo(0.7);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/provider-cache-orchestrator.test.ts
```

Expected: FAIL，模块不存在。

**Step 3: 实现模块**

实现以下导出函数，所有函数写中文注释：

```ts
export function hashCacheStableValue(value: unknown): string;
export function buildPromptCacheKey(input: {
  profileId: string;
  stablePrefixHash: string;
  toolBundleHash: string;
}): string;
export function normalizeProviderCacheUsage(
  vendorFamily: VendorFamily | ProviderFamily | string,
  rawUsage: Record<string, unknown> | null | undefined,
): TurnOutcomeUsage | undefined;
```

实现要求：

- hash 使用 Node `crypto.createHash("sha256")`，输出前 16 或 24 位即可。
- JSON 序列化必须稳定排序 object key。
- DeepSeek 解析 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。
- Anthropic 解析 `cache_read_input_tokens` / `cache_creation_input_tokens`。
- OpenAI/Qwen/MiniMax/compatible 解析 `input_tokens_details.cached_tokens`、`prompt_tokens_details.cached_tokens`、顶层 `cached_tokens`。
- 保存 `rawProviderUsage`，但截断超大字段。
- 用中文 `console.info` 记录 usage 归一化摘要。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/provider-cache-orchestrator.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/model-runtime/provider-cache-orchestrator.ts desktop/src/main/services/model-runtime/index.ts desktop/tests/model-runtime/unit/provider-cache-orchestrator.test.ts
git commit -m "feat(desktop): 增加供应商缓存编排器"
```

## Task 3: 重构 prompt section 缓存分层

**Files:**

- Modify: `desktop/src/main/services/model-runtime/prompt-composer.ts`
- Modify: `desktop/src/main/services/model-runtime/canonical-turn-content.ts`
- Modify: `desktop/src/main/services/model-runtime/protocols/shared.ts`
- Test: `desktop/tests/model-runtime/unit/prompt-composer.test.ts`
- Test: `desktop/tests/model-runtime/unit/prompt-cache-prefix.test.ts`

**Step 1: 写失败测试**

新增测试证明秒级时间变化不改变 stable prefix：

```ts
import {
  composePromptSections,
  renderPromptSectionsByCacheTier,
} from "../../../src/main/services/model-runtime/prompt-composer";

describe("prompt cache prefix", () => {
  it("keeps stable prefix identical when only time changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T10:00:00Z"));
    const first = composePromptSections(makeInput());
    vi.setSystemTime(new Date("2026-05-16T10:00:05Z"));
    const second = composePromptSections(makeInput());
    expect(renderPromptSectionsByCacheTier(first).stablePrefixText)
      .toBe(renderPromptSectionsByCacheTier(second).stablePrefixText);
    vi.useRealTimers();
  });
});
```

`makeInput()` 使用测试现有 helper 或构造最小 `ComposePromptInput`。

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/prompt-composer.test.ts desktop/tests/model-runtime/unit/prompt-cache-prefix.test.ts
```

Expected: FAIL，tier renderer 不存在或 Date 影响前缀。

**Step 3: 实现分层**

- 给 `PromptSection` 增加 `cacheTier`。
- 默认稳定 section：identity、response-strategy、task-planning、tool-strategy、tools、skills、guidelines、family-overlay、prompt-policy、reasoning-policy。
- 半稳定 section：environment 中的 workingDir、platform、git branch、user-profile。
- 动态 section：Date、session-context、work-files、meeting-context。
- 新增 `renderPromptSectionsByCacheTier()`。
- 保持旧 `renderPromptSections()` 兼容，但内部按 stable、semi、volatile 顺序渲染。
- 所有新增方法写中文注释，关键重排写中文日志。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/prompt-composer.test.ts desktop/tests/model-runtime/unit/prompt-cache-prefix.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/model-runtime/prompt-composer.ts desktop/src/main/services/model-runtime/canonical-turn-content.ts desktop/src/main/services/model-runtime/protocols/shared.ts desktop/tests/model-runtime/unit/prompt-composer.test.ts desktop/tests/model-runtime/unit/prompt-cache-prefix.test.ts
git commit -m "feat(desktop): 稳定模型请求缓存前缀"
```

## Task 4: 稳定工具列表和工具 hash

**Files:**

- Modify: `desktop/src/main/services/tool-schemas.ts`
- Modify: `desktop/src/main/services/mcp-server-manager.ts`
- Modify: `desktop/src/main/services/model-runtime/tool-middleware.ts`
- Test: `desktop/tests/model-runtime/unit/tool-cache-stability.test.ts`

**Step 1: 写失败测试**

构造相同 MCP tools 的不同输入顺序，断言工具 hash 一致：

```ts
describe("tool cache stability", () => {
  it("keeps tool bundle hash stable when MCP tools arrive in different order", () => {
    const left = buildToolBundleForTest([
      { serverId: "b", name: "read" },
      { serverId: "a", name: "write" },
    ]);
    const right = buildToolBundleForTest([
      { serverId: "a", name: "write" },
      { serverId: "b", name: "read" },
    ]);
    expect(left.toolBundleHash).toBe(right.toolBundleHash);
  });
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/tool-cache-stability.test.ts
```

Expected: FAIL，工具 hash 或 helper 不存在。

**Step 3: 实现稳定排序**

- 内置工具保持现有静态顺序。
- MCP tools 按 `serverId`、`name`、`description` 排序。
- Skill tools 按 skill id/name 排序。
- 工具 description 中移除动态 cwd，统一由 volatile runtime context 提供。
- `tool-middleware` 输出 `toolBundleHash`。
- 记录中文日志：工具数量、hash、是否排序。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/tool-cache-stability.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/tool-schemas.ts desktop/src/main/services/mcp-server-manager.ts desktop/src/main/services/model-runtime/tool-middleware.ts desktop/tests/model-runtime/unit/tool-cache-stability.test.ts
git commit -m "feat(desktop): 固定模型工具缓存签名"
```

## Task 5: 接入 OpenAI 和 Qwen Responses 缓存参数

**Files:**

- Modify: `desktop/src/main/services/model-runtime/protocols/openai-responses-driver.ts`
- Modify: `desktop/src/main/services/model-client.ts`
- Modify: `desktop/src/main/services/managed-model-profile.ts`
- Test: `desktop/tests/model-runtime/unit/openai-responses-driver.test.ts`
- Test: `desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts`

**Step 1: 写失败测试**

断言 OpenAI Responses request body 带 `prompt_cache_key`，Qwen 默认启用 session cache header：

```ts
it("adds prompt_cache_key for OpenAI Responses cache routing", () => {
  const body = buildOpenAiResponsesRequestBody("gpt-5.4", messages, tools, "medium", {
    providerFamily: "openai-native",
    promptCacheKey: "myclaw:p:h:t",
  });
  expect(body.prompt_cache_key).toBe("myclaw:p:h:t");
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/openai-responses-driver.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
```

Expected: FAIL，字段未注入。

**Step 3: 实现请求参数**

- `openai-responses-driver` 接收 cache plan。
- OpenAI Responses 注入 `prompt_cache_key`。
- 支持配置 `prompt_cache_retention: "24h"`。
- Qwen Responses 默认 `responsesApiConfig.sessionCache = "enable"`。
- Qwen/OpenAI server state 默认建议开启，但保留用户显式关闭。
- 中文日志记录 cache key、server state、session cache。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/openai-responses-driver.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/model-runtime/protocols/openai-responses-driver.ts desktop/src/main/services/model-client.ts desktop/src/main/services/managed-model-profile.ts desktop/tests/model-runtime/unit/openai-responses-driver.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
git commit -m "feat(desktop): 接入 Responses 缓存参数"
```

## Task 6: 接入 Anthropic-style cache_control

**Files:**

- Modify: `desktop/src/main/services/model-runtime/protocols/anthropic-messages-driver.ts`
- Modify: `desktop/src/main/services/model-client.ts`
- Test: `desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts`

**Step 1: 写失败测试**

断言 stable system block 和 tools breakpoint：

```ts
it("adds cache_control to stable Anthropic system and tool breakpoints", () => {
  const body = buildAnthropicMessagesRequestBody(makeInputWithCachePlan());
  expect(Array.isArray(body.system)).toBe(true);
  expect(JSON.stringify(body.system)).toContain("cache_control");
  expect(JSON.stringify(body.tools)).toContain("cache_control");
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts
```

Expected: FAIL，目前 system 是 string 或无 cache_control。

**Step 3: 实现 cache_control**

- 将 Anthropic system 改为 content block array。
- stable prefix 最后一个 block 加 `cache_control: { type: "ephemeral" }`。
- tools 数组最后一个工具加同样 breakpoint。
- DeepSeek 的 `anthropic-messages` route 不注入 `cache_control`，因为官方忽略，避免误导。
- Header builder 按真实 Anthropic 路线添加必要 beta header。
- 中文日志记录 breakpoint 数量和跳过原因。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/model-runtime/protocols/anthropic-messages-driver.ts desktop/src/main/services/model-client.ts desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts
git commit -m "feat(desktop): 接入 Anthropic 缓存断点"
```

## Task 7: 接入 DeepSeek、MiniMax、Ark、Kimi usage 解析

**Files:**

- Modify: `desktop/src/main/services/model-sse-parser.ts`
- Modify: `desktop/src/main/services/provider-adapters/base.ts`
- Modify: `desktop/src/main/services/provider-adapters/deepseek.ts`
- Modify: `desktop/src/main/services/provider-adapters/minimax-compatible.ts`
- Modify: `desktop/src/main/services/provider-adapters/volcengine-ark.ts`
- Modify: `desktop/src/main/services/provider-adapters/kimi.ts`
- Test: `desktop/tests/model-runtime/unit/provider-cache-usage-normalizer.test.ts`
- Test: `desktop/tests/deepseek-adapter.test.ts`

**Step 1: 写失败测试**

使用厂商 raw usage 样本：

```ts
it("parses DeepSeek prompt cache usage from SSE usage", () => {
  const parsed = parseUsageForTest({
    prompt_tokens: 1000,
    completion_tokens: 80,
    prompt_cache_hit_tokens: 750,
    prompt_cache_miss_tokens: 250,
  }, "deepseek");
  expect(parsed.cacheHitInputTokens).toBe(750);
  expect(parsed.cacheMissInputTokens).toBe(250);
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/provider-cache-usage-normalizer.test.ts desktop/tests/deepseek-adapter.test.ts
```

Expected: FAIL，字段未解析。

**Step 3: 实现解析和 include_usage**

- `model-sse-parser` 调用 orchestrator normalize usage。
- `base.normalizeAdapterResponse` 调用 orchestrator normalize usage。
- DeepSeek、MiniMax、Ark、Kimi compatible 请求默认加 `stream_options: { include_usage: true }`，保留已有 requestBody 覆盖规则。
- DeepSeek 不加 `cache_control`。
- MiniMax Anthropic route 如存在则使用 Task 6 的 cache_control 策略。
- 中文日志记录原始字段和归一化结果。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/provider-cache-usage-normalizer.test.ts desktop/tests/deepseek-adapter.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/model-sse-parser.ts desktop/src/main/services/provider-adapters/base.ts desktop/src/main/services/provider-adapters/deepseek.ts desktop/src/main/services/provider-adapters/minimax-compatible.ts desktop/src/main/services/provider-adapters/volcengine-ark.ts desktop/src/main/services/provider-adapters/kimi.ts desktop/tests/model-runtime/unit/provider-cache-usage-normalizer.test.ts desktop/tests/deepseek-adapter.test.ts
git commit -m "feat(desktop): 解析多厂商缓存用量"
```

## Task 8: 保留完整 usage 到 session、DB 和 outcome

**Files:**

- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/main/ipc/workflows.ts`
- Modify: `desktop/src/main/services/session-database.ts`
- Modify: `desktop/src/main/services/model-runtime/execution-gateway.ts`
- Modify: `desktop/src/main/services/model-runtime/turn-outcome-store.ts`
- Test: `desktop/tests/phase1-session-runtime-integration.test.ts`
- Test: `desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts`

**Step 1: 写失败测试**

断言 assistant message 落盘后保留 cache fields：

```ts
it("persists cache-aware usage on assistant messages", async () => {
  const message = await runSessionTurnWithUsage({
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cacheHitInputTokens: 700,
  });
  expect(message.usage?.cacheHitInputTokens).toBe(700);
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/phase1-session-runtime-integration.test.ts desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts
```

Expected: FAIL，usage 被裁剪或 DB 未保存。

**Step 3: 实现持久化**

- `sessions.ts` 推入 assistant message 时直接保留完整 `result.usage`。
- `workflows.ts` 保留完整 usage。
- `session-database.ts` 增加 `usage_json` 列或扩展消息 JSON 保存逻辑。
- 旧三列 `usage_prompt`、`usage_completion`、`usage_total` 继续写，兼容列表统计。
- `turn-outcome-store` 保存 cache plan 摘要和完整 usage。
- 中文日志记录迁移和回填。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/phase1-session-runtime-integration.test.ts desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/ipc/sessions.ts desktop/src/main/ipc/workflows.ts desktop/src/main/services/session-database.ts desktop/src/main/services/model-runtime/execution-gateway.ts desktop/src/main/services/model-runtime/turn-outcome-store.ts desktop/tests/phase1-session-runtime-integration.test.ts desktop/tests/model-runtime/integration/sessions-execution-gateway.test.ts
git commit -m "feat(desktop): 持久化模型缓存用量"
```

## Task 9: 增加缓存感知 UI

**Files:**

- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Test: `desktop/tests/chat-page-a11y.test.ts`
- Test: `desktop/tests/chat-page-cache-usage.test.tsx`

**Step 1: 写失败测试**

断言 badge 展示缓存命中：

```tsx
it("shows cache usage details on assistant token badge", () => {
  renderChatMessageWithUsage({
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cacheHitInputTokens: 700,
    cacheMissInputTokens: 300,
  });
  expect(screen.getByText(/命中 700/)).toBeInTheDocument();
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/chat-page-cache-usage.test.tsx desktop/tests/chat-page-a11y.test.ts
```

Expected: FAIL，UI 只显示 total tokens。

**Step 3: 实现 UI**

- token badge 显示输入、输出、命中、未命中、写入。
- tooltip 用中文解释缓存字段来源。
- session 汇总增加缓存命中汇总。
- 无 cache usage 时保持旧显示。
- 不做营销式说明，不增加卡片嵌套。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/chat-page-cache-usage.test.tsx desktop/tests/chat-page-a11y.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/renderer/pages/ChatPage.tsx desktop/src/renderer/types/electron.d.ts desktop/tests/chat-page-cache-usage.test.tsx desktop/tests/chat-page-a11y.test.ts
git commit -m "feat(desktop): 展示模型缓存用量"
```

## Task 10: 启用缓存感知 route scorecard

**Files:**

- Modify: `desktop/src/main/services/model-runtime/provider-scorecard.ts`
- Modify: `desktop/src/main/services/model-runtime/turn-outcome-store.ts`
- Modify: `desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts`
- Test: `desktop/tests/model-runtime/unit/provider-scorecard.test.ts`
- Test: `desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts`

**Step 1: 写失败测试**

断言高缓存命中路线分数更高：

```ts
it("prefers a route with better cache efficiency when success is equal", () => {
  const score = scoreProviderRoute({
    successRate: 1,
    cacheHitRate: 0.8,
    latencyScore: 0.5,
    estimatedCostScore: 0.8,
  });
  const lower = scoreProviderRoute({
    successRate: 1,
    cacheHitRate: 0.1,
    latencyScore: 0.5,
    estimatedCostScore: 0.8,
  });
  expect(score).toBeGreaterThan(lower);
});
```

**Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/provider-scorecard.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
```

Expected: FAIL，score 不含 cache。

**Step 3: 实现评分**

- score 公式：success 0.40、cache 0.30、latency 0.15、cost 0.15。
- 样本少于三轮时不自动切换。
- 用户显式 protocolTarget 不覆盖，只提示。
- managed profile 可自动更新推荐路线。
- 中文日志记录评分和路线建议。

**Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime/unit/provider-scorecard.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
```

Expected: PASS。

**Step 5: 提交**

```powershell
git add desktop/src/main/services/model-runtime/provider-scorecard.ts desktop/src/main/services/model-runtime/turn-outcome-store.ts desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts desktop/tests/model-runtime/unit/provider-scorecard.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
git commit -m "feat(desktop): 用缓存表现优化模型路线"
```

## Task 11: 全量验证和乱码门禁

**Files:**

- No production file changes expected.

**Step 1: 运行模型运行时相关测试**

Run:

```powershell
pnpm --dir desktop test desktop/tests/model-runtime
```

Expected: PASS。

**Step 2: 运行关键会话和聊天测试**

Run:

```powershell
pnpm --dir desktop test desktop/tests/phase1-session-runtime-integration.test.ts desktop/tests/chat-page-cache-usage.test.tsx desktop/tests/chat-page-a11y.test.ts
```

Expected: PASS。

**Step 3: 运行类型检查**

Run:

```powershell
pnpm --dir desktop typecheck
```

Expected: PASS。

**Step 4: 执行乱码门禁**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop/src/main/services/model-runtime desktop/src/main/services/provider-adapters desktop/src/main/ipc desktop/src/renderer/pages desktop/shared/contracts desktop/tests docs/plans
```

Expected: no output。

**Step 5: 提交验证修正**

如有验证修正：

```powershell
git add <changed-files>
git commit -m "test(desktop): 补齐模型缓存优化验证"
```

## 最终验收清单

- DeepSeek 两轮相同任务的 stable prefix hash 一致。
- DeepSeek raw usage 中 hit/miss 能落到 turn outcome。
- Anthropic route request body 出现正确 cache breakpoint。
- DeepSeek route request body 不出现 `cache_control`。
- OpenAI Responses 出现 `prompt_cache_key`。
- Qwen Responses 默认可发送 `x-dashscope-session-cache: enable`。
- ChatPage 可展示缓存命中、未命中和写入。
- Scorecard 可根据缓存表现调整 managed profile 推荐路线。
- 乱码门禁无输出。
